import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { NOTICE_MAX_WAIT_MS, watchKey } from '@sabeel/shared';
import { adminDb, makeUser, shutdown, waitFor } from './emulatorClient';
import { runNoticeSweep } from '../../src/notices';

/**
 * Change notices against a real database: that history entries really reach
 * `pendingNotices`, whoever wrote them, and that the sweep sends each card's
 * burst once, to the right people, worded from the history.
 *
 * The scheduled function itself never runs here (there is no pubsub
 * emulator), which is why its body is `runNoticeSweep`. The timing, folding
 * and wording are unit-tested in @sabeel/shared; these tests are about the
 * wiring.
 */
const B = 'ns_board';
const ADA = 'ns_ada'; // the one making changes
const FAY = 'ns_fay'; // subscribes
const WES = 'ns_wes'; // watches Review
const WYN = 'ns_wyn'; // watches Done
const OUT = 'ns_out'; // watches Review, but is not on the board
const UMA = 'ns_uma'; // assigned, then unassigned
const RAE = 'ns_rae'; // assigned, then removed from the board
const GUS = 'ns_gus'; // assigned during a burst

/** Well past the longest a notice can wait, so a sweep at this time sends it. */
const later = () => Date.now() + NOTICE_MAX_WAIT_MS + 1000;

async function inbox(uid: string, cardId: string, type: string) {
  const snap = await adminDb()
    .collection(`users/${uid}/notifications`)
    .where('cardId', '==', cardId)
    .get();
  return snap.docs.map((d) => d.data()).filter((d) => d.type === type);
}

async function pendingEntries(cardId: string): Promise<number> {
  const snap = await adminDb().doc(`pendingNotices/${cardId}`).get();
  return Object.keys(snap.data()?.entries ?? {}).length;
}

/** Wait until `n` history entries for this card are waiting to be announced. */
async function waitForPending(cardId: string, n: number) {
  await waitFor(`${n} pending entries on ${cardId}`, async () =>
    (await pendingEntries(cardId)) >= n ? true : undefined,
  );
}

const card = (over: Record<string, unknown>) => ({
  boardId: B,
  title: 'Budget',
  description: '',
  columnId: 'todo',
  rank: 'V',
  assigneeUids: [],
  subscriberUids: [],
  priority: 'none',
  labelIds: [],
  archived: false,
  commentCount: 0,
  createdAt: 1,
  createdBy: ADA,
  updatedAt: 1,
  updatedBy: ADA,
  ...over,
});

/** Create a card and send its creation burst, so a test starts from quiet. */
async function seed(id: string, over: Record<string, unknown> = {}) {
  await adminDb().doc(`cards/${id}`).set(card(over));
  await waitForPending(id, 1);
  await runNoticeSweep(later());
}

/** An edit by Ada, as the app writes one. */
async function edit(id: string, patch: Record<string, unknown>) {
  await adminDb()
    .doc(`cards/${id}`)
    .update({ ...patch, updatedBy: ADA, updatedAt: Date.now() });
}

beforeAll(async () => {
  for (const [uid, name] of [
    [ADA, 'Ada'],
    [FAY, 'Fay'],
    [WES, 'Wes'],
    [WYN, 'Wyn'],
    [OUT, 'Out'],
    [UMA, 'Uma'],
    [RAE, 'Rae'],
    [GUS, 'Gus'],
  ]) {
    await makeUser({ uid, email: `${uid}@oursabeel.com`, role: 'member', status: 'active', displayName: name });
  }
  await adminDb().doc(`boards/${B}`).set({
    name: 'Notices',
    description: '',
    archived: false,
    columns: [
      { id: 'todo', name: 'To Do' },
      { id: 'review', name: 'Review' },
      { id: 'done', name: 'Done' },
    ],
    columnIds: ['todo', 'review', 'done'],
    memberUids: [ADA, FAY, WES, WYN, UMA, RAE, GUS],
    memberProfiles: {},
    createdAt: 1,
    createdBy: ADA,
  });
  await adminDb().doc(`users/${WES}`).update({ watchedColumns: [watchKey(B, 'review')] });
  await adminDb().doc(`users/${WYN}`).update({ watchedColumns: [watchKey(B, 'done')] });
  await adminDb().doc(`users/${OUT}`).update({ watchedColumns: [watchKey(B, 'review')] });
});

afterAll(async () => {
  await shutdown();
});

describe('a burst of changes', () => {
  it('reaches a subscriber once, after the card goes quiet, in the history’s words', async () => {
    const C = 'ns_burst';
    await seed(C, { subscriberUids: [FAY] });

    await edit(C, { title: 'Budget v2' });
    await edit(C, { dueDate: '2026-11-05' });
    await edit(C, { priority: 'high' });
    await waitForPending(C, 3);

    // Not yet: the last change was a moment ago.
    await runNoticeSweep(Date.now());
    expect(await inbox(FAY, C, 'cardChanged')).toHaveLength(0);
    expect(await pendingEntries(C)).toBe(3);

    await runNoticeSweep(later());
    const sent = await inbox(FAY, C, 'cardChanged');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe(
      '“Budget v2”: Ada renamed it to “Budget v2”, set the due date to 2026-11-05, set priority to high',
    );
    // Claimed and gone, so the next sweep cannot send it again.
    expect((await adminDb().doc(`pendingNotices/${C}`).get()).exists).toBe(false);
    // And the person who made the changes hears nothing about them.
    expect(await inbox(ADA, C, 'cardChanged')).toHaveLength(0);
  });

  it('collects a file attached through the attachment path too', async () => {
    // The attachment callables write their own history entries; the notice
    // must not depend on which code wrote the entry.
    const C = 'ns_file';
    await seed(C, { subscriberUids: [FAY] });
    await adminDb()
      .collection(`cards/${C}/activity`)
      .add({ type: 'attached', actorUid: ADA, to: 'plan.pdf', at: Date.now() });
    await waitForPending(C, 1);
    await runNoticeSweep(later());
    const sent = await inbox(FAY, C, 'cardChanged');
    expect(sent.map((n) => n.text)).toEqual(['“Budget”: Ada attached plan.pdf']);
  });
});

