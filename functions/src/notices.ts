import './setup';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { getFirestore } from 'firebase-admin/firestore';
import {
  arrivalOf,
  arrivalText,
  changeNoticeText,
  noticeAllowed,
  noticeDue,
  noticeEntriesFor,
  noticeFollowers,
  shouldNotify,
  watchKey,
  type BoardColumn,
  type NoticeEntry,
} from '@sabeel/shared';
import { guardedEvent, reportError, sentryDsn } from './sentry';
import { PUSH_SECRETS } from './messaging';
import { deliver, loadRecipients, type Notice } from './notifications';

/**
 * Change notices, per burst rather than per save.
 *
 * A card's followers (subscribers and assignees) hear about every change its
 * history records, and its column's watchers hear when it arrives. Telling
 * them from the write itself would chime once per save, so every new history
 * entry joins `pendingNotices/{cardId}` instead, and a sweep each minute sends
 * a card's notice once it has gone quiet. The timing, the recipients and the
 * wording are pure functions in @sabeel/shared (notices.ts), tested there;
 * this file reads and writes.
 */

const db = () => getFirestore();

/** How long a sweep claims cards before delivering, well inside its timeout. */
const SWEEP_CLAIM_MS = 30_000;
/** The sweep's timeout: delivery after a full claiming window has minutes. */
const SWEEP_TIMEOUT_SECONDS = 300;

/**
 * Every new history entry joins its card's pending notice, whoever wrote it:
 * the card trigger, the subtask mirror onto a parent, the attachment
 * callables. Keyed by the entry's own id, so a retried trigger writes the
 * same key again rather than adding the change twice.
 */
export const onActivityNotice = onDocumentCreated(
  { document: 'cards/{cardId}/activity/{activityId}', secrets: [sentryDsn] },
  guardedEvent(async (event) => {
    const d = event.data?.data();
    if (!d) return;
    const entry: NoticeEntry = {
      type: d.type,
      actorUid: d.actorUid,
      // Every server writer stamps `at`; an entry without one (a hand-seeded
      // world, an import) would otherwise never fall due and sit here for ever.
      at: typeof d.at === 'number' ? d.at : Date.now(),
      ...(d.from !== undefined ? { from: d.from } : {}),
      ...(d.to !== undefined ? { to: d.to } : {}),
    };
    await db()
      .doc(`pendingNotices/${event.params.cardId}`)
      .set({ entries: { [event.params.activityId]: entry } }, { merge: true });
  }),
);

/**
 * Send every pending notice that is due, and say how many went out.
 *
 * Callable directly so the integration tests can drive it against the
 * emulators: scheduled functions never fire there (there is no pubsub
 * emulator), so the body cannot live inside the `onSchedule` handler.
 *
 * The collection holds only cards edited in the last ten minutes, so reading
 * all of it is cheaper than keeping an index on a due time that every new
 * entry would have to move.
 *
 * Claiming stops at `claimUntil` (by the wall clock), and whatever is claimed
 * by then is delivered. A sweep stopped by its timeout would lose every card
 * it had claimed, since delivery comes last; a backlog (an archive of a whole
 * column, the pile after an outage) instead goes out over several minutes,
 * each card still due when the next sweep reaches it.
 */
export async function runNoticeSweep(
  now: number,
  claimUntil = Date.now() + SWEEP_CLAIM_MS,
): Promise<{ cards: number; sent: number }> {
  const pending = await db().collection('pendingNotices').get();
  const notices: Notice[] = [];
  let cards = 0;
  for (const doc of pending.docs) {
    if (Date.now() >= claimUntil) break;
    const entries = Object.values((doc.data().entries ?? {}) as Record<string, NoticeEntry>);
    if (!noticeDue(entries, now)) continue;

    // Claim it. The delete succeeds only if nothing joined since the read, so
    // an entry landing now waits for the next sweep instead of being lost, and
    // two overlapping sweeps cannot both send the same burst. Claiming BEFORE
    // sending means a crash loses a notice rather than doubling one: the inbox
    // entries carry generated ids, so a doubled send could not be undone.
    try {
      await doc.ref.delete({ lastUpdateTime: doc.updateTime });
    } catch {
      continue;
    }
    if (entries.length === 0) continue;
    cards += 1;
    try {
      notices.push(...(await noticesFor(doc.id, entries)));
    } catch (e) {
      // One unreadable card must not hold back every other card's notice.
      logger.error('notice for one card failed', { cardId: doc.id, error: String(e) });
      await reportError(e);
    }
  }
  // All in one delivery, so someone who follows several of the cards hears
  // once (see `deliver`).
  await deliver(notices);
  return { cards, sent: notices.length };
}

