import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { BoardActivityDoc } from '@sabeel/shared';
import { adminDb, callFunction, idTokenFor, makeUser, shutdown, waitFor } from './emulatorClient';

/**
 * A board's history, as the onBoardWritten trigger writes it.
 *
 * Through the emulator because the claim is about a TRIGGER: that a board
 * write — a client's, or a callable's — produces these entries, naming the
 * person on the stamp and nobody when the stamp did not move. The diff itself
 * is tested exhaustively in packages/shared.
 *
 * Unique uids and board ids, so this does not collide with the other suites
 * sharing the emulator.
 */
const SARA = 'bh_sara';
const OMAR = 'bh_omar';
const ADMIN = 'bh_admin';

const board = (over: Record<string, unknown> = {}) => ({
  name: 'Fundraising',
  description: '',
  archived: false,
  columns: [
    { id: 'c1', name: 'To Do' },
    { id: 'c2', name: 'Done' },
  ],
  columnIds: ['c1', 'c2'],
  memberUids: [SARA],
  memberProfiles: { [SARA]: { displayName: 'Sara', email: `${SARA}@oursabeel.com` } },
  boardOwnerUids: [SARA],
  activeCardCount: 0,
  createdAt: 1,
  createdBy: SARA,
  ...over,
});

type Entry = BoardActivityDoc & { id: string };

/**
 * A board id no earlier attempt used. `--retry` re-runs a failed test, and
 * re-creating the same board is an UPDATE to the trigger, which would add
 * entries to the history the retry then counts.
 */
const freshBoard = (name: string) => `${name}_${Date.now().toString(36)}`;

async function history(boardId: string): Promise<Entry[]> {
  const snap = await adminDb().collection(`boards/${boardId}/activity`).orderBy('at').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as BoardActivityDoc) }));
}

/** Waits until the board has `n` entries, and returns them oldest first. */
const historyOf = (boardId: string, n: number) =>
  waitFor(`${n} history entries on ${boardId}`, async () => {
    const h = await history(boardId);
    return h.length >= n ? h : undefined;
  });

beforeAll(async () => {
  await makeUser({ uid: SARA, email: `${SARA}@oursabeel.com`, displayName: 'Sara', role: 'organizer', status: 'active' });
  await makeUser({ uid: OMAR, email: `${OMAR}@oursabeel.com`, displayName: 'Omar', role: 'member', status: 'active' });
  await makeUser({ uid: ADMIN, email: `${ADMIN}@oursabeel.com`, displayName: 'Ada', role: 'admin', status: 'active' });
});

afterAll(async () => {
  await shutdown();
});

describe('board history', () => {
  it('records a new board as created by its creator', async () => {
    const fresh = freshBoard('bh_new');
    await adminDb().doc(`boards/${fresh}`).set(board());
    const [created] = await historyOf(fresh, 1);
    expect(created).toMatchObject({ type: 'created', actorUid: SARA, actorName: 'Sara' });
    expect(created.at).toBeGreaterThan(0);
  });

  it('names the person on a stamped change, by their name now', async () => {
    const rename = freshBoard('bh_rename');
    await adminDb().doc(`boards/${rename}`).set(board());
    await historyOf(rename, 1);
    // An admin who is not on the board: the name comes from their account.
    await adminDb()
      .doc(`boards/${rename}`)
      .update({ name: 'Fundraising 2027', updatedBy: ADMIN, updatedAt: 10 });
    const h = await historyOf(rename, 2);
    expect(h[1]).toMatchObject({
      type: 'renamed',
      actorUid: ADMIN,
      actorName: 'Ada',
      from: 'Fundraising',
      to: 'Fundraising 2027',
    });
  });

  // An app older than the history leaves the stamp alone. The uid still on it
  // belongs to an earlier change, so the entry names nobody.
  it('names nobody when the stamp did not move', async () => {
    const old = freshBoard('bh_old');
    await adminDb().doc(`boards/${old}`).set(board({ updatedBy: SARA, updatedAt: 5 }));
    await historyOf(old, 1);
    await adminDb().doc(`boards/${old}`).update({ archived: true });
    const h = await historyOf(old, 2);
    expect(h[1].type).toBe('archived');
    expect(h[1].actorUid).toBeUndefined();
    expect(h[1].actorName).toBeUndefined();
  });

  it('writes one entry per change in a write, and nothing for the card count', async () => {
    const cols = freshBoard('bh_cols');
    await adminDb().doc(`boards/${cols}`).set(board());
    await historyOf(cols, 1);
    await adminDb().doc(`boards/${cols}`).update({ activeCardCount: 4 });
    await adminDb()
      .doc(`boards/${cols}`)
      .update({
        columns: [
          { id: 'c2', name: 'Finished' },
          { id: 'c3', name: 'Review' },
        ],
        columnIds: ['c2', 'c3'],
        updatedBy: SARA,
        updatedAt: 20,
      });
    const h = await historyOf(cols, 4);
    expect(h).toHaveLength(4);
    expect(h.slice(1).map((e) => [e.type, e.from, e.to])).toEqual(
      expect.arrayContaining([
        ['columnAdded', undefined, 'Review'],
        ['columnRemoved', 'To Do', undefined],
        ['columnRenamed', 'Done', 'Finished'],
      ]),
    );
    // One write, one moment.
    expect(new Set(h.slice(1).map((e) => e.at)).size).toBe(1);
  });

  it('records people added and removed through the callables, by whoever did it', async () => {
    const people = freshBoard('bh_people');
    await adminDb().doc(`boards/${people}`).set(board());
    await historyOf(people, 1);
    const sara = await idTokenFor(SARA);

    const added = await callFunction('addBoardMember', { boardId: people, uid: OMAR }, sara);
    expect(added.status).toBe(200);
    const h = await historyOf(people, 2);
    expect(h[1]).toMatchObject({
      type: 'memberAdded',
      actorUid: SARA,
      actorName: 'Sara',
      subjectUid: OMAR,
      subjectName: 'Omar',
    });

    // Made an owner first, so the removal also takes ownership away — which
    // is one event, not two.
    await adminDb()
      .doc(`boards/${people}`)
      .update({ boardOwnerUids: [SARA, OMAR], updatedBy: SARA, updatedAt: 30 });
    await historyOf(people, 3);
    const removed = await callFunction('removeBoardMember', { boardId: people, uid: OMAR }, sara);
    expect(removed.status).toBe(200);
    const after = await historyOf(people, 4);
    expect(after[2]).toMatchObject({ type: 'ownerAdded', subjectUid: OMAR, subjectName: 'Omar' });
    expect(after[3]).toMatchObject({
      type: 'memberRemoved',
      actorUid: SARA,
      subjectUid: OMAR,
      subjectName: 'Omar',
    });
    // Nothing further arrives.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await history(people)).toHaveLength(4);
  });
});
