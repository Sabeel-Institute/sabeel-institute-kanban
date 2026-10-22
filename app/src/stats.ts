/**
 * Reading the usage counters for the Stats screen.
 *
 * The whole screen is two subscriptions: a range of month documents for the
 * selected scope, and the org-wide root document holding the stored-bytes total.
 * Everything else — daily, weekly and monthly bucketing, and every metric —
 * is derived in memory from the same daily numbers by `@sabeel/shared`, so
 * switching bucketing or metric costs nothing and reads nothing.
 *
 * Live rather than a one-shot read, so today's bar moves as work happens. That
 * is free here: today's bucket is written as events occur, so there is no
 * "current day" computation on either side.
 */
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  where,
  documentId,
} from 'firebase/firestore';
import {
  STATS_ALL_SCOPE,
  monthKeysBetween,
  type StatsMonthDoc,
  type StatsRootDoc,
} from '@sabeel/shared';
import { db } from './firebase';
import { useLiveDoc, useLiveQuery, type LiveState } from './liveQuery';

/**
 * How far back the chart reaches. Bounded deliberately: the subscription costs
 * one document per month, and an unbounded range would grow every month forever
 * for a screen nobody scrolls back that far on. History is kept indefinitely —
 * this is only how much of it is loaded at once.
 */
export const STATS_MONTHS_BACK = 12;

/** The month documents for one scope, oldest first. */
export function useStatsMonths(
  scope: string,
  from: string,
  to: string,
): LiveState<StatsMonthDoc[]> {
  const months = monthKeysBetween(from, to);
  const first = months[0];
  const last = months[months.length - 1];
  return useLiveQuery<StatsMonthDoc[]>(
    () =>
      query(
        collection(db, `stats/${scope}/months`),
        // A document-id range, so no composite index is needed and `days` stays
        // exempt from indexing entirely (firestore.indexes.json).
        where(documentId(), '>=', first),
        where(documentId(), '<=', last),
        orderBy(documentId()),
      ),
    [scope, first, last],
    'stats months',
    (docs) =>
      docs.map((d) => ({
        scope,
        month: d.id,
        days: (d.data.days as StatsMonthDoc['days']) ?? {},
      })),
  );
}

/**
 * The org-wide stored-file totals.
 *
 * Always the `_all` scope, even when a single board is selected: storage is
 * charged to the organisation, not to a board, and the document holds no
 * per-board breakdown to show. The screen labels it accordingly.
 */
export function useStoredTotals(): LiveState<StatsRootDoc> {
  return useLiveDoc<StatsRootDoc>(
    () => doc(db, `stats/${STATS_ALL_SCOPE}`),
    [],
    'stats totals',
    (d) => ({
      bytesStored: (d?.data.bytesStored as number) ?? 0,
      filesStored: (d?.data.filesStored as number) ?? 0,
    }),
  );
}

// ---- Per-board breakdown of one bucket -------------------------------------

/**
 * Month documents for MANY scopes, read once on demand.
 *
 * A one-shot `getDocs` rather than a hook, and that is the right shape twice
 * over: it runs only when somebody selects a bar, and a breakdown that shifted
 * under the finger reading it would be worse than one a few seconds old. Search
 * reads the same way for the same reason.
 *
 * NOT a `collectionGroup('months')` query, which would be one round trip instead
 * of N — `scope` and `month` are denormalised onto every document precisely for
 * that shape. The rules nest `match /months/{month}` INSIDE `match
 * /stats/{scope}`, which does not authorize a collection-group read; it would
 * need a `match /{path=**}/months/{month}` recursive rule. Widening a rule to
 * save a round trip on an admin-only screen with under twenty boards is not a
 * trade worth making.
 *
 * SETTLES rather than rejecting: one unreadable scope must not blank a
 * breakdown that is otherwise correct, and a SHORT list rendered as if complete
 * is exactly the kind of quiet wrong this screen has been bitten by before. A
 * scope that failed is simply absent from the result — and since a scope that
 * SUCCEEDS always yields one document per month, an absent scope is exactly a
 * failed one, which is how the caller counts them without a tally riding along
 * that could disagree with the documents beside it.
 */
