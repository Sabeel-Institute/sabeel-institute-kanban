import { getMessaging } from 'firebase-admin/messaging';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import type { PushTokenDoc } from '@sabeel/shared';
import { APNS_TOKEN, sendToApns, type ApnsCredentials, type ApnsSend } from './apns';
import { DEAD_TOKEN_CODES, fcmMessage } from './fcm';
import { reportError } from './sentry';

/**
 * The one place a push leaves the server: FCM for Android phones and browsers,
 * Apple's push service for iPhones (`apns.ts`).
 *
 * A SEAM: FCM has no emulator and Apple cannot be reached from a test, so the
 * transport is one swappable function and everything above it — who is told,
 * what the message says, which rows are pruned — is testable without either.
 */

export interface PushMessage {
  title: string;
  body: string;
  /**
   * Where a tap leads: flat strings, read by the app's `routeForNotification`
   * (`type`, `boardId`, `cardId`, `notifId`). Never a key named `body` — see
   * `apnsPayload` for why Android would then lose every other key.
   */
  data: Record<string, string>;
}

/** One message to one device; `token` is the pushTokens document id. */
export interface Delivery {
  token: string;
  device: PushTokenDoc;
  message: PushMessage;
}

export interface SendOutcome {
  /** Deliveries whose token will never work again — safe to delete. The same objects as given. */
  stale: Delivery[];
  /** How many messages were accepted. */
  sent: number;
}

type Sender = (deliveries: Delivery[]) => Promise<SendOutcome>;

/**
 * An iPhone's row from before iPhones had rows of their own.
 *
 * Every build up to v0.11.5 build 11 filed Apple's token as `platform:
 * 'android'`. FCM answers such a token with `messaging/invalid-argument`, which
 * is deliberately not a dead-token code above, so these rows were never pruned
 * and would be sent to FCM on every notification for ever. A token that is
 * pure hex is Apple's — FCM's never are — so the row is pruned unsent. The
 * same phone files itself again, correctly, the next time a current build
 * starts; a row whose token is unchanged is simply overwritten.
 */
export function isLegacyIphoneRow(d: Delivery): boolean {
  return d.device.platform !== 'ios' && APNS_TOKEN.test(d.token);
}

async function sendToFcm(deliveries: Delivery[]): Promise<SendOutcome> {
  if (deliveries.length === 0) return { stale: [], sent: 0 };
  // One message per DEVICE, not one multicast: each carries its recipient's
  // own inbox id, so the payloads differ.
  const res = await getMessaging().sendEach(deliveries.map((d) => ({ token: d.token, ...fcmMessage(d.message) })));
  const stale = deliveries.filter((_, i) => {
    const r = res.responses[i];
    return !r.success && DEAD_TOKEN_CODES.has(r.error?.code ?? '');
  });
  return { stale, sent: res.successCount };
}

/**
 * Apple's key, as a Secret Manager secret, and the two ids that go with it.
 * The ids are not secret: the team's is in every signed app, and the key's is
 * useless without the key. Both are in functions/.env.<project>.
 */
const APNS_KEY = defineSecret('APNS_KEY');
const APNS_KEY_ID = defineString('APNS_KEY_ID', {
  description: "The APNs key's id, from its file name (AuthKey_<id>.p8)",
});
const APPLE_TEAM_ID = defineString('APPLE_TEAM_ID', {
  description: 'The Apple developer team that owns the app and the APNs key',
});

/**
 * What a function must bind to send a push: every function that can reach
 * `notify` does, and `pushSecrets.test.ts` finds them and holds them to it. A
 * secret that is not bound reads as empty at runtime.
 */
export const PUSH_SECRETS = [APNS_KEY];

function apnsCredentials(): ApnsCredentials {
  const key = APNS_KEY.value();
  if (!key) throw new Error('APNS_KEY is not bound to this function: add PUSH_SECRETS to its secrets');
  return { key, keyId: APNS_KEY_ID.value(), teamId: APPLE_TEAM_ID.value() };
}

async function sendToApple(deliveries: Delivery[]): Promise<SendOutcome> {
  if (deliveries.length === 0) return { stale: [], sent: 0 };
  const sends: ApnsSend[] = deliveries.flatMap((d) =>
    d.device.platform === 'ios'
      ? [{ token: d.token, apnsEnvironment: d.device.apnsEnvironment, message: d.message }]
      : [],
  );
  const out = await sendToApns(sends, apnsCredentials());
  // Reasons only: a token is an address, and the log has no use for one.
  for (const f of out.failed) logger.warn(`apns: not delivered (${f.reason})`);
  const dead = new Set(out.dead);
  return { stale: deliveries.filter((d) => dead.has(d.token)), sent: out.delivered.length };
}

/**
 * Each device through its own service, both at once.
 *
 * NEVER THROWS, which is where this differs from the sibling LMS. `notify`
 * writes the inbox entries, with ids generated per call, before it sends; a
 * throw here would fail the trigger, the platform would retry it, and the
 * retry would write every inbox entry and every unread increment a second
 * time. A push that did not go is recoverable — the entry is in Alerts — and a
 * duplicated inbox is not. So one service failing does not undo the other, and
 * each failure goes to Sentry and the log instead.
 */
const deviceSender: Sender = async (deliveries) => {
  const legacy = deliveries.filter(isLegacyIphoneRow);
  const apple = deliveries.filter((d) => d.device.platform === 'ios');
  const google = deliveries.filter((d) => d.device.platform !== 'ios' && !isLegacyIphoneRow(d));
  const settled = await Promise.allSettled([sendToFcm(google), sendToApple(apple)]);
  const outcomes = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  for (const r of settled) {
    if (r.status === 'rejected') {
      logger.warn('push send failed (inbox entries were still written)', { error: String(r.reason) });
      await reportError(r.reason);
    }
  }
  return {
    stale: [...legacy, ...outcomes.flatMap((o) => o.stale)],
    sent: outcomes.reduce((n, o) => n + o.sent, 0),
  };
};

/**
 * Under the emulator, send nothing and prune nothing.
 *
 * There is no FCM emulator and Apple cannot be reached, and a send from the
 * emulated functions does not fail quietly: whatever the credential-less Admin
 * SDK returns would be read as a verdict on real tokens, and a dead-token
 * verdict deletes the row. That matters now that a local build registers its
 * device — an iPhone simulator's sandbox token is real, and the way to prove
 * it is `npx sabeel-ci send-test-push`, not a trigger.
 */
const emulatorSender: Sender = async (deliveries) => {
  logger.info(`[emulator] push suppressed for ${deliveries.length} device(s)`);
  return { stale: [], sent: deliveries.length };
};

/**
 * The sender in effect, chosen once at load. `FUNCTIONS_EMULATOR` is set by
 * the emulator alone, never in a deployed runtime, and only to "true".
 */
const sender: Sender = process.env.FUNCTIONS_EMULATOR === 'true' ? emulatorSender : deviceSender;

export function send(deliveries: Delivery[]): Promise<SendOutcome> {
  return sender(deliveries);
}
