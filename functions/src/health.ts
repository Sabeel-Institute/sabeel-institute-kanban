import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, ORG_TIMEZONE } from '@sabeel/shared';
import {
  finishCheckIn,
  reportError,
  reportMessage,
  sentryDsn,
  startCheckIn,
} from './sentry';

/**
 * The anomaly canary.
 *
 * Backups retain 98 days and PITR covers the last 7, but retention only helps if
 * the problem is NOTICED while a good backup still exists. The bad case is a
 * corruption just before a quiet period — every later backup faithfully captures
 * the already-broken state, and by the time anyone looks the last good one has
 * aged out. Extending retention is the expensive lever; noticing sooner is the
 * cheap one, and 98 days is generous if detection takes days.
 *
 * So once a day this counts documents per collection, compares against the
 * previous run, and raises to Sentry when a count drops more than that collection
 * tolerates. It also sends a Sentry cron check-in, so the job going SILENT is
 * itself an alert — a job that never runs never reports its own failure.
 *
 * Deliberately not a UI feature: "cards fell 40%" is an operator signal, not
 * something an admin inside the app can act on.
 */

/**
 * Daily at 03:15 in the ORG timezone — quiet hours, and well clear of the 08:00
 * `dueSoonReminders` run. Firestore's daily backup window is not configurable, so
 * this cannot be aligned against it; nothing here depends on that ordering.
 *
 * The zone is ORG_TIMEZONE, not a second copy of it. It was hardcoded here, and
 * when the org zone moved this one silently did not — at which point "well clear
 * of the 08:00 run" was reasoning across two different clocks and no longer
 * meant anything.
 */
const HEALTH_SCHEDULE = '15 3 * * *';
const HEALTH_TIMEZONE = ORG_TIMEZONE;
const MONITOR_SLUG = 'firestore-health';

/**
 * Operator state, not app data. `firestore.rules` ends with a catch-all
 * `match /{document=**} { allow read, write: if false; }`, so no client can read
 * or write this — the Admin SDK bypasses rules entirely. A rules test pins that.
 */
const HEALTH_DOC = 'meta/health';

/**
 * How much of a drop each collection tolerates between runs.
 *
 * `zeroTolerance` — any decrease at all is suspicious, because the rules forbid
 * the deletion outright or it takes a deliberate admin action:
 *  - `boards`  — `allow delete: if false`; boards archive, never hard-delete.
 *  - `activity` — `allow create, update, delete: if false`; trigger-written only.
 *  - `users`   — removed only by a deliberate Admin-SDK operation.
 *
 * The rest shrink in normal use (board owners delete cards, authors delete comments,
 * people clear their notifications), so they alert on a drop bigger than
 * `max(minDrop, fraction × previous)`. The floor stops a tiny dataset alerting on
 * routine tidying; the fraction keeps it meaningful as the data grows.
 */
interface DropRule {
  zeroTolerance?: boolean;
  minDrop?: number;
  fraction?: number;
}
const DROP_RULES: Record<string, DropRule> = {
  boards: { zeroTolerance: true },
  activity: { zeroTolerance: true },
  users: { zeroTolerance: true },
  cards: { minDrop: 5, fraction: 0.2 },
  comments: { minDrop: 5, fraction: 0.2 },
  // Deliberately tolerant, and stated rather than left to the default: ANY board
  // member may remove an attachment, and the nightly sweep clears abandoned
  // uploads, so attachments disappearing is ordinary rather than alarming.
  // zeroTolerance here would page on normal use.
  attachments: { minDrop: 5, fraction: 0.2 },
  notifications: { minDrop: 5, fraction: 0.2 },
  // Tolerant on purpose, like attachments. Labels are meant to be CURATED, by
  // admins for the institute's and by anyone on a board for its own, so a normal
  // tidy-up in one sitting must not page anyone. Losing the whole set still would.
  labels: { minDrop: 8, fraction: 0.34 },
};

export type Counts = Record<string, number>;

export interface Finding {
  collection: string;
  previous: number;
  current: number;
  dropped: number;
  /** The drop that would have been tolerated for this collection. */
  allowed: number;
}

