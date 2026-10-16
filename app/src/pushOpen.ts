/**
 * Taps on a push notification — NATIVE (web sibling: pushOpen.web.ts).
 *
 * Deliberately shaped like `deeplink.ts`, because it is the same problem: an
 * intent can arrive while the app is running, or it can BE the reason the app
 * started. Those are two different APIs, and forgetting the second is how "it
 * works when I test it" turns into "it does nothing from a cold phone" — the
 * convenient way to test is with the app already open in the background, which
 * is precisely the case that works either way.
 *
 * What comes back is the routing data the notification functions send
 * (`{ type, boardId, cardId, notifId }`), untouched: FCM's `data` on Android,
 * and on an iPhone the `body` dictionary of Apple's payload, which is all
 * expo-notifications hands over as a remote notification's data there
 * (functions/src/apns.ts). Turning that into a screen is
 * `routeForNotification`'s job, shared with the in-app Alerts list.
 */
import * as Notifications from 'expo-notifications';

export type PushData = Record<string, string>;

function dataOf(response: Notifications.NotificationResponse | null): PushData | null {
  const data = response?.notification.request.content.data;
  if (!data || typeof data !== 'object') return null;
  // FCM data values arrive as strings, but this payload has crossed a native
  // bridge and the type is `any`. Take only the strings: the route mapping
  // wants ids, and a number or an object here means something is wrong upstream
  // rather than something to coerce.
  const out: PushData = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The notification the app was launched from, or null on a normal launch.
 *
 * `getLastNotificationResponse` keeps returning the same response for the life
 * of the process, so it is CLEARED as soon as it is read — that is what
 * `clearLastNotificationResponse` is for, and it is the library's own answer to
 * "an app selects a route based on the notification response, and it is
 * undesirable to continue selecting the route after the response has already
 * been handled". Without it, signing out and back in would yank the user to a
 * card they already dealt with.
 *
 * The sync pair is used rather than the `…Async` pair: both async forms are
 * deprecated in expo-notifications 57.
 */
export function takeInitialPush(): PushData | null {
  const data = dataOf(Notifications.getLastNotificationResponse());
  if (data) Notifications.clearLastNotificationResponse();
  return data;
}

export function subscribePushOpens(cb: (data: PushData) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = dataOf(response);
    if (data) cb(data);
  });
  return () => sub.remove();
}


