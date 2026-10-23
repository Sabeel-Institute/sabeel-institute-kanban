/*
 * Service worker for web push.
 *
 * A browser cannot be woken by a push without one: when the tab is closed or
 * backgrounded there is no page running, so the push service hands the message
 * to this worker instead. It must sit at the ORIGIN ROOT — a worker under a
 * subdirectory can only receive events for that subdirectory.
 *
 * It handles the `push` event ITSELF, without the Firebase messaging SDK, and
 * that is the decision this file turns on. The SDK's worker shows a push only
 * while no tab of the app is visible; one arriving at a focused tab is handed
 * to the page instead and drawn only if the page registers `onMessage`, which
 * this app never did — so a push at an open tab drew nothing, and this file
 * used to call that deliberate. Faisal's decision (2026-09-17) is the reverse:
 * a notification shows whether the app is in the foreground, the background or
 * closed, on both surfaces. On web that means the worker shows every push, so
 * the visibility split is exactly the behaviour to remove — and the SDK had a
 * second problem: with a `notification` payload it showed the push ITSELF
 * before calling `onBackgroundMessage`, so the handler that used to live here
 * drew a second banner beside the SDK's own, which nothing could dismiss into
 * the app because the SDK's click handler stops propagation and, with no link
 * configured, does nothing. Two banners per background push, never seen,
 * because web arrival has never been watched (TODO.md § I).
 *
 * One listener, one presenter, and no copy of the Firebase config: minting the
 * token (`notify.web.ts`) needs only a registration, not a Firebase-aware
 * worker. The payload is FCM's web push JSON — `notification` (title, body)
 * and `data` — the same two fields the SDK's handler used to pass on.
 * `firebase-messaging-sw.test.ts` runs this file in a fake worker scope and
 * holds both handlers to what they do here; `scripts/push-e2e.mjs` delivers a
 * real push of every kind to it in Chromium and follows each tap to its screen.
 */

const APP_NAME = 'Sabeel Kanban';

// Take over as soon as a new version of this file is installed. A worker waits
// by default until every tab of the app is closed, which for someone who keeps
// a tab open means weeks on the previous worker; this one intercepts no
// fetches, so there is nothing an open page could be part-way through with the
// old one, and a push arriving after the deploy should be drawn by the code
// that was deployed.
self.addEventListener('install', () => self.skipWaiting());

/** FCM's JSON body, or null for a push that is not one (nothing else sends any). */
function readPayload(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  if (!payload) return;
  const { title, body } = payload.notification ?? {};
  const data = payload.data ?? {};
  event.waitUntil(
    self.registration.showNotification(title ?? APP_NAME, {
      body: body ?? '',
      icon: '/favicon.ico',
      // Collapse repeats for the same card rather than stacking a banner per
      // comment on a busy thread.
      tag: data.cardId ?? data.boardId ?? 'sabeel-kanban',
      data,
    }),
  );
});

/**
 * The address that opens a notification's subject in a new tab: the app's
 * root with the push's routing data as the query, which the app reads on
 * launch (`takeInitialPush` in pushOpen.web.ts) and routes exactly as a tapped
 * phone notification (`routeForNotification`). The data, not a card link,
 * because the data is all of it: who to mark read (`notifId`) and where a
 * notification with no card goes (`newUserPending`, the People screen).
 */
function subjectUrl(data) {
  const query = Object.keys(data)
    .filter((key) => typeof data[key] === 'string')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join('&');
  return query ? `/?${query}` : '/';
}

/**
 * A tapped notification opens its subject. A tab of the app already open is
 * told where to go and brought forward (one app, not a second copy beside
 * it); with none open, a new one opens at `subjectUrl`. The message is posted
 * before focusing, so a refused focus cannot cost the navigation.
 */
async function openSubject(data) {
  const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = wins.find((w) => w.url.startsWith(self.location.origin));
  if (!open) return clients.openWindow(subjectUrl(data));
  open.postMessage({ type: 'push-open', data });
  return open.focus().catch(() => undefined);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openSubject(event.notification.data ?? {}));
});