/**
 * Pure comparison — no I/O, so the alerting policy is exhaustively unit-testable.
 * Returns one finding per collection whose drop exceeds its tolerance. A missing
 * previous count (first ever run, or a newly added collection) yields nothing:
 * there is no baseline to judge against, and inventing one would cry wolf.
 */
export function evaluateCounts(previous: Counts | null, current: Counts): Finding[] {
  if (!previous) return [];
  const findings: Finding[] = [];
  for (const [collection, now] of Object.entries(current)) {
    const before = previous[collection];
    if (typeof before !== 'number') continue;
    const dropped = before - now;
    if (dropped <= 0) continue;

    const rule = DROP_RULES[collection] ?? { minDrop: 5, fraction: 0.2 };
    const allowed = rule.zeroTolerance
      ? 0
      : Math.max(rule.minDrop ?? 5, Math.floor(before * (rule.fraction ?? 0.2)));
    if (dropped > allowed) {
      findings.push({ collection, previous: before, current: now, dropped, allowed });
    }
  }
  return findings;
}

/**
 * Count documents per collection using the count() aggregation — one cheap
 * aggregation query each, never a full document read (billed roughly one read per
 * 1000 documents, so watching the whole database costs almost nothing).
 *
 * Subcollections (`comments`, `activity`, `notifications`) MUST go through
 * `collectionGroup`. Using `collection('comments')` would silently count a
 * non-existent top-level path and return 0 forever — a canary reporting perfect
 * health while seeing nothing at all.
 */
async function currentCounts(): Promise<Counts> {
  const db = getFirestore();
  const counts: Counts = {};
  await Promise.all(
    Object.entries(COLLECTIONS).map(async ([name, kind]) => {
      const query = kind === 'group' ? db.collectionGroup(name) : db.collection(name);
      const snap = await query.count().get();
      counts[name] = snap.data().count;
    }),
  );
  return counts;
}

/**
 * Core of the canary, callable directly so integration tests can drive it against
 * the emulators — scheduled functions themselves never fire there (there is no
 * pubsub emulator), so the body cannot live inside the `onSchedule` handler.
 *
 * Reads the previous snapshot, counts, compares, stores the new snapshot, and
 * returns what it found.
 */
export async function runHealthCheck(now: number): Promise<{
  counts: Counts;
  findings: Finding[];
}> {
  const db = getFirestore();
  const ref = db.doc(HEALTH_DOC);
  const prevSnap = await ref.get();
  const previous = prevSnap.exists ? ((prevSnap.data()?.counts as Counts) ?? null) : null;

  const counts = await currentCounts();
  const findings = evaluateCounts(previous, counts);

  // Always record the new baseline — including when something looked wrong.
  // Otherwise a single bad day would re-alert forever against a frozen baseline.
  await ref.set({ checkedAt: now, counts, previousCounts: previous ?? null });

  return { counts, findings };
}

export const healthCheck = onSchedule(
  { schedule: HEALTH_SCHEDULE, timeZone: HEALTH_TIMEZONE, secrets: [sentryDsn] },
  async () => {
    const checkInId = startCheckIn(MONITOR_SLUG, HEALTH_SCHEDULE, HEALTH_TIMEZONE);
    try {
      const { counts, findings } = await runHealthCheck(Date.now());
      if (findings.length > 0) {
        await reportMessage(
          `Firestore health: ${findings.length} collection(s) shrank unexpectedly`,
          { findings, counts },
        );
      }
      console.log(
        `healthCheck: ${JSON.stringify(counts)}` +
          `${findings.length ? ` — ${findings.length} finding(s)` : ''}`,
      );
      await finishCheckIn(checkInId, MONITOR_SLUG, 'ok', HEALTH_SCHEDULE, HEALTH_TIMEZONE);
    } catch (e) {
      await reportError(e);
      await finishCheckIn(checkInId, MONITOR_SLUG, 'error', HEALTH_SCHEDULE, HEALTH_TIMEZONE);
      throw e;
    }
  },
);
