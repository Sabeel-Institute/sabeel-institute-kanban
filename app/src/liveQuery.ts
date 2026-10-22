/**
 * The ONE way to subscribe to live Firestore data from a hook. Every live hook
 * in the app goes through here — never hand-roll onSnapshot state in a hook.
 * ESLint enforces this (see eslint.config.mjs).
 *
 * Invariants, inherited from a real bug in the sibling time-tracker project
 * (docs/INHERITED-STACK.md, lesson 5):
 *
 *  1. State RESETS to `loading` the moment the subscription inputs change. React
 *     state otherwise persists across dependency changes, so query A's results
 *     stay on screen while query B's first snapshot is in flight — on a slow
 *     connection that showed one week's entries under another week's heading.
 *     For a kanban board the equivalent is one board's cards appearing under
 *     another board's name, which is worse: people would act on them.
 *
 *  2. Listener errors also reset to empty and are surfaced. A server-rejected
 *     listen used to die as a console warning nobody sees on a phone. An empty
 *     screen plus a visible error beats silently-wrong data that never corrects.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  onSnapshot,
  type DocumentReference,
  type Query,
  type Unsubscribe,
} from 'firebase/firestore';
import { captureError } from './sentry';
import { startReadTimer } from './slowReads';

/**
 * A document as handed to a mapper. `path` matters for collection-group queries,
 * where the parent ids live only in the path — My Work reads the board id from
 * `boards/{boardId}/cards/{cardId}` rather than duplicating it into a field.
 */
export interface LiveDoc {
  id: string;
  data: Record<string, unknown>;
  path: string;
}

export type LiveState<T> =
  | { status: 'loading'; data: undefined; error: undefined }
  | { status: 'ready'; data: T; error: undefined }
  | { status: 'error'; data: undefined; error: string };

const LOADING = { status: 'loading', data: undefined, error: undefined } as const;

// ---- Last-result cache ----------------------------------------------------
/**
 * The last mapped result for each subscription, so returning to a screen you
 * were just on renders immediately instead of tearing down to a spinner.
 *
 * Navigating opened a FULL-SCREEN "Loading card…" for about a second, then the
 * content appeared — in both directions. That reads as the screen failing to
 * draw rather than as loading, because everything vanishes including the parts
 * that never changed.
 *
 * This does NOT weaken invariant 1. The bug that invariant exists for is showing
 * query A's data under query B's inputs; the key here is the label plus the deps
 * that IDENTIFY the subscription, so a different query has no entry and still
 * starts at `loading`. Only a query showing its own previous result skips the
 * spinner — and Firestore is about to re-deliver exactly that from its cache.
 *
 * Errors evict, so invariant 2 holds too: a failed listen never leaves stale
 * rows on screen.
 */
const lastResults = new Map<string, unknown>();
const MAX_CACHED = 60;

function cacheKey(label: string, deps: readonly unknown[]): string {
  return `${label}|${JSON.stringify(deps)}`;
}

function remember(key: string, value: unknown) {
  // Bounded: keys include ids (every card visited), so this would otherwise grow
  // for the life of the session. Oldest-out is fine — the cost of a miss is the
  // spinner we had before.
  if (lastResults.size >= MAX_CACHED) {
    const oldest = lastResults.keys().next().value;
    if (oldest !== undefined) lastResults.delete(oldest);
  }
  lastResults.delete(key);
  lastResults.set(key, value);
}

function cachedState<T>(key: string): LiveState<T> {
  const hit = lastResults.get(key);
  return hit === undefined
    ? (LOADING as LiveState<T>)
    : { status: 'ready', data: hit as T, error: undefined };
}

/**
 * Drop every cached result. Called on sign-out: the cache is keyed by query
 * shape (e.g. boardId), not by user, so on a SHARED device the next person to
 * sign in could otherwise see a one-frame flash of the previous user's board
 * before their own listeners deliver.
 */
