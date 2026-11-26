import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { BOARD_NOTES_MAX, EMULATOR_PROJECT_ID } from '@sabeel/shared';
import { firestoreHostPort } from './emulatorHosts';

/**
 * A board's notes (`boards/{id}/notes/current`) and their history.
 *
 * Everyone on the board, and admins, read and write the page; nobody else
 * does. Every save names its writer and carries the version it started from
 * plus one, which is the whole of the concurrency story: of two saves over
 * the same version the second is refused. The history is the server's.
 *
 * Every denial is paired with a positive control: `assertFails` passes when
 * an operation fails for ANY reason.
 */
let env: RulesTestEnvironment;

function ctx(uid: string, role = 'member', status = 'active', kanbanMcp = false) {
  return env
    .authenticatedContext(uid, { email: `${uid}@oursabeel.com`, email_verified: true, role, status, kanbanMcp })
    .firestore();
}

const NOTES = 'boards/b1/notes/current';
let clock = 1_000_000;
const save = (uid: string, version: number, text = 'Forms and links', extra: Record<string, unknown> = {}) => ({
  text,
  version,
  updatedBy: uid,
  updatedAt: ++clock,
  ...extra,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: { rules: readFileSync('../firestore.rules', 'utf8'), ...firestoreHostPort() },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'boards/b1'), {
      name: 'Fundraising',
      memberUids: ['owner1', 'member1'],
      boardOwnerUids: ['owner1'],
      columns: [],
      columnIds: [],
      createdBy: 'owner1',
    });
  });
});

describe('who reads and writes a board’s notes', () => {
  it('lets a member who owns nothing write them, the version starting at 1', async () => {
    await assertFails(setDoc(doc(ctx('member1'), NOTES), save('member1', 2)));
    await assertSucceeds(setDoc(doc(ctx('member1'), NOTES), save('member1', 1)));
    await assertSucceeds(getDoc(doc(ctx('member1'), NOTES)));
  });

  it('lets an admin who is not on the board read and write them, as admins see every board', async () => {
    await assertSucceeds(setDoc(doc(ctx('admin1', 'admin'), NOTES), save('admin1', 1)));
    await assertSucceeds(getDoc(doc(ctx('admin1', 'admin'), NOTES)));
  });

  it('keeps out anyone not on the board, an organizer included, and anyone not yet approved', async () => {
    await assertSucceeds(setDoc(doc(ctx('member1'), NOTES), save('member1', 1)));
    await assertFails(getDoc(doc(ctx('stranger'), NOTES)));
    await assertFails(setDoc(doc(ctx('stranger'), NOTES), save('stranger', 2)));
    await assertFails(getDoc(doc(ctx('org1', 'organizer'), NOTES)));
    await assertFails(getDoc(doc(ctx('member1', 'member', 'pending'), NOTES)));
  });

  it('writes the one notes document, and never deletes it', async () => {
    await assertFails(setDoc(doc(ctx('member1'), 'boards/b1/notes/other'), save('member1', 1)));
    await assertSucceeds(setDoc(doc(ctx('member1'), NOTES), save('member1', 1)));
    await assertFails(deleteDoc(doc(ctx('owner1'), NOTES)));
    await assertFails(deleteDoc(doc(ctx('admin1', 'admin'), NOTES)));
  });
});