describe('column watchers', () => {
  it('hear when a card arrives in their column, and only members do', async () => {
    const C = 'ns_arrive';
    await seed(C, { title: 'Move me' });
    await edit(C, { columnId: 'review' });
    await waitForPending(C, 1);
    await runNoticeSweep(later());

    const sent = await inbox(WES, C, 'columnArrival');
    expect(sent.map((n) => n.text)).toEqual(['Ada moved “Move me” into Review']);
    // Watching a column on a board you are not on yields nothing.
    expect(await inbox(OUT, C, 'columnArrival')).toHaveLength(0);
  });

  it('hear nothing about a card dragged through their column on its way elsewhere', async () => {
    const C = 'ns_through';
    await seed(C, { title: 'Passing' });
    await edit(C, { columnId: 'review' });
    await edit(C, { columnId: 'done' });
    await waitForPending(C, 2);
    await runNoticeSweep(later());

    expect(await inbox(WES, C, 'columnArrival')).toHaveLength(0);
    expect((await inbox(WYN, C, 'columnArrival')).map((n) => n.text)).toEqual([
      'Ada moved “Passing” into Done',
    ]);
  });
});

describe('an archived card is dormant', () => {
  it('sends the archiving burst, then nothing until a restore', async () => {
    const C = 'ns_dormant';
    await seed(C, { subscriberUids: [FAY], columnId: 'review', title: 'Put away' });

    await edit(C, { archived: true, archivedAt: Date.now() });
    await waitForPending(C, 1);
    await runNoticeSweep(later());
    expect((await inbox(FAY, C, 'cardChanged')).map((n) => n.text)).toEqual([
      '“Put away”: Ada archived it',
    ]);

    // A change while archived is recorded, and announced to no one.
    await edit(C, { labelIds: ['l1'] });
    await waitForPending(C, 1);
    await runNoticeSweep(later());
    expect(await inbox(FAY, C, 'cardChanged')).toHaveLength(1);
    expect((await adminDb().doc(`pendingNotices/${C}`).get()).exists).toBe(false);

    // Restoring it wakes it: followers hear, and so does its column.
    await edit(C, { archived: false });
    await waitForPending(C, 1);
    await runNoticeSweep(later());
    expect((await inbox(FAY, C, 'cardChanged')).map((n) => n.text)).toContain(
      '“Put away”: Ada restored it',
    );
    // Wes also heard it arrive when it was created in Review, before all this.
    expect((await inbox(WES, C, 'columnArrival')).map((n) => n.text)).toContain(
      'Ada restored “Put away” to Review',
    );
  });
});

describe('assignment and unassignment', () => {
  it('sends the person taken off the card their last notice', async () => {
    const C = 'ns_unassign';
    await seed(C, { assigneeUids: [UMA] });
    // Assigned at creation and told then; the creation itself is not news.
    expect(await inbox(UMA, C, 'cardChanged')).toHaveLength(0);

    await edit(C, { assigneeUids: [] });
    await waitForPending(C, 1);
    await runNoticeSweep(later());
    expect((await inbox(UMA, C, 'cardChanged')).map((n) => n.text)).toEqual([
      '“Budget”: Ada unassigned you',
    ]);
  });

  it('sends nothing to someone removed from the board', async () => {
    const C = 'ns_removed';
    await seed(C, { assigneeUids: [RAE] });
    // What removeBoardMember does: off the board and off the card together.
    await adminDb()
      .doc(`boards/${B}`)
      .update({ memberUids: [ADA, FAY, WES, WYN, UMA, GUS] });
    await edit(C, { assigneeUids: [] });
    await waitForPending(C, 1);
    await runNoticeSweep(later());
    expect(await inbox(RAE, C, 'cardChanged')).toHaveLength(0);
  });

  it('leaves a new assignee’s own assignment out of their notice', async () => {
    const C = 'ns_assign';
    await seed(C, { subscriberUids: [FAY] });

    // One write: assign Gus and set a date. Gus is told at once; the date was
    // part of the same write, so he sees it on the card he is sent to.
    await edit(C, { assigneeUids: [GUS], dueDate: '2026-11-09' });
    await waitFor('the assignment', async () => {
      const got = await inbox(GUS, C, 'assigned');
      return got.length ? got : undefined;
    });
    await edit(C, { priority: 'urgent' });
    await waitForPending(C, 3);
    await runNoticeSweep(later());

    expect((await inbox(GUS, C, 'cardChanged')).map((n) => n.text)).toEqual([
      '“Budget”: Ada set priority to urgent',
    ]);
    expect((await inbox(FAY, C, 'cardChanged')).map((n) => n.text)).toEqual([
      '“Budget”: Ada assigned Gus, set the due date to 2026-11-09, set priority to urgent',
    ]);
  });
});
