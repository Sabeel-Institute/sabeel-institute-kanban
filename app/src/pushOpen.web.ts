/**
 * Taps on a push notification — WEB (native sibling: pushOpen.ts).
 *
 * Inert, deliberately, though pushes do arrive: the VAPID key is committed
 * (`VAPID_PUBLIC_KEY` in firebase-config.ts) and permission is asked from a
 * press rather than from a snapshot callback, so browsers receive them.
 *
 * What is still missing is a destination. The web app has no URL handling for
 * board and card ids, so `firebase-messaging-sw.js` deliberately focuses the
 * app on click instead of opening a link that would look meaningful and land on
 * the home screen anyway. The ids are already in `event.notification.data`, and
 * that handler — not this file — is where routing goes when the web app grows
 * URLs for them. Until then a tapped web push opens the app, and the
 * notification is in Alerts either way.
 *
 * The seam exists so App.tsx mounts one hook for both platforms instead of
 * branching on Platform.OS.
 */
export type PushData = Record<string, string>;

export function takeInitialPush(): PushData | null {
  return null;
}

export function subscribePushOpens(_cb: (data: PushData) => void): () => void {
  return () => {};
}


