import { describeActivity } from './activity';
import type { ActivityType } from './types';

/**
 * Change notices: what a card's followers and its column's watchers hear about
 * a burst of activity on it, and when.
 *
 * Every save is its own write, so a push per write chimes once per save —
 * renaming a card, editing its description and attaching a file would buzz a
 * phone three times, and replacing the notification in the tray afterwards does
 * not take the chimes back. So the server collects a card's new history entries
 * (`pendingNotices/{cardId}`) and announces them together once the card has
 * gone quiet. Everything here is pure, so the timing, the recipients and the
 * wording are tested without an emulator; functions/src/notices.ts performs
 * the effects.
 *
 * Notices are worded by `describeActivity`, the same function that writes the
 * card's history, so the two cannot disagree about what happened.
 */

/** How long a card must go without a new entry before its notice is sent. */
export const NOTICE_QUIET_MS = 2 * 60_000;

/**
 * The longest a notice waits after its first entry. Without a ceiling, someone
 * editing a card steadily for an hour would hold every change back for that
 * hour.
 */
export const NOTICE_MAX_WAIT_MS = 10 * 60_000;

/** How many changes one notice spells out before it says "and N more". */
export const NOTICE_PHRASE_LIMIT = 4;

/** The most columns one person may watch; firestore.rules holds the same number. */
export const MAX_WATCHED_COLUMNS = 200;

/** One history entry as a pending notice stores it. */
export interface NoticeEntry {
  type: ActivityType;
  actorUid: string;
  at: number;
  from?: string;
  to?: string;
}

/**
 * A `users.watchedColumns` entry. Firestore ids cannot contain `/`, so the
 * pair reads back unambiguously.
 */
export function watchKey(boardId: string, columnId: string): string {
  return `${boardId}/${columnId}`;
}

/** Whether a `watchKey` names a column on this board. */
export function watchKeyOnBoard(key: string, boardId: string): boolean {
  return key.startsWith(`${boardId}/`);
}

/**
 * Oldest first. Entries from one write share `at`, and the sort is stable, so
 * they keep the order the trigger wrote them in.
 */
function chronological(entries: readonly NoticeEntry[]): NoticeEntry[] {
  return [...entries].sort((a, b) => a.at - b.at);
}

function lastOf(
  entries: readonly NoticeEntry[],
  match: (e: NoticeEntry) => boolean,
): NoticeEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) if (match(entries[i])) return entries[i];
  return undefined;
}

/**
 * Whether a card's notice should go out now: two minutes after its last entry,
 * or ten after its first, whichever is sooner. An empty burst is due at once,
 * which lets the sweep clear the document.
 */
export function noticeDue(entries: readonly NoticeEntry[], now: number): boolean {
  if (entries.length === 0) return true;
  const ats = entries.map((e) => e.at);
  return (
    now >= Math.min(Math.max(...ats) + NOTICE_QUIET_MS, Math.min(...ats) + NOTICE_MAX_WAIT_MS)
  );
}

/**
 * Whether anything about this burst may be announced, given the card as it is
 * now. An archived card is DORMANT: the burst that archived it is still sent,
 * as its last notice, and nothing else is until a restore.
 */
export function noticeAllowed(
  entries: readonly NoticeEntry[],
  card: { archived: boolean },
): boolean {
  if (!card.archived) return true;
  return lastOf(chronological(entries), (e) => e.type === 'archived')?.to === 'true';
}

/**
 * Who follows the card for this notice: its subscribers and assignees, and
 * anyone the burst unassigned, for whom it is the last notice. Only people on
 * the card's board: subscribers and assignees are members by rule, but someone
 * unassigned by being REMOVED from the board is not, and must not be sent the
 * card's title.
 */
export function noticeFollowers(params: {
  entries: readonly NoticeEntry[];
  subscriberUids: readonly string[];
  assigneeUids: readonly string[];
  memberUids: readonly string[];
}): string[] {
  const members = new Set(params.memberUids);
  const unassigned = params.entries
    .filter((e) => e.type === 'unassigned' && e.to)
    .map((e) => e.to as string);
  return [...new Set([...params.subscriberUids, ...params.assigneeUids, ...unassigned])].filter(
    (uid) => members.has(uid),
  );
}

/**
 * What folds into what. A state that changed twice is reported at its last
 * value ("moved it to Done", not to Review and then to Done); per actor, so
 * two people's moves both stay attributable.
 */
function foldKey(e: NoticeEntry): string {
  switch (e.type) {
    case 'moved':
    case 'due':
    case 'priority':
    case 'archived':
    case 'labels':
      return `${e.actorUid}|${e.type}`;
    case 'edited':
      // A rename carries the new title; a description edit carries nothing.
      return `${e.actorUid}|edited|${e.to !== undefined ? 'title' : 'description'}`;
    case 'assigned':
    case 'unassigned':
      return `${e.actorUid}|assignment|${e.to ?? ''}`;
    default:
      return `${e.actorUid}|${e.type}|${e.from ?? ''}|${e.to ?? ''}`;
  }
}

