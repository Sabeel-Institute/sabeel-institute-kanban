import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { STATS_ALL_SCOPE, todayInOrgTz, UNKNOWN_ACTOR } from '@sabeel/shared';
import { recordStat } from '../../src/stats';
import { adminDb, makeUser, shutdown, waitFor } from './emulatorClient';

// Unique ids — the emulator is shared across the suites in one `emulators:exec`.
const MGR = 'st_mgr';
const B1 = 'st_b1';

/** 20:00 on 28 July in Houston, which is 01:00 on the 29th in UTC. */
const EVENING_IN_HOUSTON = Date.UTC(2026, 6, 29, 1, 0, 0);
/** Any mid-afternoon instant, where UTC and org-local agree on the date. */
const MIDDAY = Date.UTC(2026, 6, 28, 18, 0, 0);

const bucket = async (scope: string, month: string, dd: string) => {
  const snap = await adminDb().doc(`stats/${scope}/months/${month}`).get();
  return snap.data()?.days?.[dd] ?? {};
};

const board = () => ({
  name: 'Counting',
  description: '',
  archived: false,
  columns: [{ id: 'c1', name: 'To Do' }],
  columnIds: ['c1'],
  memberUids: [MGR],
  memberProfiles: {},
  activeCardCount: 0,
  createdAt: 1,
  createdBy: MGR,
});

const card = (over: Record<string, unknown> = {}) => ({
  boardId: B1,
  title: 'x',
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
  await makeUser({
    uid: MGR,
    email: `${MGR}@oursabeel.com`,
    role: 'organizer',
    status: 'active',
  });
  await adminDb().doc(`boards/${B1}`).set(board());
});

afterAll(async () => {
  await shutdown();
});

