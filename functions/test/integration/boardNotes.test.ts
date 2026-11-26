import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { NotesVersionDoc } from '@sabeel/shared';
import { adminDb, callFunction, idTokenFor, makeUser, shutdown, stays, waitFor } from './emulatorClient';

/**
 * A board's notes history, as `onBoardNotesWritten` writes it, and a clone
 * carrying the notes along.
 *
 * Through the emulator because the claims are about a TRIGGER and a callable:
 * that a save becomes a version naming its writer by their stored name, that
 * a second save in the same sitting replaces it, that someone else's save or
 * a restore starts another, and that a clone's notes arrive with a version of
 * their own the trigger leaves alone. What a version changed is tested
 * exhaustively in packages/shared.
 *
 * Unique uids and board ids, so this does not collide with the other suites
 * sharing the emulator.
 */
const SARA = 'bn_sara';
const OMAR = 'bn_omar';

const freshBoard = (name: string) => `${name}_${Date.now().toString(36)}`;

const board = (over: Record<string, unknown> = {}) => ({
  name: 'Fundraising',
  description: '',
  archived: false,
  columns: [{ id: 'c1', name: 'To Do' }],
  columnIds: ['c1'],
  memberUids: [SARA, OMAR],
  memberProfiles: {},
  boardOwnerUids: [SARA],
  activeCardCount: 0,
  createdAt: 1,
  createdBy: SARA,
  ...over,
});

let clock = 1_000_000;
const save = (boardId: string, by: string, version: number, text: string, extra: Record<string, unknown> = {}) =>
  adminDb().doc(`boards/${boardId}/notes/current`).set({ text, version, updatedBy: by, updatedAt: ++clock, ...extra });

type Version = NotesVersionDoc & { id: string };
async function versions(boardId: string): Promise<Version[]> {
  const snap = await adminDb().collection(`boards/${boardId}/notes/current/versions`).orderBy('version').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as NotesVersionDoc) }));
}
/** Waits until the latest version has reached `version`, and returns them all, oldest first. */
const upTo = (boardId: string, version: number) =>
  waitFor(`versions up to ${version} on ${boardId}`, async () => {
    const v = await versions(boardId);
    return v.at(-1)?.version === version ? v : undefined;
  });

beforeAll(async () => {
  await makeUser({ uid: SARA, email: `${SARA}@oursabeel.com`, displayName: 'Sara', role: 'organizer', status: 'active' });
  await makeUser({ uid: OMAR, email: `${OMAR}@oursabeel.com`, displayName: 'Omar', role: 'member', status: 'active' });
});

afterAll(async () => {
  await shutdown();
});