describe('a save', () => {
  beforeEach(async () => {
    await assertSucceeds(setDoc(doc(ctx('owner1'), NOTES), save('owner1', 1)));
  });

  it('is refused over any version but the one it started from', async () => {
    await assertFails(setDoc(doc(ctx('member1'), NOTES), save('member1', 1, 'over it')));
    await assertFails(setDoc(doc(ctx('member1'), NOTES), save('member1', 3, 'skipping one')));
    await assertSucceeds(setDoc(doc(ctx('member1'), NOTES), save('member1', 2, 'mine')));
    // The second of two saves over version 1 is refused: the conflict.
    await assertFails(setDoc(doc(ctx('owner1'), NOTES), save('owner1', 2, 'theirs')));
    await assertSucceeds(setDoc(doc(ctx('owner1'), NOTES), save('owner1', 3, 'theirs, on top')));
  });

  it('names its writer and nobody else', async () => {
    await assertFails(setDoc(doc(ctx('member1'), NOTES), save('owner1', 2)));
    await assertFails(updateDoc(doc(ctx('member1'), NOTES), { text: 'no stamp', version: 2 }));
    await assertSucceeds(setDoc(doc(ctx('member1'), NOTES), save('member1', 2)));
  });

  it(`is at most ${BOARD_NOTES_MAX} characters`, async () => {
    await assertFails(setDoc(doc(ctx('member1'), NOTES), save('member1', 2, 'x'.repeat(BOARD_NOTES_MAX + 1))));
    await assertSucceeds(setDoc(doc(ctx('member1'), NOTES), save('member1', 2, 'x'.repeat(BOARD_NOTES_MAX))));
  });

  it('may empty the notes', async () => {
    await assertSucceeds(setDoc(doc(ctx('member1'), NOTES), save('member1', 2, '')));
  });

  it('carries only the page’s fields', async () => {
    await assertFails(setDoc(doc(ctx('member1'), NOTES), save('member1', 2, 'x', { pinned: true })));
    await assertFails(setDoc(doc(ctx('member1'), NOTES), save('member1', 2, 'x', { restoredFrom: 7 })));
    await assertSucceeds(setDoc(doc(ctx('member1'), NOTES), save('member1', 2, 'x', { restoredFrom: '1' })));
  });

  it('is marked as an agent’s only from an agent session, at its own stamp', async () => {
    const at = ++clock;
    const agentSave = { text: 'via an agent', version: 2, updatedBy: 'member1', updatedAt: at, agentAt: at };
    await assertFails(setDoc(doc(ctx('member1'), NOTES), agentSave));
    await assertFails(setDoc(doc(ctx('member1', 'member', 'active', true), NOTES), { ...agentSave, agentAt: at - 1 }));
    await assertSucceeds(setDoc(doc(ctx('member1', 'member', 'active', true), NOTES), agentSave));
  });
});

describe('the history', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), `${NOTES}/versions/1`), { text: 'a', version: 1, by: 'owner1', at: 1, startedAt: 1, summary: 'x' });
    });
  });

  it('is read by everyone who reads the notes', async () => {
    await assertSucceeds(getDocs(collection(ctx('member1'), `${NOTES}/versions`)));
    await assertSucceeds(getDocs(collection(ctx('admin1', 'admin'), `${NOTES}/versions`)));
    await assertFails(getDocs(collection(ctx('stranger'), `${NOTES}/versions`)));
  });

  it('is written by the server alone, so no client can forge or rewrite a version', async () => {
    const forged = { text: 'b', version: 2, by: 'member1', at: 2, startedAt: 2, summary: 'y' };
    await assertFails(setDoc(doc(ctx('member1'), `${NOTES}/versions/2`), forged));
    await assertFails(setDoc(doc(ctx('admin1', 'admin'), `${NOTES}/versions/2`), forged));
    await assertFails(updateDoc(doc(ctx('owner1'), `${NOTES}/versions/1`), { byName: 'Someone else' }));
    await assertFails(deleteDoc(doc(ctx('admin1', 'admin'), `${NOTES}/versions/1`)));
  });
});

describe('the notes panel preference', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'users/member1'), { role: 'member', status: 'active' });
    });
  });

  it('is the person’s own to set, a bounded list', async () => {
    await assertSucceeds(updateDoc(doc(ctx('member1'), 'users/member1'), { notesOpenBoardIds: ['b1'] }));
    await assertFails(updateDoc(doc(ctx('member1'), 'users/member1'), { notesOpenBoardIds: 'b1' }));
    await assertFails(
      updateDoc(doc(ctx('member1'), 'users/member1'), { notesOpenBoardIds: Array.from({ length: 501 }, (_, i) => `b${i}`) }),
    );
    await assertFails(updateDoc(doc(ctx('owner1'), 'users/member1'), { notesOpenBoardIds: ['b1'] }));
  });
});
