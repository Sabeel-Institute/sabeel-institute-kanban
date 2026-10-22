import {
  collection,
  doc,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { NotifyEvent } from '@sabeel/shared';
import { db } from './firebase';
import { useLiveDoc, useLiveQuery } from './liveQuery';
import type { Route } from './nav';
import type { SessionUser } from './session';
import { createViewStore } from './viewState';

export interface InboxItem {
  id: string;
  type: NotifyEvent;
  boardId: string;
  cardId?: string;
  actorUid: string;
  text: string;
  read: boolean;
  at: number;
}

const inboxRef = (uid: string) => collection(db, 'users', uid, 'notifications');

/**
 * Where a notification takes you when you tap it.
 *
 * ONE mapping, deliberately, because there are two places to tap the same
 * notification: the Alerts list in the app, and the banner in the phone's
 * notification tray. Those arrive by completely different routes — a Firestore
 * document versus an FCM data payload — but they must land on the same screen,
 * so they share this function rather than each deciding for themselves.
 *
 * Takes the loose shape both sources can supply, not `InboxItem`: the push
 * payload is `Record<string, string>` off the wire and has no `id`, `read` or
 * `at`. Returns null when there is nowhere sensible to go, so a caller can leave
 * the user where they are instead of navigating somewhere arbitrary.
 */
export function routeForNotification(n: {
  type?: string;
  boardId?: string;
  cardId?: string;
}): Route | null {
  // Admins only, and it carries no board — the whole point is the person
  // waiting, who lives on the People screen.
  if (n.type === 'newUserPending') return { name: 'users' };
  if (n.cardId && n.boardId) {
    return { name: 'card', boardId: n.boardId, cardId: n.cardId };
  }
  if (n.boardId) return { name: 'board', boardId: n.boardId };
  return null;
}

/**
 * Whether Alerts is showing everything or only what is unread.
 *
 * A view store, not `useState`: tapping a notification navigates away and
 * unmounts this screen, so a local flag would be gone by the time Back returns —
 * and the whole point of the filter is to work through what it lists.
 */
export const alertsView = createViewStore<{ unreadOnly: boolean }>({
  unreadOnly: false,
});

/**
 * The in-app inbox, newest first. Capped — nobody scrolls past 50.
 *
 * `unreadOnly` narrows in the QUERY rather than filtering the loaded page. The
 * cap is on what comes back, so filtering afterwards would hide any unread entry
 * sitting behind 50 read ones — the filter would then be least useful exactly
 * when it is most needed. `(read ASC, at DESC)` is already in
 * firestore.indexes.json, so this costs nothing.
 */
export function useInbox(user: SessionUser, unreadOnly = false) {
  return useLiveQuery<InboxItem[]>(
    () =>
      unreadOnly
        ? query(
            inboxRef(user.uid),
            where('read', '==', false),
            orderBy('at', 'desc'),
            limit(50),
          )
        : query(inboxRef(user.uid), orderBy('at', 'desc'), limit(50)),
    [user.uid, unreadOnly],
    'inbox',
    (docs) =>
      docs.map((d) => ({
        id: d.id,
        type: (d.data.type as NotifyEvent) ?? 'mention',
        boardId: (d.data.boardId as string) ?? '',
        cardId: d.data.cardId as string | undefined,
        actorUid: (d.data.actorUid as string) ?? '',
        text: (d.data.text as string) ?? '',
        read: Boolean(d.data.read),
        at: (d.data.at as number) ?? 0,
      })),
  );
}

/** The unread badge. Maintained by the trigger; read straight off the user doc. */
export function useUnreadCount(user: SessionUser) {
  return useLiveDoc<number>(
    () => doc(db, 'users', user.uid),
    [user.uid],
    'unread-count',
    (d) => (d?.data.unreadNotifCount as number) ?? 0,
  );
}

export async function markRead(user: SessionUser, item: InboxItem): Promise<void> {
  if (item.read) return;
  await markReadById(user.uid, item.id);
}

/**
 * Mark one entry read, by id.
 *
 * Split out from `markRead` because a push tap has an id and nothing else — no
 * `InboxItem`, because the entry was never loaded on this device. Tapping a push
 * has to take the badge down for the same reason tapping in Alerts does: someone
 * who has dealt with the card should not come back to the app and be told there
 * is still 1 unread.
 */
export async function markReadById(uid: string, notifId: string): Promise<void> {
  const notifRef = doc(db, 'users', uid, 'notifications', notifId);
  const userRef = doc(db, 'users', uid);
  // A transaction, not a batch: it RE-READS `read` inside the transaction and
  // only decrements if the entry was genuinely still unread. Two rapid taps (or
  // two tabs) on the same item both see the stale `read: false` on the passed-in
  // snapshot; without the re-read each would `increment(-1)` and drift the badge
  // negative. The decrement stays on the client — rules let it flip `read` and
  // adjust its own `unreadNotifCount`, and a trigger racing that would double-count.
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(notifRef);
    if (!snap.exists() || snap.data().read === true) return;
    tx.update(notifRef, { read: true });
    tx.update(userRef, { unreadNotifCount: increment(-1) });
  });
}

