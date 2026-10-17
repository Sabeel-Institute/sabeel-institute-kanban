import { captureError } from './sentry';

/**
 * Time live reads to the SERVER's answer, and report the slow ones.
 *
 * The People list once took 5-10 s on a phone: the signed-in admin's own row
 * appeared at once, everyone else much later. The first row was the cache, which
 * already held that one profile; the rest waited on the server. Reads leave no
 * server log, so there was nothing to say where the time went. This is the
 * read-side sibling of `slowWrites.ts`, at the same threshold and level.
 *
 * The clock stops at the first snapshot the server confirmed (`fromCache`
 * false), not the first snapshot: a cached partial answer is exactly what made
 * the People list look loaded while it was not. A read the person gives up on
 * (the subscription ends unanswered) is reported too, as abandoned.
 *
 * `alsoWaiting` is how many OTHER reads were still waiting on the server when
 * this one finished. Several at once points at the connection; one alone points
 * at that query.
 */
export const SLOW_READ_MS = 5000;

let waiting = 0;

export interface ReadTimer {
  /** A snapshot arrived; the timer stops at the first the server confirmed. */
  snapshot(fromCache: boolean): void;
  /** The listen failed. It is reported as an error already, so not timed. */
  failed(): void;
  /** The app left the foreground: the time from here on is not the app's. */
  backgrounded(): void;
  /** The subscription ended. Slow and unanswered, it is reported. */
  ended(): void;
}

export function startReadTimer(label: string): ReadTimer {
  const started = Date.now();
  let cacheShownFirst = false;
  let done = false;
  waiting += 1;

  const finish = (outcome: 'answered' | 'abandoned' | null) => {
    if (done) return;
    done = true;
    waiting -= 1;
    const ms = Date.now() - started;
    if (outcome === null || ms < SLOW_READ_MS) return;
    captureError(
      new Error(
        outcome === 'answered'
          ? `Slow read: ${label} took ${ms}ms`
          : `Slow read: ${label} abandoned after ${ms}ms`,
      ),
      { source: 'slowRead', label, ms, outcome, cacheShownFirst, alsoWaiting: waiting },
      'warning',
    );
  };

  return {
    snapshot(fromCache) {
      if (fromCache) cacheShownFirst = true;
      else finish('answered');
    },
    failed: () => finish(null),
    backgrounded: () => finish(null),
    ended: () => finish('abandoned'),
  };
}