/**
 * The entries one recipient hears about. Nothing they did themselves, and
 * nothing up to and including their own assignment in this burst: that went
 * out at once, and they will see the card as it stood when they open it. Not
 * the card's creation either, which is never news to a follower: the creator
 * made it, and anyone assigned at creation was told then. Column watchers
 * hear about it as an arrival instead. A state that changed more than once is
 * reported once, at its last value.
 */
export function noticeEntriesFor(
  entries: readonly NoticeEntry[],
  recipientUid: string,
): NoticeEntry[] {
  const list = chronological(entries);
  const assignedAt =
    lastOf(list, (e) => e.type === 'assigned' && e.to === recipientUid)?.at ?? -Infinity;
  const kept = list.filter(
    (e) => e.type !== 'created' && e.actorUid !== recipientUid && e.at > assignedAt,
  );
  const lastIndex = new Map<string, number>();
  kept.forEach((e, i) => lastIndex.set(foldKey(e), i));
  return kept.filter((e, i) => lastIndex.get(foldKey(e)) === i);
}

/**
 * The line a follower gets: the card, then each person's changes in their own
 * history wording.
 *
 *   “Budget”: Sara moved it to Done, set the due date to 2026-11-05
 *   “Budget”: Sara attached plan.pdf; Omar unassigned you
 *
 * `entries` is `noticeEntriesFor`'s answer for this recipient.
 */
export function changeNoticeText(params: {
  cardTitle: string;
  entries: readonly NoticeEntry[];
  recipientUid: string;
  nameFor: (uid: string) => string;
  columnNameFor: (columnId: string) => string;
  cardTitleFor?: (cardId: string) => string;
}): string {
  const subject = (uid: string) => (uid === params.recipientUid ? 'you' : params.nameFor(uid));
  const byActor = new Map<string, string[]>();
  for (const e of params.entries) {
    const phrases = byActor.get(e.actorUid) ?? [];
    phrases.push(describeActivity(e, subject, params.columnNameFor, params.cardTitleFor));
    byActor.set(e.actorUid, phrases);
  }

  let budget = NOTICE_PHRASE_LIMIT;
  let hidden = 0;
  const segments: string[] = [];
  for (const [actorUid, phrases] of byActor) {
    const shown = phrases.slice(0, Math.max(budget, 0));
    budget -= shown.length;
    hidden += phrases.length - shown.length;
    if (shown.length > 0) segments.push(`${params.nameFor(actorUid)} ${shown.join(', ')}`);
  }
  const more = hidden > 0 ? `, and ${hidden} more change${hidden === 1 ? '' : 's'}` : '';
  return `“${params.cardTitle}”: ${segments.join('; ')}${more}`;
}

export type ArrivalKind = 'created' | 'moved' | 'restored';

/**
 * Did the card ARRIVE in the column it is in now, during this burst?
 *
 * Decided against the card as it is when the notice is sent, so a card
 * dragged through a column on its way elsewhere tells that column nothing, and
 * one moved out and back again has not arrived anywhere. It arrived if it was
 * created, restored from the archive, or its earliest move in the burst
 * started from another column. The actor is whoever put it where it is: the
 * last move into this column, else the restore, else the creation.
 */
export function arrivalOf(
  entries: readonly NoticeEntry[],
  card: { columnId: string; archived: boolean },
): { kind: ArrivalKind; actorUid: string } | null {
  if (card.archived) return null;
  const list = chronological(entries);
  const created = list.find((e) => e.type === 'created');
  const restored = list.find((e) => e.type === 'archived')?.from === 'true';
  const firstMove = list.find((e) => e.type === 'moved');
  const movedIn = firstMove !== undefined && firstMove.from !== card.columnId;
  if (!created && !restored && !movedIn) return null;

  const by =
    lastOf(list, (e) => e.type === 'moved' && e.to === card.columnId) ??
    lastOf(list, (e) => e.type === 'archived' && e.to === 'false') ??
    created ??
    list[list.length - 1];
  // The verb is that same person's, so the line never pairs one person's name
  // with another's action ("Omar restored it" when Sara restored and Omar moved).
  const kind: ArrivalKind =
    by.type === 'moved'
      ? 'moved'
      : by.type === 'archived'
        ? 'restored'
        : created
          ? 'created'
          : restored
            ? 'restored'
            : 'moved';
  return { kind, actorUid: by.actorUid };
}

/** The line a column's watcher gets. */
export function arrivalText(params: {
  kind: ArrivalKind;
  actorName: string;
  cardTitle: string;
  columnName: string;
}): string {
  const card = `“${params.cardTitle}”`;
  switch (params.kind) {
    case 'created':
      return `${params.actorName} added ${card} to ${params.columnName}`;
    case 'moved':
      return `${params.actorName} moved ${card} into ${params.columnName}`;
    case 'restored':
      return `${params.actorName} restored ${card} to ${params.columnName}`;
  }
}