export async function markUnread(user: SessionUser, item: InboxItem): Promise<void> {
  if (!item.read) return;
  await markUnreadById(user.uid, item.id);
}

/**
 * Put one entry back to unread, by id.
 *
 * The inverse of `markReadById` and deliberately its mirror image, down to the
 * transaction: the guard is re-read INSIDE it and only a genuinely-read entry
 * moves, so two rapid taps cannot both `increment(1)` off one stale snapshot and
 * leave the badge counting an entry twice.
 *
 * NOTHING is pushed by this. Push is sent inline by `notify()` at the moment an
 * inbox entry is CREATED (functions/src/notifications.ts) — no trigger watches
 * `users/{uid}/notifications/**` at all, so an update here reaches no server
 * code. `functions/test/integration/notifications.test.ts` pins that, because
 * the day somebody adds an `onDocumentWritten` on this collection, marking a
 * week of alerts unread would re-page the whole organisation.
 */
async function markUnreadById(uid: string, notifId: string): Promise<void> {
  const notifRef = doc(db, 'users', uid, 'notifications', notifId);
  const userRef = doc(db, 'users', uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(notifRef);
    if (!snap.exists() || snap.data().read !== true) return;
    tx.update(notifRef, { read: false });
    tx.update(userRef, { unreadNotifCount: increment(1) });
  });
}

/**
 * Mark everything read in one batch, and zero the badge.
 *
 * The badge goes to 0 rather than down by `unread.length`: the inbox is capped
 * at 50, so if more than that were ever unread the extras are not in `items` and
 * a relative decrement would leave a badge pointing at entries nobody can reach.
 * "Read everything" means the badge is empty.
 */
export async function markAllRead(
  user: SessionUser,
  items: readonly InboxItem[],
): Promise<void> {
  const unread = items.filter((i) => !i.read);
  const batch = writeBatch(db);
  for (const i of unread) {
    batch.update(doc(db, 'users', user.uid, 'notifications', i.id), { read: true });
  }
  batch.update(doc(db, 'users', user.uid), { unreadNotifCount: 0 });
  await batch.commit();
}

/**
 * Delete one entry, decrementing the badge if it was still unread.
 *
 * The decrement is NOT optional: nothing on the server watches for a deleted
 * notification (there is no delete trigger — see functions/src/notifications.ts,
 * which only ever increments on create), so dismissing an unread entry without
 * this leaves the badge counting a document that no longer exists. The user then
 * sees "3" forever with an inbox that has nothing unread in it.
 *
 * Same transaction shape as markRead, and for the same reason: `item.read` comes
 * from a snapshot that may be stale, so the truth is re-read inside the
 * transaction before the badge is touched.
 */
export async function dismiss(user: SessionUser, item: InboxItem): Promise<void> {
  const notifRef = doc(db, 'users', user.uid, 'notifications', item.id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(notifRef);
    if (!snap.exists()) return;
    if (snap.data().read !== true) {
      tx.update(doc(db, 'users', user.uid), { unreadNotifCount: increment(-1) });
    }
    tx.delete(notifRef);
  });
}

/**
 * Empty the inbox in one batch, and zero the badge.
 *
 * Deletes what is loaded — the same capped 50 `markAllRead` covers — and zeroes
 * the badge for the reason given there. No undo, which is why the caller
 * confirms first.
 */
export async function dismissAll(
  user: SessionUser,
  items: readonly InboxItem[],
): Promise<void> {
  if (items.length === 0) return;
  const batch = writeBatch(db);
  for (const i of items) {
    batch.delete(doc(db, 'users', user.uid, 'notifications', i.id));
  }
  batch.update(doc(db, 'users', user.uid), { unreadNotifCount: 0 });
  await batch.commit();
}

// ---- Preferences ----------------------------------------------------------

export function useNotifyPrefs(user: SessionUser) {
  return useLiveDoc<{
    prefs: Partial<Record<NotifyEvent, boolean>>;
    mutedBoardIds: string[];
  }>(
    () => doc(db, 'users', user.uid),
    [user.uid],
    'notify-prefs',
    (d) => ({
      prefs: (d?.data.notifyPrefs as Partial<Record<NotifyEvent, boolean>>) ?? {},
      mutedBoardIds: (d?.data.mutedBoardIds as string[]) ?? [],
    }),
  );
}

export async function setNotifyPref(
  user: SessionUser,
  event: NotifyEvent,
  on: boolean,
  current: Partial<Record<NotifyEvent, boolean>>,
): Promise<void> {
  await updateDoc(doc(db, 'users', user.uid), {
    notifyPrefs: { ...current, [event]: on },
  });
}

export async function setBoardMuted(
  user: SessionUser,
  boardId: string,
  muted: boolean,
  current: readonly string[],
): Promise<void> {
  const next = muted
    ? Array.from(new Set([...current, boardId]))
    : current.filter((id) => id !== boardId);
  await updateDoc(doc(db, 'users', user.uid), { mutedBoardIds: next });
}
