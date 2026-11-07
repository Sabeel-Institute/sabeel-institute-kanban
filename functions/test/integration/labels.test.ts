import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { applyDeleteLabel } from '../../src/labels';
import {
  adminDb,
  callFunction,
  idTokenFor,
  makeUser,
  shutdown,
  waitFor,
} from './emulatorClient';

/**
 * The two label callables.
 *
 * The sweep is the whole reason `deleteLabel` is a callable at all: a label id
 * lives on cards across every board, and `firestore.rules` denies the client
 * delete outright so the two halves cannot come apart.
 *
 * Unique ids throughout (`lb_` prefix) so these do not collide with the other
 * suites sharing one `emulators:exec` run.
 */
const ADM = 'lb_adm';
const MEM = 'lb_mem';
/** On neither board. */
const OUT = 'lb_out';
/** A board the ADMIN is deliberately not a member of. */
const BOARD_A = 'lb_board_a';
const BOARD_B = 'lb_board_b';

let admToken: string;
let memToken: string;
let outToken: string;

const labelRef = (id: string) => adminDb().doc(`labels/${id}`);
const cardRef = (id: string) => adminDb().doc(`cards/${id}`);

const labelsOn = async (cardId: string) =>
  ((await cardRef(cardId).get()).data()?.labelIds ?? []) as string[];

async function putLabel(id: string, name = 'Finance', boardId?: string): Promise<void> {
  await labelRef(id).set({
    ...(boardId ? { boardId } : {}),
    name,
    color: '#83114F',
    createdAt: Date.now(),
    createdBy: MEM,
  });
}

async function putCard(
  id: string,
  boardId: string,
  labelIds: string[],
  archived = false,
): Promise<void> {
  await cardRef(id).set({
    boardId,
    title: `card ${id}`,
    description: '',
    columnId: 'c1',
    rank: 'V',
    assigneeUids: [],
    priority: 'none',
    labelIds,
    archived,
    commentCount: 0,
    createdAt: Date.now(),
    createdBy: MEM,
    updatedAt: Date.now(),
    updatedBy: MEM,
  });
}

beforeAll(async () => {
  // An institute label is ADMIN work: the effect is org-wide, so it takes an
  // org-wide authority. A board's own label is that board's (below).
  await makeUser({ uid: ADM, email: `${ADM}@oursabeel.com`, role: 'admin', status: 'active' });
  await makeUser({ uid: MEM, email: `${MEM}@oursabeel.com`, role: 'member', status: 'active' });
  await makeUser({ uid: OUT, email: `${OUT}@oursabeel.com`, role: 'member', status: 'active' });
  [admToken, memToken, outToken] = await Promise.all([idTokenFor(ADM), idTokenFor(MEM), idTokenFor(OUT)]);

  for (const [id, members] of [
    [BOARD_A, [MEM]],
    [BOARD_B, [MEM]],
  ] as const) {
    await adminDb().doc(`boards/${id}`).set({
      name: id,
      description: '',
      archived: false,
      columns: [{ id: 'c1', name: 'To Do' }],
      columnIds: ['c1'],
      memberUids: [...members],
      memberProfiles: {},
      activeCardCount: 0,
      createdAt: Date.now(),
      createdBy: ADM,
    });
  }
});

afterAll(async () => {
  await shutdown();
});