export function clearLiveResultCache(): void {
  lastResults.clear();
  // The error banner is module-level too, and it outlived the session that
  // caused it: sign out while one is showing and the next person to sign in on
  // that device inherits it, quoting a failure that was never theirs. It only
  // cleared when a query with the SAME label next succeeded. Cache and banner are
  // one session's state; they get cleared together.
  lastError = null;
  watchers.forEach((w) => w(null));
}

// ---- Listener-error visibility -------------------------------------------
// Errors are broadcast so a screen-level banner can show them. A later success
// from the same source clears it.
const watchers = new Set<(msg: string | null) => void>();
let lastError: string | null = null;

/**
 * Raise the banner, and say whether it was raised.
 *
 * A REFUSAL IS NOT BANNER MATERIAL. The banner exists because "we could not find
 * out" is invisible otherwise — a listen rejected on someone's phone cost the
 * sibling project a day (docs/INHERITED-STACK.md lesson 5). `permission-denied`
 * is not that: it is a definite answer, it became an ordinary event the moment
 * board authority went per-board (being removed from a board you have open ends
 * its listeners exactly this way), and the screen that asked already renders
 * `LoadError`, which says so in words. An app-wide red bar on top of that reads
 * as breakage.
 *
 * Nothing is lost from the diagnostic side: Sentry and the console still get it
 * below, on every path.
 */
function publishError(label: string, e: { code?: string; message: string }): boolean {
  console.warn(`${label} listener`, e.code ?? e.message);
  // Off-device visibility. A rejected listen on someone's phone is invisible
  // otherwise — the sibling project lost a day to exactly that (see
  // docs/INHERITED-STACK.md lesson 5). With a DSN wired it is one dashboard
  // event; without one it is at least a console warning.
  captureError(e, { source: label });
  if (e.code === 'permission-denied') return false;
  lastError = `Live data error (${label}): ${e.code ?? e.message}`;
  watchers.forEach((w) => w(lastError));
  return true;
}

function publishSuccess(label: string) {
  if (lastError?.includes(`(${label})`)) {
    lastError = null;
    watchers.forEach((w) => w(null));
  }
}

/** Subscribe to the most recent live-data error, for a screen-level banner. */
export function useListenerError(): string | null {
  const [msg, setMsg] = useState(lastError);
  useEffect(() => {
    watchers.add(setMsg);
    return () => {
      watchers.delete(setMsg);
    };
  }, []);
  return msg;
}

/**
 * Time a subscription to the server's answer, and report it if slow (see
 * slowReads.ts). Returns the cleanup, which ends the timer.
 *
 * A SECOND listener rather than the hook's own. Without `includeMetadataChanges`
 * Firestore raises no snapshot when the server merely confirms what the cache
 * showed, so the hook's listener cannot see the answer; turning it on there would
 * re-render every screen on every metadata flip. Both listen to one target,
 * which Firestore shares, so this costs no reads. It detaches once answered.
 */
function timeServerAnswer(
  label: string,
  listen: (next: (fromCache: boolean) => void, error: () => void) => Unsubscribe,
): () => void {
  // Started while the app is not on screen (a notification tap restoring
  // state): the wait until it is says nothing about the read.
  if (AppState.currentState === 'background') return () => undefined;
  const timer = startReadTimer(label);
  let stopped = false;
  // Optional for the reason foreground.ts gives: react-native-web returns
  // nothing when document visibility is unavailable.
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'background') return;
    timer.backgrounded();
    stop();
  });
  function stop() {
    if (stopped) return;
    stopped = true;
    unsub();
    sub?.remove();
  }
  // Firestore never calls back synchronously, so `unsub` exists by the time
  // either callback can reach `stop`.
  const unsub = listen(
    (fromCache) => {
      timer.snapshot(fromCache);
      if (!fromCache) stop();
    },
    () => {
      timer.failed();
      stop();
    },
  );
  return () => {
    timer.ended();
    stop();
  };
}

