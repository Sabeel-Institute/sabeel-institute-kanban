import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { adminDb, shutdown } from './emulatorClient';
import { runHealthCheck } from '../../src/health';

/**
 * The canary against a real database. The POLICY is unit-tested (test/unit/
 * health.test.ts); what needs an emulator is the part that cannot be reasoned
 * about — that the aggregation queries actually find the documents, that
 * subcollections are reached via collectionGroup, and that the baseline doc is
 * written and re-read.
 *
 * The scheduled function itself never runs here: there is no pubsub emulator
 * (docs/DEV-TOOLING.md), which is exactly why the body lives in `runHealthCheck`.
 *
 * Counts include whatever the other suites left behind — the emulator is shared
 * within one `emulators:exec` run — so every assertion is about a DELTA this test
 * causes, never an absolute total.
 */
const B1 = 'hc_b1';
const C1 = 'hc_c1';

const board = () => ({
  name: 'Health',
  description: '',
  archived: false,
  columns: [{ id: 'c1', name: 'To Do' }],
  columnIds: ['c1'],
  memberUids: ['hc_mgr'],
  memberProfiles: {},
  activeCardCount: 0,
  createdAt: 1,
  createdBy: 'hc_mgr',
});

beforeAll(async () => {
  await adminDb().doc(`boards/${B1}`).set(board());
  await adminDb()
    .doc(`cards/${C1}`)
    .set({
      boardId: B1,
      title: 'Counted',
      description: '',
      columnId: 'c1',
      rank: 'V',
      assigneeUids: [],
      priority: 'none',
      labelIds: [],
      archived: false,
      commentCount: 0,
      createdAt: 1,
      createdBy: 'hc_mgr',
      updatedAt: 1,
      updatedBy: 'hc_mgr',
    });
  // Subcollections — the whole reason collectionGroup matters.
  await adminDb()
    .doc(`cards/${C1}/comments/hc_cm1`)
    .set({ body: 'hi', authorUid: 'hc_mgr', createdAt: 1 });
  await adminDb()
    .doc(`cards/${C1}/activity/hc_a1`)
    .set({ kind: 'created', actorUid: 'hc_mgr', at: 1 });
});

afterAll(async () => {
  await shutdown();
});

describe('runHealthCheck', () => {
  it('counts subcollections via collectionGroup, not a bare top-level path', async () => {
    // The failure this pins: `collection('comments')` would query a non-existent
    // top-level path, return 0 forever, and report perfect health while blind.
    const { counts } = await runHealthCheck(1000);
    expect(counts.comments).toBeGreaterThan(0);
    expect(counts.activity).toBeGreaterThan(0);
    // And the top-level ones still work.
    expect(counts.boards).toBeGreaterThan(0);
    expect(counts.cards).toBeGreaterThan(0);
  });

  it('stores the baseline, and says nothing on a run with no previous counts', async () => {
    // Wipe the baseline so this run is genuinely the "first ever" case.
    await adminDb().doc('meta/health').delete();

    const { findings, counts } = await runHealthCheck(2000);
    expect(findings).toEqual([]);

    const stored = await adminDb().doc('meta/health').get();
    expect(stored.exists).toBe(true);
    expect(stored.data()?.checkedAt).toBe(2000);
    expect(stored.data()?.counts).toEqual(counts);
    expect(stored.data()?.previousCounts).toBeNull();
  });

  it('flags a zero-tolerance drop, then RE-BASELINES so it alerts once', async () => {
    // Baseline is in place from the previous test. Delete one board: boards are
    // `allow delete: if false` in the rules, so any drop at all is a signal.
    await adminDb().doc(`boards/${B1}`).delete();

    const first = await runHealthCheck(3000);
    const boardFinding = first.findings.find((f) => f.collection === 'boards');
    expect(boardFinding).toBeDefined();
    expect(boardFinding).toMatchObject({ dropped: 1, allowed: 0 });

    // The re-baseline is the point: without it, one bad day alerts forever
    // against a frozen baseline.
    const second = await runHealthCheck(4000);
    expect(second.findings).toEqual([]);
    const stored = await adminDb().doc('meta/health').get();
    expect(stored.data()?.previousCounts.boards).toBe(first.counts.boards);
  });
});