describe('countLabelUsage', () => {
  it('counts across boards the caller is not a member of', async () => {
    await putLabel('lb_wide');
    await putCard('lb_c_a1', BOARD_A, ['lb_wide']);
    await putCard('lb_c_a2', BOARD_A, ['lb_wide', 'lb_other']);
    await putCard('lb_c_b1', BOARD_B, ['lb_wide']);
    await putCard('lb_c_b2', BOARD_B, ['lb_other']);

    // ADM is a member of NEITHER board. The count must still be complete, which
    // is the point of doing it server-side rather than from the client.
    const res = await callFunction('countLabelUsage', { labelId: 'lb_wide' }, admToken);
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ active: 3, archived: 0 });
  });

  it('separates archived cards from live ones', async () => {
    // "on 3 cards" reads very differently when two of them are in the archive
    // and no board will ever show them.
    await putLabel('lb_split');
    await putCard('lb_s_live', BOARD_A, ['lb_split']);
    await putCard('lb_s_arch1', BOARD_A, ['lb_split'], true);
    await putCard('lb_s_arch2', BOARD_B, ['lb_split'], true);

    const res = await callFunction('countLabelUsage', { labelId: 'lb_split' }, admToken);
    expect(res.body.result).toEqual({ active: 1, archived: 2 });
  });

  it('reports zero for a label nothing carries', async () => {
    await putLabel('lb_unused');
    const res = await callFunction('countLabelUsage', { labelId: 'lb_unused' }, admToken);
    expect(res.body.result).toEqual({ active: 0, archived: 0 });
  });

  it('is refused to a member, and to a caller with no token', async () => {
    await putLabel('lb_gated');
    const asMember = await callFunction('countLabelUsage', { labelId: 'lb_gated' }, memToken);
    expect(asMember.body.error?.status).toBe('PERMISSION_DENIED');
    const anon = await callFunction('countLabelUsage', { labelId: 'lb_gated' });
    expect(anon.body.error?.status).toBe('UNAUTHENTICATED');
    // Only the role was in the way.
    const asAdmin = await callFunction('countLabelUsage', { labelId: 'lb_gated' }, admToken);
    expect(asAdmin.status).toBe(200);
  });

  it('rejects a malformed labelId rather than querying with it', async () => {
    for (const labelId of ['', 'has/slash', 'x'.repeat(200), 42]) {
      const res = await callFunction('countLabelUsage', { labelId }, admToken);
      expect(res.body.error?.status).toBe('INVALID_ARGUMENT');
    }
  });
});

describe('deleteLabel', () => {
  it('strips the id from every card, on every board, and leaves others alone', async () => {
    await putLabel('lb_kill');
    await putLabel('lb_keep');
    await putCard('lb_d_a1', BOARD_A, ['lb_kill', 'lb_keep']);
    // Archived too: the label has to come off cards nobody is looking at, or a
    // restore from the archive would resurrect a reference to nothing.
    await putCard('lb_d_b1', BOARD_B, ['lb_kill'], true);
    await putCard('lb_d_b2', BOARD_B, ['lb_keep']);

    const res = await callFunction('deleteLabel', { labelId: 'lb_kill' }, admToken);
    expect(res.status).toBe(200);
    expect((res.body.result as { strippedFromCards: number }).strippedFromCards).toBe(2);

    expect((await labelRef('lb_kill').get()).exists).toBe(false);
    // The other label is untouched on the cards that carried both.
    expect(await labelsOn('lb_d_a1')).toEqual(['lb_keep']);
    expect(await labelsOn('lb_d_b1')).toEqual([]);
    expect(await labelsOn('lb_d_b2')).toEqual(['lb_keep']);
    // And it survives.
    expect((await labelRef('lb_keep').get()).exists).toBe(true);
  });

  it('names the admin who deleted it in each card’s activity', async () => {
    await putLabel('lb_logged');
    await putCard('lb_log_1', BOARD_A, ['lb_logged']);

    await callFunction('deleteLabel', { labelId: 'lb_logged' }, admToken);

    // Written by the onCardWritten trigger off the labelIds diff, not by the
    // callable — which is why setting updatedBy is load-bearing. Without it the
    // entry would name whoever last edited the card.
    const entry = await waitFor('a labels activity entry naming the deleter', async () => {
      const docs = (await adminDb().collection('cards/lb_log_1/activity').get()).docs;
      return docs.map((d) => d.data()).find((e) => e.type === 'labels');
    });
    expect(entry.actorUid).toBe(ADM);
  });

  it('is refused to a member, and the label survives', async () => {
    await putLabel('lb_safe');
    await putCard('lb_safe_c', BOARD_A, ['lb_safe']);

    const res = await callFunction('deleteLabel', { labelId: 'lb_safe' }, memToken);
    expect(res.body.error?.status).toBe('PERMISSION_DENIED');
    expect((await labelRef('lb_safe').get()).exists).toBe(true);
    expect(await labelsOn('lb_safe_c')).toEqual(['lb_safe']);
  });

  it('reports a label that is not there rather than silently succeeding', async () => {
    const res = await callFunction('deleteLabel', { labelId: 'lb_missing' }, admToken);
    expect(res.body.error?.status).toBe('NOT_FOUND');
  });

  it('keeps the label when the sweep fails, so re-running finishes the job', async () => {
    // The ordering guarantee, and the ONLY way to observe it: on the happy path
    // sweep-then-delete and delete-then-sweep end in exactly the same state, so
    // every other assertion in this file passes under either. Reversing the two
    // lines in applyDeleteLabel turns THIS test red and nothing else.
    //
    // What it protects: a failure partway leaves the label present with some
    // cards already stripped — incomplete but findable, and finished by running
    // it again. Reversed, the same failure strands cards holding an id with
    // nothing left to look it up by.
    await putLabel('lb_partial');
    await putCard('lb_partial_c', BOARD_A, ['lb_partial']);

    await expect(
      applyDeleteLabel('lb_partial', ADM, async () => {
        throw new Error('sweep failed partway');
      }),
    ).rejects.toThrow('sweep failed partway');

    expect((await labelRef('lb_partial').get()).exists).toBe(true);
    expect(await labelsOn('lb_partial_c')).toEqual(['lb_partial']);

    // …and the ordinary path still finishes it.
    const res = await callFunction('deleteLabel', { labelId: 'lb_partial' }, admToken);
    expect(res.status).toBe(200);
    expect((await labelRef('lb_partial').get()).exists).toBe(false);
    expect(await labelsOn('lb_partial_c')).toEqual([]);
  });

  it('is safe to run twice — the second pass finds nothing left to do', async () => {
    // The ordering guarantee: cards are swept BEFORE the document is deleted, so
    // a failure in between leaves the label present and re-running finishes the
    // job. Here the first run completes, so the second must report NOT_FOUND
    // rather than stripping anything a second time.
    await putLabel('lb_twice');
    await putCard('lb_twice_c', BOARD_A, ['lb_twice']);
    const first = await callFunction('deleteLabel', { labelId: 'lb_twice' }, admToken);
    expect((first.body.result as { strippedFromCards: number }).strippedFromCards).toBe(1);
    const second = await callFunction('deleteLabel', { labelId: 'lb_twice' }, admToken);
    expect(second.body.error?.status).toBe('NOT_FOUND');
    expect(await labelsOn('lb_twice_c')).toEqual([]);
  });
});