describe('recordStat', () => {
  it('creates the bucket and then increments it in place', async () => {
    // The mechanism check. Sentinels are nested inside the `days` map rather
    // than written as dotted field paths — dotted paths only work with
    // `update()`, which fails when the document does not exist yet. If the
    // nested form silently overwrote instead of incrementing, this would be 1.
    const scope = 'st_inc';
    await recordStat(scope, MIDDAY, { comments: 1 }, 'u1');
    await recordStat(scope, MIDDAY, { comments: 1 }, 'u1');
    expect((await bucket(scope, '2026-07', '28')).comments).toBe(2);
  });

  it('writes the board bucket AND the org-wide roll-up', async () => {
    const scope = 'st_fanout';
    await recordStat(scope, MIDDAY, { cardsCreated: 1 }, 'u1');

    expect((await bucket(scope, '2026-07', '28')).cardsCreated).toBe(1);
    // Without this, "All boards" would have to fan in over every board.
    const all = await bucket(STATS_ALL_SCOPE, '2026-07', '28');
    expect(all.cardsCreated).toBeGreaterThanOrEqual(1);
  });

  it('records the day in the ORG timezone, not UTC', async () => {
    // 20:00 in Houston. Filed under UTC this would land on the 29th, moving an
    // evening's work into tomorrow — and, at a month end, into the wrong month.
    const scope = 'st_tz';
    await recordStat(scope, EVENING_IN_HOUSTON, { comments: 1 }, 'u1');

    expect((await bucket(scope, '2026-07', '28')).comments).toBe(1);
    expect((await bucket(scope, '2026-07', '29')).comments).toBeUndefined();
  });

  it('counts a person once a day however often they act, and both people once each', async () => {
    const scope = 'st_actors';
    await recordStat(scope, MIDDAY, { comments: 1 }, 'ann');
    await recordStat(scope, MIDDAY, { comments: 1 }, 'ann');
    await recordStat(scope, MIDDAY, { comments: 1 }, 'bo');

    const day = await bucket(scope, '2026-07', '28');
    expect([...day.actors].sort()).toEqual(['ann', 'bo']);
    expect(day.comments).toBe(3); // the comments still all count
  });

  it('moves the stored-bytes total with the file deltas, and back again', async () => {
    const before = (await adminDb().doc(`stats/${STATS_ALL_SCOPE}`).get()).data() ?? {};
    const bytes0 = before.bytesStored ?? 0;
    const files0 = before.filesStored ?? 0;

    await recordStat('st_stock', MIDDAY, { filesAdded: 1, bytesAdded: 500 }, 'u1');
    let root = (await adminDb().doc(`stats/${STATS_ALL_SCOPE}`).get()).data()!;
    expect(root.bytesStored).toBe(bytes0 + 500);
    expect(root.filesStored).toBe(files0 + 1);

    await recordStat('st_stock', MIDDAY, { filesRemoved: 1, bytesRemoved: 500 }, 'u1');
    root = (await adminDb().doc(`stats/${STATS_ALL_SCOPE}`).get()).data()!;
    // The stock is derived from the same numbers as the flows, so removing what
    // was added must land exactly back where it started.
    expect(root.bytesStored).toBe(bytes0);
    expect(root.filesStored).toBe(files0);
  });

  it('NEVER REJECTS when the write fails', async () => {
    // The guarantee the whole file exists for. `guardedEvent` rethrows, so a
    // throw here would retry the caller's trigger — and `onCardWritten` writes
    // activity docs with generated ids, so a retry DUPLICATES the card's
    // history. A statistics failure must never reach the caller.
    //
    // A scope containing a slash makes the document path odd-segmented, which
    // the Admin SDK rejects outright — a real failure, not a stubbed one.
    await expect(recordStat('bad/scope', MIDDAY, { comments: 1 }, 'u1')).resolves.toBeUndefined();
  });

  it('writes nothing at all when there is no board', async () => {
    await expect(recordStat('', MIDDAY, { comments: 1 }, 'u1')).resolves.toBeUndefined();
  });

  it('never counts a change nobody can be named for as a person', async () => {
    const scope = 'st_unknown';
    await recordStat(scope, MIDDAY, { comments: 1 }, UNKNOWN_ACTOR);
    const day = await bucket(scope, '2026-07', '28');
    expect(day.comments).toBe(1);
    expect(day.actors).toBeUndefined();
  });

  it('skips zero deltas but still records the actor', async () => {
    const scope = 'st_zero';
    await recordStat(scope, MIDDAY, { comments: 0 }, 'ann');
    const day = await bucket(scope, '2026-07', '28');
    expect(day.comments).toBeUndefined();
    expect(day.actors).toEqual(['ann']);
  });
});

