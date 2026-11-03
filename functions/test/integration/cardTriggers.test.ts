import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { watchKey } from '@sabeel/shared';
import {
  adminDb,
  callFunction,
  idTokenFor,
  makeUser,
  shutdown,
  waitFor,
  waitUntilGone,
} from './emulatorClient';

// Unique uids so these do not collide with the other trigger suites sharing the
// emulator within one `emulators:exec` run.
const MGR = 'ct_mgr';
const MEM = 'ct_mem';

const board = (over: Record<string, unknown> = {}) => ({
  name: 'Ops',
  description: '',
  archived: false,
  columns: [{ id: 'c1', name: 'To Do' }],
  columnIds: ['c1'],
  memberUids: [MGR, MEM],
  memberProfiles: {},
  createdAt: 1,
  createdBy: MGR,
  ...over,
});

const card = (over: Record<string, unknown> = {}) => ({
  boardId: 'ct_b1',
  title: 'Ship it',
  description: '',
  columnId: 'c1',
  rank: 'V',
  assigneeUids: [],
  priority: 'none',
  labelIds: [],
  archived: false,
  commentCount: 0,
  createdAt: 1,
  createdBy: MGR,
  updatedAt: 1,
  updatedBy: MGR,
  ...over,
});

beforeAll(async () => {
  // Removing a board member takes board authority now. An admin has it on every
  // board, which keeps this test about ATTRIBUTION rather than about ownership.
  await makeUser({ uid: MGR, email: `${MGR}@oursabeel.com`, role: 'admin', status: 'active' });
  await makeUser({ uid: MEM, email: `${MEM}@oursabeel.com`, role: 'member', status: 'active' });
  await adminDb().doc('boards/ct_b1').set(board());
});

afterAll(async () => {
  await shutdown();
});

describe('onCardDeleted cascade', () => {
  it("deletes a card's comments and activity when the card is deleted", async () => {
    await adminDb().doc('cards/ct_del').set(card());
    // Wait for onCardWritten to record the 'created' entry, so no late activity
    // write can race the delete below.
    await waitFor('created activity', async () => {
      const snap = await adminDb().collection('cards/ct_del/activity').get();
      return snap.empty ? undefined : true;
    });
    await adminDb()
      .collection('cards/ct_del/comments')
      .add({ authorUid: MGR, body: 'a thread', mentionUids: [], createdAt: 1 });

    await adminDb().doc('cards/ct_del').delete();

    // onCardDeleted recursiveDeletes the subcollections left behind.
    await waitUntilGone('card subcollections', async () => {
      const c = await adminDb().collection('cards/ct_del/comments').get();
      const a = await adminDb().collection('cards/ct_del/activity').get();
      return !c.empty || !a.empty;
    });
  });
});

describe('onCardDeleted unlinks subtasks', () => {
  it("clears parentId on a deleted card's children", async () => {
    // parentId lives on the CHILD, so nothing else would ever clear it. Left
    // set, those cards point at a card that no longer exists AND become
    // permanently unlinkable — `canBeSubtaskOf` refuses a card that already has
    // a parent, so they could never be attached anywhere else.
    await adminDb().doc('cards/ct_parent').set(card());
    await adminDb().doc('cards/ct_kid1').set(card({ parentId: 'ct_parent' }));
    await adminDb().doc('cards/ct_kid2').set(card({ parentId: 'ct_parent' }));
    // An unrelated subtask of a DIFFERENT parent must survive untouched.
    await adminDb().doc('cards/ct_other').set(card({ parentId: 'someone_else' }));

    await adminDb().doc('cards/ct_parent').delete();

    await waitFor('subtasks unlinked', async () => {
      const a = await adminDb().doc('cards/ct_kid1').get();
      const b = await adminDb().doc('cards/ct_kid2').get();
      return a.data()?.parentId === undefined && b.data()?.parentId === undefined
        ? true
        : undefined;
    });

    const other = await adminDb().doc('cards/ct_other').get();
    expect(other.data()?.parentId).toBe('someone_else');

    // The unlink names nobody: MGR last edited the child but deleted nothing,
    // and the entry's actor is also who its followers are told did it.
    const entry = await waitFor('unlink activity', async () => {
      const snap = await adminDb()
        .collection('cards/ct_kid1/activity')
        .where('type', '==', 'subtaskOf')
        .get();
      return snap.docs.map((d) => d.data()).find((d) => d.to === undefined);
    });
    expect(entry.actorUid).toBe('unknown');
  });

  it('still unlinks the survivors when a child was deleted at the same time', () =>
    // Deleting a parent together with some of its subtasks — what `bulkDelete`
    // does, in one batch.
    //
    // Honest note on what this does and does not prove: it was written expecting
    // a batched sweep to fail here, and it does NOT — the co-deleted child is
    // already gone before the sweep queries, so it is never returned and nothing
    // errors. Verified by running this against the batched implementation, where
    // it also passed. It is kept because the scenario is real and worth pinning;
    // the narrow concurrent-delete window that motivated `allSettled` is not
    // reproducible from a test.
    (async () => {
      await adminDb().doc('cards/ct_p2').set(card());
      await adminDb().doc('cards/ct_gone').set(card({ parentId: 'ct_p2' }));
      await adminDb().doc('cards/ct_stays').set(card({ parentId: 'ct_p2' }));

      // The parent and one child vanish together.
      const batch = adminDb().batch();
      batch.delete(adminDb().doc('cards/ct_p2'));
      batch.delete(adminDb().doc('cards/ct_gone'));
      await batch.commit();

      await waitFor('surviving subtask unlinked', async () => {
        const s = await adminDb().doc('cards/ct_stays').get();
        return s.data()?.parentId === undefined ? true : undefined;
      });
    })());
});

