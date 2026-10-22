import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { app, db } from './firebase';
import { VAPID_PUBLIC_KEY } from './firebase-config';
import { USE_EMULATORS } from './env';
import { captureError } from './sentry';

/**
 * Push registration — WEB (native sibling: notify.ts).
 *
 * Web push needs two things that native does not: the Web Push certificate
 * (VAPID) public key, committed as `VAPID_PUBLIC_KEY` in firebase-config.ts,
 * and a service worker at /firebase-messaging-sw.js, since a browser cannot be
 * woken by a message without one.
 *
 * It also needs a third thing that is not configuration: permission has to be
 * asked FROM A CLICK. Signing in is not one — see `enablePush`.
 */

/**
 * The checks that can be made WITHOUT awaiting anything.
 *
 * This is the synchronous half of `isSupported()`, split out because of the
 * rule in `enablePush`: nothing may be awaited before the permission request.
 * The asynchronous half — `isSupported()`'s IndexedDB probe, which only catches
 * Firefox private browsing and Safari in an iframe — runs after the prompt,
 * where an await costs nothing.
 *
 * Deliberately says nothing about USE_EMULATORS. What a BROWSER can do does not
 * depend on which Firebase backend it is pointed at, and folding the emulator
 * flag in here made the whole notification UI read 'unsupported' in every local
 * run — so the one control this file exists for could not be seen, screenshotted
 * or toured by the screens sweep. The emulator gate belongs on registration,
 * where the real constraint is; see claimToken.
 */
function canRequestPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * `isSupported()`, but it cannot hang.
 *
 * It probes IndexedDB, and an `open()` can neither resolve nor reject — a
 * blocked upgrade, a locked-down or private window. An unsettled promise here is
 * worse than a false one, because everything downstream simply never happens:
 * `pushPromptState` never returns, so the notifications screen renders no
 * "This device" section at all and the nudge never appears. Nothing throws,
 * nothing logs, and the control the whole feature depends on is silently absent
 * — which is the exact failure shape this file was rewritten to remove.
 *
 * Same reasoning as the `serviceWorker.ready` race in `claimToken`, and the same
 * answer. Timing out means "we could not establish support", which is reported
 * as unsupported: an honest answer a person can act on, rather than none.
 */
