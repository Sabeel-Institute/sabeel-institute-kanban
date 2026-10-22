import { captureError } from './sentry';

/**
 * Turn a thrown value into a message for the user — and report it.
 *
 * Every screen has a `run()` that catches, shows a banner, and moves on. That is
 * right for the user and wrong for us: it meant a failure the user SAW never
 * reached Sentry. A clear-the-due-date bug sat in production, visible on screen,
 * with nothing in the issue stream (2026-07-19).
 *
 * Anything a user is told about is by definition worth knowing about, so the
 * capture happens here rather than being remembered at eight call sites.
 */
export function toUserMessage(e: unknown, source: string): string {
  captureError(e, { source });
  return errorText(e);
}

/**
 * The sentence to show for a failure.
 *
 * THE SENTENCES THIS CODEBASE WROTE GET THROUGH; MACHINE TOKENS DO NOT. The
 * callables here throw real messages ("Only a board's owners can do that."),
 * and those are what a person needs to read. Three shapes are turned away:
 *
 *  - a bare code, which has no spaces in it (`internal`, `unauthenticated`);
 *  - the Firebase SDK's own assembled string, `Firebase: <something>
 *    (service/code).`, a library talking to a developer;
 *  - an Expo native module's rejection, `Call to function '<Module.fn>' has
 *    been rejected. → Caused by: java.lang.…`.
 *
 * A callable that never got an answer is said plainly: the Functions SDK
 * reports one as `internal`, lower case, because no response arrived, and the
 * sign-in screen showed exactly that word on 2026-10-22, when no function could
 * start. A function that ran and failed sends its own status, `INTERNAL`.
 */
export function errorText(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  const raw = (err?.message ?? (typeof e === 'string' ? e : '')).trim();
  if (
    err?.code === 'unavailable' ||
    err?.code === 'functions/unavailable' ||
    err?.code === 'functions/deadline-exceeded' ||
    err?.code === 'auth/network-request-failed' ||
    (err?.code === 'functions/internal' && raw === 'internal')
  ) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  if (raw && /\s/.test(raw) && !/^(Firebase(\s\w+)?:|Call to function ')/.test(raw)) return raw;
  return 'Something went wrong. Try again in a moment.';
}