describe('removeBoardMember activity attribution', () => {
  it('attributes the unassignment to the admin who removed the member', async () => {
    // A card assigned to MEM, last touched by MEM — so the ONLY way the activity
    // entry can name MGR is if removeBoardMember stamps updatedBy correctly.
    await adminDb()
      .doc('cards/ct_unassign')
      .set(card({ assigneeUids: [MEM], createdBy: MEM, updatedBy: MEM }));
    await waitFor('created activity', async () => {
      const snap = await adminDb().collection('cards/ct_unassign/activity').get();
      return snap.empty ? undefined : true;
    });

    const token = await idTokenFor(MGR);
    const res = await callFunction('removeBoardMember', { boardId: 'ct_b1', uid: MEM }, token);
    expect(res.status).toBe(200);

    const entry = await waitFor('unassigned activity', async () => {
      const snap = await adminDb()
        .collection('cards/ct_unassign/activity')
        .where('type', '==', 'unassigned')
        .get();
      return snap.empty ? undefined : snap.docs[0].data();
    });
    expect(entry.actorUid).toBe(MGR);
    expect(entry.to).toBe(MEM);
  });

  it('also clears their SUBSCRIPTIONS, which are a grant of read access', async () => {
    // The card read rule has a subscriber arm, so a uid left behind here keeps
    // someone who is no longer on the board able to read its cards — the exact
    // leak clearing assigneeUids exists to prevent.
    await adminDb()
      .doc('boards/ct_b1')
      .update({ memberUids: FieldValue.arrayUnion(MEM) });
    await adminDb()
      .doc('cards/ct_unsub')
      .set(card({ subscriberUids: [MEM], createdBy: MGR, updatedBy: MGR }));

    const token = await idTokenFor(MGR);
    const res = await callFunction('removeBoardMember', { boardId: 'ct_b1', uid: MEM }, token);
    expect(res.status).toBe(200);

    await waitFor('the subscription to be gone', async () => {
      const snap = await adminDb().doc('cards/ct_unsub').get();
      const subs = (snap.data()?.subscriberUids ?? []) as string[];
      return subs.includes(MEM) ? undefined : true;
    });
  });

  it('clears the columns they watched on that board, and only that board', async () => {
    await adminDb()
      .doc('boards/ct_b1')
      .update({ memberUids: FieldValue.arrayUnion(MEM) });
    await adminDb()
      .doc(`users/${MEM}`)
      .update({ watchedColumns: [watchKey('ct_b1', 'c1'), watchKey('ct_other', 'c1')] });

    const token = await idTokenFor(MGR);
    const res = await callFunction('removeBoardMember', { boardId: 'ct_b1', uid: MEM }, token);
    expect(res.status).toBe(200);

    const user = await adminDb().doc(`users/${MEM}`).get();
    expect(user.data()?.watchedColumns).toEqual([watchKey('ct_other', 'c1')]);
  });
});