/**
 * A board's own label is that board's business: anyone on it may count it and
 * delete it, and nobody else may, which is `mayCurate()` in firestore.rules.
 */
describe('a board label', () => {
  it('is counted and deleted by a plain member of its board', async () => {
    await putLabel('lb_own', 'Venue', BOARD_A);
    await putCard('lb_own_c', BOARD_A, ['lb_own', 'lb_keep2']);

    const count = await callFunction('countLabelUsage', { labelId: 'lb_own' }, memToken);
    expect(count.body.result).toEqual({ active: 1, archived: 0 });
    const res = await callFunction('deleteLabel', { labelId: 'lb_own' }, memToken);
    expect(res.status).toBe(200);
    expect((await labelRef('lb_own').get()).exists).toBe(false);
    expect(await labelsOn('lb_own_c')).toEqual(['lb_keep2']);
  });

  it('is refused to someone not on its board, and survives', async () => {
    await putLabel('lb_theirs', 'Venue', BOARD_A);
    for (const fn of ['countLabelUsage', 'deleteLabel']) {
      const res = await callFunction(fn, { labelId: 'lb_theirs' }, outToken);
      expect(res.body.error?.status).toBe('PERMISSION_DENIED');
    }
    expect((await labelRef('lb_theirs').get()).exists).toBe(true);
    // Only the board was in the way.
    const asMember = await callFunction('countLabelUsage', { labelId: 'lb_theirs' }, memToken);
    expect(asMember.status).toBe(200);
  });

  it('is deleted by an admin who is not on the board', async () => {
    await putLabel('lb_adm_own', 'Venue', BOARD_B);
    const res = await callFunction('deleteLabel', { labelId: 'lb_adm_own' }, admToken);
    expect(res.status).toBe(200);
    expect((await labelRef('lb_adm_own').get()).exists).toBe(false);
  });

  it('gives a plain member nothing over an institute label', async () => {
    await putLabel('lb_inst');
    const res = await callFunction('deleteLabel', { labelId: 'lb_inst' }, memToken);
    expect(res.body.error?.status).toBe('PERMISSION_DENIED');
    expect((await labelRef('lb_inst').get()).exists).toBe(true);
  });
});
