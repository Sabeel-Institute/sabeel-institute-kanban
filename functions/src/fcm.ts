import type { Message } from 'firebase-admin/messaging';
import { PUSH_CHANNEL_ID } from '@sabeel/shared';
import type { PushMessage } from './messaging';

/**
 * The FCM message for one Android phone or browser.
 *
 * Its own module, with nothing but types imported from beside it, so
 * `scripts/send-test-push.mjs` can run it from source and send exactly what a
 * notification sends — `apns.ts` is kept the same way for iPhones.
 */
export function fcmMessage(token: string, message: PushMessage): Message {
  return {
    token,
    notification: { title: message.title, body: message.body },
    data: message.data,
    // Without this every push lands in expo-notifications' fallback channel,
    // which Android shows as "Miscellaneous" — see PUSH_CHANNEL_ID.
    android: { notification: { channelId: PUSH_CHANNEL_ID } },
  };
}