describe('the notes history', () => {
  it('records a first save as a version naming its writer', async () => {
    const id = freshBoard('bn_first');
    await adminDb().doc(`boards/${id}`).set(board());
    await save(id, SARA, 1, 'Call the hall first.');
    const [first] = await upTo(id, 1);
    expect(first).toMatchObject({ id: '1', by: SARA, byName: 'Sara', text: 'Call the hall first.', added: 1, removed: 0 });
    expect(first.startedAt).toBe(first.at);
  });

  it('folds a second save in the same sitting into it, and starts another for someone else', async () => {
    const id = freshBoard('bn_sitting');
    await adminDb().doc(`boards/${id}`).set(board());
    await save(id, SARA, 1, 'Call the hall first.');
    await upTo(id, 1);
    await save(id, SARA, 2, 'Call the hall first. Then the caterer.');
    const folded = await upTo(id, 2);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ id: '1', version: 2, text: 'Call the hall first. Then the caterer.', added: 1, removed: 0 });
    expect(folded[0].at).toBeGreaterThanOrEqual(folded[0].startedAt);

    await save(id, OMAR, 3, 'Call the hall first. Then the caterer.\n\n- [Hall form](https://example.org/hall)');
    const two = await upTo(id, 3);
    expect(two.map((v) => [v.id, v.byName])).toEqual([['1', 'Sara'], ['3', 'Omar']]);
    expect(two[1]).toMatchObject({ added: 1, removed: 0 });
  });

  it('records a restore as a version of its own, with the day it put back', async () => {
    const id = freshBoard('bn_restore');
    await adminDb().doc(`boards/${id}`).set(board());
    await save(id, SARA, 1, 'First.');
    const [first] = await upTo(id, 1);
    await save(id, OMAR, 2, 'Second.');
    await upTo(id, 2);
    // A restore by the person who wrote the latest version, within the
    // sitting, still stands alone.
    await save(id, OMAR, 3, 'First.', { restoredFrom: '1' });
    const all = await upTo(id, 3);
    expect(all.map((v) => v.id)).toEqual(['1', '2', '3']);
    expect(all[2]).toMatchObject({ restoredFrom: '1', restoredAt: first.at, byName: 'Omar' });
  });

  it('does not record a restore of text the named version never held', async () => {
    const id = freshBoard('bn_fake');
    await adminDb().doc(`boards/${id}`).set(board());
    await save(id, SARA, 1, 'Real.');
    await upTo(id, 1);
    await save(id, OMAR, 2, 'Invented.', { restoredFrom: '1' });
    const all = await upTo(id, 2);
    expect(all[1].restoredFrom).toBeUndefined();
    expect(all[1]).toMatchObject({ added: 1, removed: 1 });
  });

  it('marks an agent’s save, and never folds it into the person’s own', async () => {
    const id = freshBoard('bn_agent');
    await adminDb().doc(`boards/${id}`).set(board());
    await save(id, SARA, 1, 'By hand.');
    await upTo(id, 1);
    const at = ++clock;
    await adminDb().doc(`boards/${id}/notes/current`).set({ text: 'By an agent.', version: 2, updatedBy: SARA, updatedAt: at, agentAt: at });
    const all = await upTo(id, 2);
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ via: 'agent', byName: 'Sara' });
    expect(all[0].via).toBeUndefined();
  });

  it('adds nothing for a write that is not a save', async () => {
    const id = freshBoard('bn_same');
    await adminDb().doc(`boards/${id}`).set(board());
    await save(id, SARA, 1, 'One.');
    await upTo(id, 1);
    // The same version written again: a repeated delivery, or a server fix.
    await adminDb().doc(`boards/${id}/notes/current`).update({ updatedAt: ++clock });
    await stays('one version', async () => (await versions(id)).length === 1);
  });
});

describe('a clone', () => {
  it('copies the notes as text, with a first version saying where they came from', async () => {
    const src = freshBoard('bn_tmpl');
    await adminDb().doc(`boards/${src}`).set(board({ name: 'Program Template' }));
    await save(src, SARA, 1, 'Run-book: **book the hall** first.');
    await save(src, OMAR, 2, 'Run-book: **book the hall** first, then the caterer.');
    await upTo(src, 2);

    const cloneId = adminDb().collection('boards').doc().id;
    const res = await callFunction('cloneBoard', { boardId: src, name: 'Spring Program', cloneId }, await idTokenFor(SARA));
    expect(res.body.error).toBeUndefined();
    const notes = (await adminDb().doc(`boards/${cloneId}/notes/current`).get()).data();
    expect(notes).toMatchObject({ text: 'Run-book: **book the hall** first, then the caterer.', version: 1, updatedBy: SARA });
    const copied = await upTo(cloneId, 1);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({ id: '1', copiedFrom: 'Program Template', byName: 'Sara', by: SARA });
    // The trigger finds the version written and adds nothing of its own.
    await stays('one version on the clone', async () => (await versions(cloneId)).length === 1);
  });

  it('leaves a board without notes without them', async () => {
    const src = freshBoard('bn_plain');
    await adminDb().doc(`boards/${src}`).set(board({ name: 'Plain' }));
    const cloneId = adminDb().collection('boards').doc().id;
    const res = await callFunction('cloneBoard', { boardId: src, name: 'Plain copy', cloneId }, await idTokenFor(SARA));
    expect(res.body.error).toBeUndefined();
    await waitFor('the clone', async () => ((await adminDb().doc(`boards/${cloneId}`).get()).exists ? true : undefined));
    expect((await adminDb().doc(`boards/${cloneId}/notes/current`).get()).exists).toBe(false);
  });
});