async function supported(): Promise<boolean> {
  return Promise.race([
    isSupported().catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
}

/**
 * A browser deliberately offers no way to open its own site settings — the
 * permission would be worth little if a site could reach past it. So a blocked
 * browser gets told where to look instead of a button that cannot work.
 */
export const canOpenPushSettings = false;

export function openPushSettings(): void {}

/**
 * What came of asking. Three outcomes, not a boolean: permission granted but no
 * token — a browser pointed at the emulators, a service worker that failed to
 * activate — is not a refusal, and telling someone their notifications are
 * "turned off" when they just said yes sends them to fix a setting that is
 * already correct.
 */
export type PushEnableResult = 'granted' | 'denied' | 'unavailable';

/**
 * What the notifications screen should offer: ask, explain, or say nothing can
 * be done here. Read on mount, never in a press handler — it awaits.
 */
export async function pushPromptState(): Promise<
  'granted' | 'denied' | 'default' | 'unsupported'
> {
  if (!canRequestPush()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return (await supported()) ? 'default' : 'unsupported';
}

/**
 * Register this browser for push if it is ALREADY permitted. Never prompts.
 *
 * This is the sign-in path. It used to ask for permission here, which is the
 * bug: a browser only honours a permission request that follows a click, and
 * signing in reaches this from a Firestore snapshot callback. Safari refused it
 * outright and Chrome demoted it to the quiet chip, so on any new browser
 * permission stayed at 'default' and the site appeared in neither the allowed
 * nor the blocked list — the tell-tale symptom of a request nobody ever saw.
 *
 * Asking now belongs to `enablePush`, reached from a press — the nudge on the
 * Boards screen, or the notifications screen itself. A browser
 * that was permitted in an earlier visit still registers silently right here,
 * so every already-working device keeps working with no extra click.
 */
export async function registerPush(uid: string): Promise<boolean> {
  if (!canRequestPush() || Notification.permission !== 'granted') return false;
  try {
    return await claimToken(uid);
  } catch (e) {
    // Recorded either way; only whether it PAGES differs. This path runs
    // silently at every sign-in, so a browser that could not reach Google is
    // not a defect here — the token doc it already holds keeps working (the
    // server prunes only tokens FCM rejects outright), and the next page load
    // tries again. `enablePush` stays at 'error': a failure there is one the
    // person just watched happen.
    captureError(e, { source: 'registerPush' }, isTransient(e) ? 'warning' : 'error');
    return false;
  }
}

/**
 * The browser could not reach Google, as opposed to Google refusing it.
 *
 * Two shapes, both seen in production from the sign-in path: the Installations
 * SDK's own `app-offline`, and `request-failed` carrying a 5xx `serverCode` —
 * a 503 from the auth-token endpoint, which the SDK retries once and then
 * throws. A 4xx there is a real problem with the project or the key, and stays
 * an error.
 */
function isTransient(e: unknown): boolean {
  if (!(e instanceof Error) || !('code' in e)) return false;
  const { code, customData } = e as { code: unknown; customData?: Record<string, unknown> };
  if (code === 'installations/app-offline') return true;
  const status = customData?.serverCode;
  return code === 'installations/request-failed' && typeof status === 'number' && status >= 500;
}

/**
 * Ask for permission and register — the ONLY function that may prompt.
 *
 * Call it as the first statement of a press handler and never await anything
 * before it. `Notification.requestPermission()` consumes transient activation
 * in WebKit, which honours it only as the direct result of a click, and an
 * await in between is enough to lose it: `isSupported()` used to run first, and
 * it awaits an IndexedDB `open()` that resolves from an `onsuccess` TASK, so
 * the request landed a whole event-loop turn after the press.
 *
 * An async function runs synchronously up to its first await, so the request
 * below is raised inside the click as long as every caller in the chain also
 * calls straight through. notify.web.test.ts holds that property down.
 */
export async function enablePush(uid: string): Promise<PushEnableResult> {
  if (!canRequestPush()) return 'unavailable';

  // Inside the try, but still the first thing that runs: entering a try block
  // is synchronous, so this keeps the request inside the press AND catches a
  // synchronous throw. Outside it, a throw here escaped a function every caller
  // treats as total, leaving a button stuck in its busy state.
  try {
    // NOTHING MAY BE AWAITED ABOVE THIS LINE.
    const decision =
      Notification.permission === 'default'
        ? Notification.requestPermission()
        : Promise.resolve(Notification.permission);

    // Past the prompt, awaits are free again.
    if ((await decision) !== 'granted') return 'denied';
    return (await claimToken(uid)) ? 'granted' : 'unavailable';
  } catch (e) {
    captureError(e, { source: 'enablePush' });
    return 'unavailable';
  }
}

/**
 * Take the FCM token for this browser and file it under the user.
 *
 * Callers have already established permission; this half may await freely.
 */
async function claimToken(uid: string): Promise<boolean> {
  // FCM has no emulator. A token minted against the demo project could never be
  // delivered to and would make local runs non-deterministic — so registration
  // stops here, while the UI above still reports what this browser can actually
  // do. That split is deliberate: it keeps the notification screen reviewable
  // locally without pretending a local device can receive a push.
  if (USE_EMULATORS) return false;
  if (!(await supported())) return false;
  await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  // `register()` resolves as soon as the script is FETCHED, not once a worker is
  // running it. Handing that registration straight to getToken fails with
  // "Subscription failed - no active Service Worker" — on a first-ever visit
  // only, because every later load already has one activated. `ready` waits for
  // an active worker in this page's scope.
  //
  // Raced against a timeout because `ready` never REJECTS: a worker that fails
  // to activate leaves it pending forever, and the caller would wait for it with
  // nothing to show and no error.
  const registration = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]);
  if (!registration) return false;
  const token = await getToken(getMessaging(app), {
    vapidKey: VAPID_PUBLIC_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) return false;
  await setDoc(doc(db, 'users', uid, 'pushTokens', token), {
    platform: 'web',
    updatedAt: Date.now(),
  });
  return true;
}

/**
 * Called on sign-out. Pushes target the BROWSER, not the session, so a shared
 * computer would otherwise keep showing the previous account's notifications.
 *
 * `getToken` here never prompts: the permission check above it is synchronous
 * and bails before anything is asked, and if permission was already granted it
 * returns the existing token.
 */
export async function unregisterPush(uid: string): Promise<void> {
  if (USE_EMULATORS) return;
  if (!canRequestPush() || Notification.permission !== 'granted') return;
  try {
    if (!(await supported())) return;
    const sw = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: sw,
    });
    if (!token) return;
    await deleteDoc(doc(db, 'users', uid, 'pushTokens', token));
  } catch {
    // Nothing registered, nothing to remove.
  }
}
