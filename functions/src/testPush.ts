import type { PushMessage } from './messaging';

/**
 * The message a test push carries: `npx sabeel-ci send-test-push <token>
 * [key=value …]` sends it to one device, and `npm run check:push` sends it to
 * tokens that cannot exist, through the functions' own `fcm.ts` and `apns.ts`,
 * so a test push is shaped exactly as a notification is.
 *
 * The fields are the routing data a notification carries (`notify` in
 * notifications.ts), which the app's `routeForNotification` reads: `boardId`
 * opens that board, with `cardId` that card, and `type=newUserPending` alone
 * opens People. No fields open the app where it was. Anything else is nothing
 * the app opens, so there is no message for it: null, and the push is refused
 * before anything is sent. A test push carries no `notifId`, since it has no
 * inbox entry for a tap to mark read.
 *
 * Imports nothing relative but types, so ci-tools runs it from source.
 */
const FIELDS = new Set(['type', 'boardId', 'cardId']);

export function testMessage(title: string, body: string, fields: Record<string, string>): PushMessage | null {
  const keys = Object.keys(fields);
  if (keys.some((key) => !FIELDS.has(key) || !fields[key])) return null;
  const { type, boardId, cardId } = fields;
  const opens = keys.length === 0 || (type === 'newUserPending' && !boardId && !cardId) || (!!boardId && type !== 'newUserPending');
  return opens ? { title, body, data: { ...fields } } : null;
}