/** The notices one card's burst produces, everyone's preferences applied. */
async function noticesFor(cardId: string, entries: NoticeEntry[]): Promise<Notice[]> {
  const card = (await db().doc(`cards/${cardId}`).get()).data();
  // Deleted since: there is nothing left to open.
  if (!card) return [];
  const archived = card.archived === true;
  if (!noticeAllowed(entries, { archived })) return [];

  const boardId = card.boardId as string;
  const board = (await db().doc(`boards/${boardId}`).get()).data();
  // An archived board is put away, and nothing on it notifies (notify() holds
  // the same line for the immediate events).
  if (!board || board.archived === true) return [];
  const memberUids = (board.memberUids as string[]) ?? [];
  const columns = (board.columns as BoardColumn[]) ?? [];
  const columnNameFor = (id: string) => columns.find((c) => c.id === id)?.name ?? 'another column';

  const followers = noticeFollowers({
    entries,
    subscriberUids: (card.subscriberUids as string[]) ?? [],
    assigneeUids: (card.assigneeUids as string[]) ?? [],
    memberUids,
  });

  // Watchers are checked for membership here because nothing else can: rules
  // cannot look up every board a `watchedColumns` array names. Followers are
  // not also sent the arrival — their change notice already says it moved.
  const arrival = arrivalOf(entries, { columnId: card.columnId as string, archived });
  const watchers = arrival
    ? (
        await db()
          .collection('users')
          .where('watchedColumns', 'array-contains', watchKey(boardId, card.columnId as string))
          .get()
      ).docs
        .map((d) => d.id)
        .filter((uid) => memberUids.includes(uid) && !followers.includes(uid))
    : [];
  if (followers.length === 0 && watchers.length === 0) return [];

  const recipients = await loadRecipients([...followers, ...watchers]);
  const nameFor = await namesFor([
    ...entries.map((e) => e.actorUid),
    ...entries.filter((e) => e.type === 'assigned' || e.type === 'unassigned').map((e) => e.to ?? ''),
  ]);
  const cardTitleFor = await titlesFor(
    boardId,
    entries
      .filter((e) => e.type === 'subtask' || e.type === 'subtaskOf')
      .flatMap((e) => [e.to ?? '', e.from ?? '']),
  );
  const cardTitle = (card.title as string) ?? 'a card';

  const notices: Notice[] = [];
  for (const r of recipients) {
    const allowed = (event: 'cardChanged' | 'columnArrival', actorUid: string) =>
      shouldNotify({
        event,
        recipientUid: r.uid,
        actorUid,
        boardId,
        prefs: r.prefs,
        mutedBoardIds: r.mutedBoardIds,
        status: r.status,
      });

    if (followers.includes(r.uid)) {
      const theirs = noticeEntriesFor(entries, r.uid);
      if (theirs.length === 0) continue;
      const actorUid = theirs[theirs.length - 1].actorUid;
      if (!allowed('cardChanged', actorUid)) continue;
      notices.push({
        uid: r.uid,
        event: 'cardChanged',
        text: changeNoticeText({
          cardTitle,
          entries: theirs,
          recipientUid: r.uid,
          nameFor,
          columnNameFor,
          cardTitleFor,
        }),
        actorUid,
        boardId,
        cardId,
      });
    } else if (arrival && allowed('columnArrival', arrival.actorUid)) {
      notices.push({
        uid: r.uid,
        event: 'columnArrival',
        text: arrivalText({
          kind: arrival.kind,
          actorName: nameFor(arrival.actorUid),
          cardTitle,
          columnName: columnNameFor(card.columnId as string),
        }),
        actorUid: arrival.actorUid,
        boardId,
        cardId,
      });
    }
  }
  return notices;
}

/** Display names for these uids, read once each. */
async function namesFor(uids: readonly string[]): Promise<(uid: string) => string> {
  const unique = [...new Set(uids)].filter(Boolean);
  const snaps = unique.length
    ? await db().getAll(...unique.map((u) => db().doc(`users/${u}`)))
    : [];
  const names = new Map(snaps.map((s) => [s.id, s.data()?.displayName as string | undefined]));
  return (uid) => names.get(uid) ?? 'Someone';
}

/**
 * Titles for the cards subtask entries name, read once each, and only for
 * cards on this board. Everyone told is a member of it, so those they can
 * open; a parent or child that has since moved to another board stays
 * "another card", as the card's own history shows it to someone not on that
 * board.
 */
async function titlesFor(
  boardId: string,
  cardIds: readonly string[],
): Promise<(cardId: string) => string> {
  const unique = [...new Set(cardIds)].filter(Boolean);
  const snaps = unique.length
    ? await db().getAll(...unique.map((id) => db().doc(`cards/${id}`)))
    : [];
  const titles = new Map(
    snaps
      .filter((s) => s.data()?.boardId === boardId)
      .map((s) => [s.id, s.data()?.title as string | undefined]),
  );
  // Unquoted, as the card's history shows it (CardScreen's `cardTitleFor`).
  return (id) => titles.get(id) ?? 'another card';
}

export const noticeSweep = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeoutSeconds: SWEEP_TIMEOUT_SECONDS,
    secrets: [sentryDsn, ...PUSH_SECRETS],
  },
  guardedEvent(async () => {
    const { cards, sent } = await runNoticeSweep(Date.now());
    if (cards > 0) logger.info('notice sweep', { cards, sent });
  }),
);
