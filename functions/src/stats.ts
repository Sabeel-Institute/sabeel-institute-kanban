import './setup';
import { logger } from 'firebase-functions/v2';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { STATS_ALL_SCOPE, todayInOrgTz, UNKNOWN_ACTOR, type StatsDay } from '@sabeel/shared';
import { reportError } from './sentry';

/**
 * Usage counters for the Stats screen.
 *
 * Counting happens AS EVENTS HAPPEN rather than in a nightly sweep, for three
 * reasons. A sweep cannot see a file REMOVAL at all — the attachment document is
 * gone by midnight, so there is nothing left to scan. Counting on write also
 * means today's bucket is already correct, so there is no "compute the current
 * day live" path to build and no way for it to disagree with the stored history.
 * And the volume does not justify a job: the whole organisation generates on the
 * order of ten events a day.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE EXISTS TO ENFORCE: counting must never be able to damage,
 * block, or duplicate the thing it counts.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `recordStat` NEVER REJECTS. That is not defensive habit, it is load-bearing,
 * and the reason is specific to this codebase:
 *
 *   `guardedEvent` reports to Sentry and RETHROWS, so a throw inside a Firestore
 *   trigger makes Firebase retry the whole trigger. `onCardWritten` writes
 *   activity entries with GENERATED document ids, so a retry does not repair
 *   anything — it writes a second copy of every activity line on the card.
 *
 * So a failed counter must never propagate: riding along in the caller's batch,
 * or throwing out of it, would let a statistics bug corrupt a card's history or
 * fail a colleague's upload. It is called after the primary work has committed,
 * and it swallows its own failures.
 *
 * The trade is explicit and accepted: a failure here is a MISSED COUNT, never a
 * broken app. Sentry sees it, so drift is visible rather than silent, and
 * `scripts/backfill-stats.mjs` can rebuild any range from the source documents
 * — cards, comments, attachments and the activity log all still exist. The one
 * number that cannot be rebuilt is `bytesRemoved`: the activity log records that
 * a file was detached and its name, not its size.
 */

/** Retries for contention on the shared `_all` document — see `recordStat`. */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 40;

/** Firestore's contention/unavailability codes, which are worth another go. */
const RETRYABLE = new Set(['aborted', 'unavailable', 'deadline-exceeded', 10, 14, 4]);

function isRetryable(e: unknown): boolean {
  const code = (e as { code?: string | number })?.code;
  return code !== undefined && RETRYABLE.has(code);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Record one event's contribution to the daily counters.
 *
 * Writes the board's own bucket AND the org-wide `_all` bucket, so "all boards"
 * is a single read path rather than a fan-in over every board. When the delta
 * touches files, the running storage total on `stats/_all` moves in the same
 * batch — deriving the stock from the same numbers as the flows is what stops
 * the headline figure and the chart from ever disagreeing.
 *
 * @param boardId  The board the event belongs to.
 * @param at       When it happened, epoch ms. Bucketed by ORG timezone, not UTC.
 * @param delta    Counters to add. Absent keys are not written.
 * @param actorUid Who did it, unioned into the day's `actors` set.
 */
export async function recordStat(
  boardId: string,
  at: number,
  delta: Partial<StatsDay>,
  actorUid: string,
): Promise<void> {
  try {
    if (!boardId) return;

    // ORG timezone, deliberately. An event at 20:00 in Houston is 01:00 UTC the
    // NEXT day, so a UTC key would file most of an evening's work under
    // tomorrow — the same class of mistake that once put a due date a day out.
    const dayKey = todayInOrgTz(new Date(at));
    const month = dayKey.slice(0, 7);
    const dd = dayKey.slice(8, 10);

    // Sentinels are nested inside the day map rather than written as dotted
    // field paths: dotted paths are an `update()` feature, and `update()` fails
    // when the document does not exist yet. `set(..., { merge: true })` with a
    // nested object both creates the document and increments in place.
    const day: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(delta)) {
      if (typeof v === 'number' && v !== 0) day[k] = FieldValue.increment(v);
    }
    // A change nobody can be named for (a subtask unlinked by a deleted
    // parent) is somebody's work, but not a person to count.
    if (actorUid && actorUid !== UNKNOWN_ACTOR) day.actors = FieldValue.arrayUnion(actorUid);
    if (Object.keys(day).length === 0) return;

    const bytesStored = (delta.bytesAdded ?? 0) - (delta.bytesRemoved ?? 0);
    const filesStored = (delta.filesAdded ?? 0) - (delta.filesRemoved ?? 0);

    const db = getFirestore();
    for (let attempt = 1; ; attempt++) {
      try {
        const batch = db.batch();
        for (const scope of [boardId, STATS_ALL_SCOPE]) {
          batch.set(
            db.doc(`stats/${scope}/months/${month}`),
            { scope, month, days: { [dd]: day } },
            { merge: true },
          );
        }
        if (bytesStored !== 0 || filesStored !== 0) {
          batch.set(
            db.doc(`stats/${STATS_ALL_SCOPE}`),
            {
              bytesStored: FieldValue.increment(bytesStored),
              filesStored: FieldValue.increment(filesStored),
            },
            { merge: true },
          );
        }
        await batch.commit();
        return;
      } catch (e) {
        // Every event writes `_all`, and Firestore sustains about one write per
        // second to a single document. Steady state is nowhere near that, but
        // bursts exist — an import, or a label sweep touching many cards at
        // once — and they surface as ABORTED.
        if (attempt >= MAX_ATTEMPTS || !isRetryable(e)) throw e;
        await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
  } catch (e) {
    // The whole point of this file. See the header: throwing here would retry
    // the caller's trigger and duplicate its activity entries.
    logger.warn('stats not recorded', { boardId, error: String(e) });
    await reportError(e).catch(() => undefined);
  }
}
