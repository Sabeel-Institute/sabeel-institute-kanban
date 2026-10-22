import type { BaseMessage } from 'firebase-admin/messaging';
import { PUSH_CHANNEL_ID } from '@sabeel/shared';
import type { PushMessage } from './messaging';

/**
 * FCM error codes that mean "this token will never work again".
 *
 * Anything else — a quota error, a transient unavailable — must NOT delete the
 * token: pruning on a temporary failure would silently unregister a working
 * device and the only symptom would be notifications quietly stopping.
 *
 * `messaging/invalid-argument` is deliberately NOT here, though it looks like it
 * belongs: FCM also returns it for a malformed MESSAGE, so one bad title would
 * come back against every device at once and prune every recipient's tokens.
 * `npx sabeel-ci check-push` asks FCM about a token that cannot exist and fails
 * unless the answer is one of these.
 */
export const DEAD_TOKEN_CODES: ReadonlySet<string> = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * The FCM message for an Android phone or a browser, less its token, which
 * the sender adds: `{ token, ...fcmMessage(message) }`.
 *
 * Its own module, with nothing but types imported from beside it, so
 * `npx sabeel-ci check-push` and `npx sabeel-ci send-test-push` run it from
 * source and send exactly what a notification sends — `apns.ts` is kept the
 * same way for iPhones.
 */
export function fcmMessage(message: PushMessage): BaseMessage {
  return {
    notification: { title: message.title, body: message.body },
    data: message.data,
    // Without this every push lands in expo-notifications' fallback channel,
    // which Android shows as "Miscellaneous" — see PUSH_CHANNEL_ID.
    android: { notification: { channelId: PUSH_CHANNEL_ID } },
  };
}
