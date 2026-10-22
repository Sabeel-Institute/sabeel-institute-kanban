import * as Sentry from '@sentry/node';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

/**
 * Error reporting for Cloud Functions.
 *
 * Ported from the sibling time tracker deliberately — the same three properties
 * are what make it useful there, and each is easy to get wrong:
 *
 *  1. The DSN is a **Secret Manager secret**, not an env var in the repo. Bind
 *     it with `secrets: [sentryDsn]` on any function whose failures matter.
 *  2. `HttpsError` is EXCLUDED. Those are expected domain outcomes —
 *     unauthenticated, permission-denied, invalid-argument — and they already
 *     reach the caller. Reporting them would bury real defects under a stream of
 *     people mistyping things.
 *  3. Events are **flushed before returning**. A serverless instance can be
 *     frozen the moment the handler resolves, so an unflushed event may never
 *     leave the machine. This is the one that fails silently in production and
 *     looks like "Sentry isn't working".
 */
export const sentryDsn = defineSecret('SENTRY_DSN');

let initialised = false;

/**
 * Initialise once, lazily, from a DSN supplied at call time, with the same
 * settings as the LMS's and the time tracker's functions.
 *
 * `dataCollection` keeps people out of the events: no user fields, cookies or
 * HTTP bodies, and no header or query parameter that names a client address
 * (`forwarded`, `*-ip`, `remote-*`, `via`, `*-user`).
 */
function ensureSentry(dsn: string | undefined): boolean {
  if (initialised) return true;
  // A real DSN is an https URL. Anything else — unset, or the `disabled`
  // placeholder ci-tools writes into functions/.secret.local for the
  // emulators — leaves reporting off without letting a bad value reach
  // Sentry.init.
  if (!dsn || !dsn.startsWith('https://')) return false;
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
        response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
      },
      httpBodies: [],
      urlQueryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
    },
  });
  initialised = true;
  return true;
}

/** Report an UNEXPECTED error. Expected HttpsErrors are not defects. */
export async function reportError(e: unknown): Promise<void> {
  if (e instanceof HttpsError) return;
  if (ensureSentry(process.env.SENTRY_DSN)) {
    Sentry.captureException(e);
    await Sentry.flush(2000).catch(() => undefined);
  }
}

/**
 * Report something WRONG that did not throw.
 *
 * The canary spotting that document counts dropped is not an error — nothing
 * failed — so `captureException` would be misleading and would carry a stack
 * pointing at the reporting code rather than the problem. This raises a message
 * at error level with the structured findings attached instead.
 */
export async function reportMessage(
  message: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  if (ensureSentry(process.env.SENTRY_DSN)) {
    Sentry.captureMessage(message, { level: 'error', extra: context });
    await Sentry.flush(2000).catch(() => undefined);
  }
}

/**
 * Cron check-ins for a scheduled job.
 *
 * Sentry alerts when a check-in does NOT arrive on schedule, which is the only
 * way to notice a job that has silently stopped running — a job that never runs
 * also never reports its own failure. The monitor config travels with each
 * check-in, which upserts the monitor, so there is no console setup step to
 * forget.
 *
 * Two-phase by design: `start` opens the check-in and `finish` closes it, which
 * also tells Sentry how long the run took.
 */
function monitorConfig(schedule: string, timezone: string) {
  return {
    schedule: { type: 'crontab' as const, value: schedule },
    // NOT optional in practice. Sentry defaults a monitor's timezone to UTC, and
    // the crontab above is the one handed to Cloud Scheduler, which runs it in
    // the ORG timezone. Omitting this made Sentry expect 03:15 UTC while the job
    // checked in at 07:15 UTC — outside the margin below, so the monitor
    // reported MISSED every single day and the real check-in landed nowhere near
    // its window. A canary that cries wolf daily is worse than no canary: you
    // stop reading it, which is exactly when it has something to say.
    timezone,
    // Generous margins: a cold start or a slow aggregation must not page anyone.
    checkinMargin: 60,
    maxRuntime: 10,
  };
}

/** Returns a check-in id to pass to `finishCheckIn`, or null if Sentry is off. */
export function startCheckIn(
  monitorSlug: string,
  schedule: string,
  timezone: string,
): string | null {
  if (!ensureSentry(process.env.SENTRY_DSN)) return null;
  return Sentry.captureCheckIn(
    { monitorSlug, status: 'in_progress' },
    monitorConfig(schedule, timezone),
  );
}

export async function finishCheckIn(
  checkInId: string | null,
  monitorSlug: string,
  status: 'ok' | 'error',
  schedule: string,
  timezone: string,
): Promise<void> {
  if (!checkInId) return;
  Sentry.captureCheckIn({ checkInId, monitorSlug, status }, monitorConfig(schedule, timezone));
  await Sentry.flush(2000).catch(() => undefined);
}

/**
 * Wrap a BACKGROUND TRIGGER: failures reach Sentry, then rethrow.
 *
 * Triggers need this more than callables do, not less. A callable that fails
 * tells the person who called it; a trigger fails into the logs, where nobody
 * is looking. The notification, activity and provisioning triggers were all
 * unwrapped — a comment silently failing to notify anyone would have produced
 * no user-visible symptom and no alert.
 *
 * Rethrows so the platform still records the failure. Any function using this
 * must bind `secrets: [sentryDsn]` or the DSN is not in its environment and
 * reporting silently no-ops.
 */
export function guardedEvent<T>(
  fn: (event: T) => Promise<void>,
): (event: T) => Promise<void> {
  return async (event) => {
    try {
      await fn(event);
    } catch (e) {
      await reportError(e);
      throw e;
    }
  };
}

/** Wrap a callable handler: unexpected failures reach Sentry, then rethrow. */
export function guarded<Req, Res>(
  fn: (req: CallableRequest<Req>) => Promise<Res>,
): (req: CallableRequest<Req>) => Promise<Res> {
  return async (req) => {
    try {
      return await fn(req);
    } catch (e) {
      await reportError(e);
      throw e;
    }
  };
}