describe('stats triggers', () => {
  /**
   * Triggers bucket on the SERVER's today, not on the timestamps in the fixture.
   *
   * These once asserted against a hardcoded '2026-07' / '28' and were green only
   * because that happened to be the day they were written — they would have gone
   * red every day after, looking exactly like a broken feature. The day key has
   * to come from the same helper the code uses.
   */
  const TODAY = todayInOrgTz();
  const todayBucket = (scope: string) =>
    bucket(scope, TODAY.slice(0, 7), TODAY.slice(8, 10));

  const waitBucket = (scope: string, field: string, want: number) =>
    waitFor(`stats ${scope} ${TODAY}.${field} == ${want}`, async () => {
      const day = await todayBucket(scope);
      return (day[field] ?? 0) === want ? true : undefined;
    });

  it('counts a created card on the board and the roll-up', async () => {
    // Through the DEPLOYED trigger, not the extracted helper — the wiring is
    // the thing that can be wrong.
    const scope = 'st_trig_b';
    await adminDb().doc(`boards/${scope}`).set(board());
    await adminDb()
      .doc('cards/st_trig_c1')
      .set(card({ boardId: scope, createdAt: MIDDAY, updatedAt: MIDDAY }));

    await waitBucket(scope, 'cardsCreated', 1);
  });

  it('counts an archive, and does not count the restore as one', async () => {
    const scope = 'st_trig_b2';
    await adminDb().doc(`boards/${scope}`).set(board());
    await adminDb()
      .doc('cards/st_trig_c2')
      .set(card({ boardId: scope, createdAt: MIDDAY, updatedAt: MIDDAY }));
    await waitBucket(scope, 'cardsCreated', 1);

    await adminDb()
      .doc('cards/st_trig_c2')
      .update({ archived: true, updatedAt: MIDDAY, updatedBy: MGR });
    await waitBucket(scope, 'cardsArchived', 1);

    await adminDb()
      .doc('cards/st_trig_c2')
      .update({ archived: false, updatedAt: MIDDAY, updatedBy: MGR });
    // Restoring is not archiving. If the trigger keyed off "the archived field
    // changed" rather than "changed TO true", this would now be 2.
    await new Promise((r) => setTimeout(r, 1500));
    expect((await todayBucket(scope)).cardsArchived).toBe(1);
  });

  it('survives a burst without duplicating history', async () => {
    // The contention check. Every event writes the shared `_all` document, and
    // Firestore sustains about one write per second to a single document —
    // fine at ~8 events a day, but bursts exist: the ClickUp import created 27
    // cards at once, and a label sweep updates cards in batches of up to 500.
    //
    // What must NEVER happen is a counter failure propagating: `guardedEvent`
    // rethrows, so a throw would retry `onCardWritten`, which writes activity
    // with generated ids — producing a SECOND copy of the card's history. The
    // assertion below is therefore about the activity log, not the counters.
    const scope = 'st_burst_b';
    const N = 30;
    await adminDb().doc(`boards/${scope}`).set(board());

    const batch = adminDb().batch();
    for (let i = 0; i < N; i++) {
      batch.set(
        adminDb().doc(`cards/st_burst_${i}`),
        card({ boardId: scope, createdAt: MIDDAY, updatedAt: MIDDAY }),
      );
    }
    await batch.commit();

    await waitBucket(scope, 'cardsCreated', N);

    // Exactly one `created` line per card. More than one means a trigger was
    // retried and the card's history was duplicated — the failure this whole
    // design is arranged to prevent.
    const perCard = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        const snap = await adminDb().collection(`cards/st_burst_${i}/activity`).get();
        return snap.docs.filter((d) => d.data().type === 'created').length;
      }),
    );
    expect(perCard).toEqual(Array.from({ length: N }, () => 1));
  });

  it('counts a comment on SERVER time, whatever the client claims', async () => {
    // `createdAt` is client-supplied and rules never constrain its value, so
    // bucketing on it would let a caller put the count on any day it named —
    // and address any month document it named, `stats/{board}/months/9999-12`
    // included. The count belongs to the day the server saw it.
    const scope = 'st_trig_spoof';
    await adminDb().doc(`boards/${scope}`).set(board());
    await adminDb()
      .doc('cards/st_trig_spoof_c')
      .set(card({ boardId: scope, createdAt: MIDDAY, updatedAt: MIDDAY }));
    await adminDb().doc('cards/st_trig_spoof_c/comments/cm1').set({
      authorUid: MGR,
      body: 'from the future',
      mentionUids: [],
      createdAt: Date.UTC(2099, 0, 1),
    });

    await waitBucket(scope, 'comments', 1);
    // And nothing was written under the claimed year.
    const bogus = await adminDb().doc(`stats/${scope}/months/2099-01`).get();
    expect(bogus.exists).toBe(false);
  });

  it('counts a comment', async () => {
    const scope = 'st_trig_b3';
    await adminDb().doc(`boards/${scope}`).set(board());
    await adminDb()
      .doc('cards/st_trig_c3')
      .set(card({ boardId: scope, createdAt: MIDDAY, updatedAt: MIDDAY }));
    await adminDb().doc('cards/st_trig_c3/comments/cm1').set({
      authorUid: MGR,
      body: 'hello',
      mentionUids: [],
      createdAt: MIDDAY,
    });

    await waitBucket(scope, 'comments', 1);
  });
});