export async function fetchStatsMonths(
  scopes: readonly string[],
  months: readonly string[],
  /** Today's ORG-timezone day key, so the live month is never cached. */
  today: string,
): Promise<StatsMonthDoc[]> {
  if (scopes.length === 0 || months.length === 0) return [];

  const settled = await Promise.allSettled(
    scopes.map((scope) => fetchOneScope(scope, months, today)),
  );

  const docs: StatsMonthDoc[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') docs.push(...r.value);
  }
  return docs;
}

async function fetchOneScope(
  scope: string,
  months: readonly string[],
  today: string,
): Promise<StatsMonthDoc[]> {
  const wanted = [...months].sort();

  /**
   * Everything this call will answer with, resolved as it is learned.
   *
   * Owned here rather than read back out of the cache at the end, and that is
   * load-bearing twice over. `remember` deliberately refuses to store the month
   * in progress, so a result path that read back only from the cache threw away
   * the very documents it had just fetched — and every breakdown of a bar in
   * the current month came back empty. And the cache is SHARED and evicting:
   * every scope fans out at once, so a hit tested before the `await` can have
   * been evicted by a sibling scope's `remember` by the time it is read after
   * it, silently contributing a zero for a board that was not quiet.
   */
  const have = new Map<string, StatsMonthDoc>();
  const missing: string[] = [];
  for (const m of wanted) {
    const hit = monthCache.get(cacheKey(scope, m));
    if (hit === undefined) missing.push(m);
    else have.set(m, hit);
  }

  if (missing.length > 0) {
    // The same document-id range `useStatsMonths` uses, so no index is needed
    // and `days` stays exempt from indexing entirely. A bucket spans one or two
    // consecutive months, so the range is exact rather than over-wide.
    const snap = await getDocs(
      query(
        collection(db, `stats/${scope}/months`),
        where(documentId(), '>=', missing[0]),
        where(documentId(), '<=', missing[missing.length - 1]),
      ),
    );
    // EVERY document the range returned, not only the months that were missing.
    // When the gaps are not contiguous the range spans months already held, and
    // those documents are read and paid for either way — dropping them on the
    // floor is the one outcome with no upside.
    for (const d of snap.docs) {
      const doc: StatsMonthDoc = {
        scope,
        month: d.id,
        days: (d.data().days as StatsMonthDoc['days']) ?? {},
      };
      have.set(d.id, doc);
      remember(scope, d.id, today, doc);
    }
    for (const month of missing) {
      if (have.has(month)) continue;
      // An ABSENT document is a real answer — that board did nothing that month
      // — and caching it is what stops every quiet board being re-read on every
      // tap.
      const doc: StatsMonthDoc = { scope, month, days: {} };
      have.set(month, doc);
      remember(scope, month, today, doc);
    }
  }

  return wanted.map((m) => have.get(m) ?? { scope, month: m, days: {} });
}

/**
 * Month documents already read, keyed by scope and month.
 *
 * Module-level rather than component state, because the whole point of the
 * breakdown is that a row navigates to its board — which unmounts this screen
 * and would otherwise throw the reads away just as somebody presses Back.
 *
 * Bounded and cleared on sign-out, the two obligations the live-query cache
 * beside it already discovered: the keys contain board ids, so it would
 * otherwise grow for the life of the session, and on a shared device the next
 * person to sign in must not inherit the previous one's figures.
 */
const monthCache = new Map<string, StatsMonthDoc>();
const MAX_CACHED_MONTHS = 400;

const cacheKey = (scope: string, month: string) => `${scope}/${month}`;

function remember(scope: string, month: string, today: string, value: StatsMonthDoc) {
  // NEVER cache the month in progress. The chart is a live subscription
  // specifically so today's bar moves as work happens (see the note at the top
  // of this file); a frozen breakdown under a moving bar is the worst kind of
  // wrong, because neither number looks it.
  if (month === today.slice(0, 7)) return;

  const key = cacheKey(scope, month);
  if (monthCache.size >= MAX_CACHED_MONTHS) {
    const oldest = monthCache.keys().next().value;
    if (oldest !== undefined) monthCache.delete(oldest);
  }
  monthCache.delete(key);
  monthCache.set(key, value);
}

/** Drop every cached month. Called on sign-out, beside `clearLiveResultCache`. */
export function clearStatsCache(): void {
  monthCache.clear();
}