/**
 * Subscribe to a query. `deps` identify the subscription: when they change the
 * state resets, so stale results can never be shown under new inputs.
 *
 * Pass `null` for the query to subscribe to nothing (e.g. while signed out)
 * without violating the rules of hooks.
 *
 * ARGUMENT ORDER IS LOAD-BEARING. `build` first and `deps` second is the only
 * shape `react-hooks/exhaustive-deps` can read (eslint.config.mjs names this
 * hook), and that rule is what proves every live screen resubscribes when an
 * input `build` reads changes. Move them and the check goes quiet without
 * failing.
 */
export function useLiveQuery<T>(
  build: () => Query | null,
  deps: readonly unknown[],
  label: string,
  map: (docs: LiveDoc[]) => T,
): LiveState<T> {
  const key = cacheKey(label, deps);
  const [state, setState] = useState<LiveState<T>>(() => cachedState<T>(key));
  /** Did THIS subscription put the banner up? Only then may it take it down. */
  const raised = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const query = useMemo(build, deps);

  useEffect(() => {
    // Invariant 1: never show ANOTHER query's data. A cache hit here is this
    // same subscription's own last result, which is not that.
    setState(cachedState<T>(key));
    if (!query) return;

    const untime = timeServerAnswer(label, (next, error) =>
      onSnapshot(query, { includeMetadataChanges: true }, (s) => next(s.metadata.fromCache), error),
    );
    const unsub = onSnapshot(
      query,
      (snap) => {
        publishSuccess(label);
        const data = map(
          snap.docs.map((d) => ({
            id: d.id,
            data: d.data() as Record<string, unknown>,
            path: d.ref.path,
          })),
        );
        remember(key, data);
        setState({ status: 'ready', data, error: undefined });
      },
      (e) => {
        raised.current = publishError(label, e);
        // Invariant 2: never leave stale rows visible behind an error — including
        // via the cache, so a later remount cannot resurrect them either.
        lastResults.delete(key);
        setState({ status: 'error', data: undefined, error: e.code ?? e.message });
      },
    );
    // A banner this subscription raised goes with it. Nothing else can clear it:
    // `publishSuccess` needs another listen on the SAME label to succeed, and
    // there is not going to be one once the screen that owned it has gone — so
    // one transient failure on a screen you then leave used to sit across the
    // whole app until the next sign-out.
    return () => {
      unsub();
      untime();
      if (raised.current) publishSuccess(label);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return state;
}

/**
 * Subscribe to a single document. Same invariants as useLiveQuery, and the same
 * argument order, for the same reason.
 */
export function useLiveDoc<T>(
  build: () => DocumentReference | null,
  deps: readonly unknown[],
  label: string,
  map: (doc: LiveDoc | null) => T,
): LiveState<T> {
  const key = cacheKey(label, deps);
  const [state, setState] = useState<LiveState<T>>(() => cachedState<T>(key));
  /** Did THIS subscription put the banner up? Only then may it take it down. */
  const raised = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ref = useMemo(build, deps);

  useEffect(() => {
    setState(cachedState<T>(key));
    if (!ref) return;

    const untime = timeServerAnswer(label, (next, error) =>
      onSnapshot(ref, { includeMetadataChanges: true }, (s) => next(s.metadata.fromCache), error),
    );
    const unsub = onSnapshot(
      ref,
      (snap) => {
        publishSuccess(label);
        const data = map(
          snap.exists()
            ? {
                id: snap.id,
                data: snap.data() as Record<string, unknown>,
                path: snap.ref.path,
              }
            : null,
        );
        remember(key, data);
        setState({ status: 'ready', data, error: undefined });
      },
      (e) => {
        raised.current = publishError(label, e);
        lastResults.delete(key);
        setState({ status: 'error', data: undefined, error: e.code ?? e.message });
      },
    );
    // See the sibling in `useLiveQuery`: a banner this subscription raised goes
    // with it, or it outlives the screen that could explain it.
    return () => {
      unsub();
      untime();
      if (raised.current) publishSuccess(label);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  return state;
}
