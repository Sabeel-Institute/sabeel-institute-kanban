import { USE_EMULATORS } from './env';
// Named imports, not `import * as Sentry`: the export is tree-shaken
// (`sabeel-ci build-web`), and only these leave the rest of the SDK, session
// replay and the feedback widget among it, out of the bundle.
import { captureException, init, setUser } from '@sentry/react';

/**
 * Error reporting — WEB. See sentry.ts for the native variant.
 *
 * Separate seams because the SDKs differ (@sentry/react vs @sentry/react-native)
 * and because web and native report to SEPARATE Sentry projects: a web bundle
 * and an Android build have different releases and different source maps, and
 * mixing them makes triage guesswork.
 *
 * The DSN comes from gitignored `app/.env.local`, inlined at bundle time.
 * Without it every function here is a no-op, so a dev build never sends noise to
 * the production project.
 */
/**
 * Reporting is OFF whenever the app is pointed at the emulators, even though a
 * DSN is present in `.env.local`.
 *
 * Without this, every local run and every e2e pass files fake errors into the
 * production Sentry project — burning a 5K/month event quota on noise and
 * training everyone to ignore the issue stream. It also caused a concrete
 * failure: the SDK wraps fetch for breadcrumbs and beacons to an ingest host
 * the test environment cannot reach, which was enough to stall a sign-in flow
 * and abort the suite.
 */
const DSN = USE_EMULATORS ? undefined : process.env.EXPO_PUBLIC_SENTRY_DSN_WEB;

let initialised = false;

export function initErrorReporting(): void {
  if (initialised || !DSN) return;
  initialised = true;
  init({
    dsn: DSN,
    // Error reporting only. This is a <50-person internal tool; performance
    // tracing would spend the event quota on data nobody is going to read.
    tracesSampleRate: 0,
  });
}

export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
  // `warning` for things worth recording but not paging anyone about — e.g. a
  // slow-but-successful write (see slowWrites.ts). Still an exception, so it
  // groups by stack rather than fragmenting per message; only the level differs.
  level: 'error' | 'warning' = 'error',
): void {
  if (!DSN) {
    // Without a DSN this is still the ONE place errors are funnelled, so a
    // developer sees them in the console rather than nowhere.
    console.warn('[error]', error, context ?? '');
    return;
  }
  captureException(error, { level, extra: context });
}

/**
 * Attach the signed-in user to events.
 *
 * **Uid only — never email or name.** The uid correlates with the `users`
 * collection when someone needs to trace a report, which is all triage
 * requires; putting staff email addresses into a third-party service is a
 * disclosure this app has no reason to make.
 */
export function setErrorUser(uid: string | null): void {
  if (!DSN) return;
  setUser(uid ? { id: uid } : null);
}

