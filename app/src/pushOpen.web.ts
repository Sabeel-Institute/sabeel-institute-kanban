/**
 * Taps on a push notification — WEB (native sibling: pushOpen.ts).
 *
 * Shaped like the native side because it is the same problem: a tap can arrive
 * while the app is open, or it can BE the reason the app opened. The service
 * worker (`public/firebase-messaging-sw.js`) handles both ends of a click: with
 * a tab of the app open it posts that tab `{ type: 'push-open', data }` and
 * brings it forward; with none, it opens a new one at the root with the data
 * as the query.
 *
 * Both arrive here as the routing data the notification functions send
 * (`{ type, boardId, cardId, notifId }`), the same `PushData` a phone tap
 * hands `usePushOpens`, so a tap on the web routes through
 * `routeForNotification` and marks its inbox entry read exactly as one on a
 * phone does.
 */
export type PushData = Record<string, string>;

/** The keys a push carries (functions/src/notifications.ts), and so the only ones read off a launch URL. */
const PUSH_KEYS = ['type', 'boardId', 'cardId', 'notifId'] as const;

/** The string fields of a message's data, or null when there are none. */
function stringsOf(value: unknown): PushData | null {
  if (!value || typeof value !== 'object') return null;
  const out: PushData = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The push this tab was opened FOR, read off the launch URL once, at module
 * load, before any navigation can rewrite it, and stripped from the address
 * at once so a reload does not open the same subject again.
 */
function readLaunchPush(): PushData | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const data: PushData = {};
  for (const key of PUSH_KEYS) {
    const value = params.get(key);
    if (value) data[key] = value;
    params.delete(key);
  }
  if (Object.keys(data).length === 0) return null;
  const rest = params.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`,
  );
  return data;
}

let initial = readLaunchPush();

/**
 * Taps posted before anything subscribed: a tab sitting on sign-in, the rules
 * or the approval wait is still a tab of the app, so the worker sends it the
 * tap, and the signed-in shell takes it once it mounts.
 */
let queued: PushData[] = [];
let listener: ((data: PushData) => void) | null = null;

if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as { type?: unknown; data?: unknown } | null;
    if (message?.type !== 'push-open') return;
    const data = stringsOf(message.data);
    if (!data) return;
    if (listener) listener(data);
    else queued.push(data);
  });
}

export function takeInitialPush(): PushData | null {
  const data = initial;
  initial = null;
  return data;
}

export function subscribePushOpens(cb: (data: PushData) => void): () => void {
  listener = cb;
  const waiting = queued;
  queued = [];
  for (const data of waiting) cb(data);
  return () => {
    if (listener === cb) listener = null;
  };
}
