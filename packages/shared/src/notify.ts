import type { NotifyEvent } from './types';

/**
 * Who gets told what, and when they have opted out.
 *
 * Notification volume is the fastest way for this app to become as annoying as
 * the thing it replaced, so the default set is deliberately small and the one
 * high-frequency event ships OFF.
 */

export interface NotifyEventSpec {
  event: NotifyEvent;
  label: string;
  description: string;
  defaultOn: boolean;
}

export const NOTIFY_EVENTS: NotifyEventSpec[] = [
  {
    event: 'mention',
    label: 'You are @mentioned',
    description: 'Someone pulls you into a card by name.',
    defaultOn: true,
  },
  {
    event: 'assigned',
    label: 'A card is assigned to you',
    description: 'Work becomes yours.',
    defaultOn: true,
  },
  {
    event: 'commentOnMyCard',
    label: 'A comment on a card assigned to you',
    description: 'Discussion on work you own.',
    defaultOn: true,
  },
  {
    event: 'commentOnSubscribed',
    label: 'A comment on a card you subscribe to',
    description:
      'Discussion on a card you chose to follow, even if it is not assigned to you.',
    // ON by default, unlike `myCardMoved`: subscribing is already an opt-in you
    // made card by card, so the volume is bounded by your own choices rather
    // than by how busy the boards are.
    defaultOn: true,
  },
  {
    event: 'dueSoon',
    label: 'A card assigned to you is due soon',
    description: 'A morning reminder before the due date.',
    defaultOn: true,
  },
  {
    event: 'myCardMoved',
    label: 'A card assigned to you was moved',
    description:
      'Off by default: on an active board this fires constantly, and it is how notification fatigue starts.',
    defaultOn: false,
  },
  {
    event: 'newUserPending',
    label: 'Someone is waiting for approval',
    description: 'Admins only.',
    defaultOn: true,
  },
];

export const DEFAULT_NOTIFY_PREFS: Record<string, boolean> = Object.fromEntries(
  NOTIFY_EVENTS.map((e) => [e.event, e.defaultOn]),
);

/**
 * Should this person be told?
 *
 * Three independent reasons not to notify, in the order they are cheapest to
 * check. The self-check is first and is absolute: nobody wants to be told about
 * something they just did, and a system that does it looks broken.
 */
export function shouldNotify(params: {
  event: NotifyEvent;
  recipientUid: string;
  actorUid: string;
  boardId?: string;
  prefs?: Partial<Record<NotifyEvent, boolean>>;
  mutedBoardIds?: readonly string[];
  /** Only `active` accounts are notified — no point paging a disabled user. */
  status?: string;
}): boolean {
  if (params.recipientUid === params.actorUid) return false;
  if (params.status !== undefined && params.status !== 'active') return false;
  if (params.boardId && (params.mutedBoardIds ?? []).includes(params.boardId)) {
    return false;
  }

  const pref = params.prefs?.[params.event];
  // An absent preference means "never chosen", so fall back to the default
  // rather than treating undefined as off — otherwise nobody is ever notified
  // until they visit the settings screen.
  return pref === undefined ? (DEFAULT_NOTIFY_PREFS[params.event] ?? false) : pref;
}

/** The line shown in the inbox and on the push. Kept short — it is a lock screen. */
export function notificationText(params: {
  event: NotifyEvent;
  actorName: string;
  cardTitle?: string;
}): string {
  const card = params.cardTitle ? `“${params.cardTitle}”` : 'a card';
  switch (params.event) {
    case 'mention':
      return `${params.actorName} mentioned you on ${card}`;
    case 'assigned':
      return `${params.actorName} assigned you ${card}`;
    case 'commentOnMyCard':
    case 'commentOnSubscribed':
      return `${params.actorName} commented on ${card}`;
    case 'dueSoon':
      return `${card} is due soon`;
    case 'myCardMoved':
      return `${params.actorName} moved ${card}`;
    case 'newUserPending':
      return `${params.actorName} is waiting for approval`;
  }
}

/**
 * The Android notification channel every push is posted to.
 *
 * Shared because BOTH sides have to name it and neither can check the other: the
 * app creates the channel, the server addresses it, and a typo on either side is
 * silent. expo-notifications does not error on an unknown channel — it logs and
 * falls back to its own `expo_notifications_fallback_notification_channel`,
 * which Android labels **"Miscellaneous"** in the app's notification settings.
 * That fallback is exactly what was happening: the app created a channel called
 * "Default" that nothing ever posted to, because the server sent no channel at
 * all.
 *
 * IMPORTANCE_HIGH is not a change in behaviour — it is what the fallback channel
 * already used, so keeping it means nobody's notifications go quiet. It also has
 * to be right FIRST TIME: Android fixes a channel's importance when it is
 * created and an app may never raise it afterwards, only the person can. That is
 * also why this is a new channel id rather than a correction to the old one,
 * which already exists at DEFAULT importance on every device that has run the
 * app.
 */
export const PUSH_CHANNEL_ID = 'sabeel-alerts';
export const PUSH_CHANNEL_NAME = 'Card alerts and approvals';

/** Apple's two push services. A token from one is refused by the other. */
export type ApnsEnvironment = 'development' | 'production';

/**
 * A registered device, at `users/{uid}/pushTokens/{token}`; the token is the
 * document id, so re-registering a device overwrites its row.
 *
 * Android and web tokens are FCM's, and FCM delivers them. An iPhone's token is
 * Apple's own (hex): nothing on the phone registers with FCM, because the
 * Firebase JS SDK has no messaging on a native app and expo-notifications asks
 * Apple directly. The server sends those straight to Apple's push service
 * (functions/src/apns.ts), and must ask the service that issued the token,
 * which only the build that minted it knows — so the phone says. firestore.rules
 * admits exactly these two shapes.
 */
export type PushTokenDoc =
  | { platform: 'android' | 'web'; updatedAt: number }
  | { platform: 'ios'; apnsEnvironment: ApnsEnvironment; updatedAt: number };

/**
 * How long an inbox entry is kept before the weekly sweep removes it.
 *
 * Shared so the number the server enforces is the number the settings screen
 * quotes — a retention period the app states and does not honour (or honours
 * and never states) is worse than no statement at all.
 *
 * Pruned by AGE, read or not. Alerts only ever lists the newest 50, so an unread
 * entry older than that is already unreachable: keeping it would leave the badge
 * counting something nobody can open or dismiss.
 */
export const NOTIFICATION_RETENTION_DAYS = 90;
