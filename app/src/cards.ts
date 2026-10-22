import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  deleteField,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  compareRank,
  needsRerank,
  parentAfterMove,
  rankBetween,
  rerank,
  type BoardColumn,
  type CardDoc,
  type Priority,
} from '@sabeel/shared';
import { db } from './firebase';
import { useLiveDoc, useLiveQuery } from './liveQuery';
import type { SessionUser } from './session';

export interface Card {
  id: string;
  /** The board this card is on. Cards are a top-level collection; boardId is a
   *  field, not the path. A cross-board move mutates it (Phase B). */
  boardId: string;
  title: string;
  description: string;
  columnId: string;
  rank: string;
  assigneeUids: string[];
  /** Who subscribed to this card's comments. See CardDoc.subscriberUids. */
  subscriberUids: string[];
  dueDate?: string;
  priority: Priority;
  labelIds: string[];
  archived: boolean;
  /** When it was archived. Absent on cards archived before this was recorded. */
  archivedAt?: number;
  commentCount: number;
  /** Ready files. Absent on cards written before attachments — read as 0. */
  attachmentCount: number;
  /** The card this one is a subtask of. Board-scoped — see CardDoc.parentId. */
  parentId?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

function toCard(id: string, d: Record<string, unknown>): Card {
  return {
    id,
    boardId: (d.boardId as string) ?? '',
    title: (d.title as string) ?? '',
    description: (d.description as string) ?? '',
    columnId: (d.columnId as string) ?? '',
    rank: (d.rank as string) ?? '',
    assigneeUids: (d.assigneeUids as string[]) ?? [],
    subscriberUids: (d.subscriberUids as string[]) ?? [],
    dueDate: d.dueDate as string | undefined,
    priority: (d.priority as Priority) ?? 'none',
    labelIds: (d.labelIds as string[]) ?? [],
    archived: Boolean(d.archived),
    archivedAt: d.archivedAt as number | undefined,
    commentCount: (d.commentCount as number) ?? 0,
    attachmentCount: (d.attachmentCount as number) ?? 0,
    parentId: d.parentId as string | undefined,
    createdBy: (d.createdBy as string) ?? '',
    createdAt: (d.createdAt as number) ?? 0,
    updatedAt: (d.updatedAt as number) ?? 0,
  };
}

// Cards are a TOP-LEVEL collection (`cards/{id}`), keyed to a board by a
// `boardId` field. This is the single place card paths are built.
const cardsRef = () => collection(db, 'cards');
const cardRef = (cardId: string) => doc(db, 'cards', cardId);

/** Live cards for a board, already in rank order. */
export function useBoardCards(boardId: string) {
  return useLiveQuery<Card[]>(
    () =>
      query(
        cardsRef(),
        where('boardId', '==', boardId),
        where('archived', '==', false),
        orderBy('rank'),
      ),
    [boardId],
    'cards',
    (docs) => docs.map((d) => toCard(d.id, d.data)).sort(compareRank),
  );
}

/**
 * The ARCHIVED cards of a board — the other half of `useBoardCards`.
 *
 * Archiving is meant to be reversible, but until this existed the only route
 * back was global Search with a non-obvious "Including archived" toggle, from a
 * different tab, which nobody found. Uses the same (boardId, archived, rank)
 * index, just the other value of `archived`.
 */
export function useArchivedBoardCards(boardId: string) {
  return useLiveQuery<Card[]>(
    () =>
      query(
        cardsRef(),
        where('boardId', '==', boardId),
        where('archived', '==', true),
        orderBy('rank'),
      ),
    [boardId],
    'archivedCards',
    // Ordered NEWEST-ARCHIVED FIRST, in memory. The query keeps orderBy('rank')
    // so it reuses the existing (boardId, archived, rank) index, but rank is a
    // board-position and means nothing once a card is off the board — what you
    // want here is "the thing I just archived", at the top. Cards archived
    // before `archivedAt` was recorded on every path sort last, by rank.
    (docs) => {
      const cards = docs.map((d) => toCard(d.id, d.data));
      return cards.sort((a, bb) => {
        if (a.archivedAt !== undefined && bb.archivedAt !== undefined) {
          return bb.archivedAt - a.archivedAt;
        }
        if (a.archivedAt !== undefined) return -1;
        if (bb.archivedAt !== undefined) return 1;
        return compareRank(a, bb);
      });
    },
  );
}

export function useCard(cardId: string) {
  return useLiveDoc<Card | null>(
    () => cardRef(cardId),
    [cardId],
    'card',
    (d) => (d ? toCard(d.id, d.data) : null),
  );
}

export function cardsInColumn(cards: readonly Card[], columnId: string): Card[] {
  return cards.filter((c) => c.columnId === columnId).sort(compareRank);
}

/**
 * Read a card once to find which board it lives on — for opening a shared link,
 * where we hold only the (board-stable) card id. Returns null when the card is
 * gone OR unreadable: a non-member's read is denied by the rules, and to them a
 * card they cannot see is indistinguishable from one that no longer exists.
 */
export async function findCardBoard(cardId: string): Promise<string | null> {
  try {
    const snap = await getDoc(cardRef(cardId));
    return snap.exists() ? ((snap.data().boardId as string | undefined) ?? null) : null;
  } catch {
    return null;
  }
}

export async function createCard(params: {
  boardId: string;
  columnId: string;
  title: string;
  user: SessionUser;
  /** Existing cards in the target column, so the new one lands at the bottom. */
  columnCards: readonly Card[];
}): Promise<string> {
  const last = params.columnCards[params.columnCards.length - 1] ?? null;
  const now = Date.now();
  const card: CardDoc = {
    boardId: params.boardId,
    title: params.title.trim(),
    description: '',
    columnId: params.columnId,
    rank: rankBetween(last?.rank ?? null, null),
    assigneeUids: [],
    priority: 'none',
    labelIds: [],
    archived: false,
    commentCount: 0,
    attachmentCount: 0,
    createdAt: now,
    createdBy: params.user.uid,
    updatedAt: now,
    updatedBy: params.user.uid,
  };
  const ref = await addDoc(cardsRef(), card);
  return ref.id;
}

export async function updateCard(
  cardId: string,
  patch: Partial<Omit<Card, 'id' | 'createdAt' | 'createdBy'>>,
  user: SessionUser,
): Promise<void> {
  // `undefined` means "clear this field", but Firestore REJECTS undefined
  // outright — `updateDoc` throws "Unsupported field value: undefined" rather
  // than removing anything. Clearing a due date failed with exactly that, in the
  // user's face, and left the date on screen. Optional fields have to be mapped
  // to deleteField() explicitly.
  const patched: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    patched[key] = value === undefined ? deleteField() : value;
  }

  await updateDoc(cardRef(cardId), {
    ...patched,
    updatedAt: Date.now(),
    updatedBy: user.uid,
  });
}

/**
 * Subscribe to (or unsubscribe from) a card's comments.
 *
 * Deliberately NOT routed through `updateCard`, and the difference is the point:
 * this writes `updatedBy` because the rules pin it to the writer, but leaves
 * `updatedAt` alone. Subscribing is not an edit to the work.
 *
 * That combination is what keeps it invisible where it should be. `diffCard`
 * does not look at `subscriberUids`, so no activity entry is written; the
 * notify trigger only reacts to assignment and column changes, so nothing is
 * sent; and leaving `updatedAt` untouched keeps the card out of the top of
 * Search's newest-first browse order. Following a conversation should not look
 * like doing work on it.
 */
export async function subscribeToCard(
  cardId: string,
  user: SessionUser,
  subscribed: boolean,
): Promise<void> {
  await updateDoc(cardRef(cardId), {
    subscriberUids: subscribed ? arrayUnion(user.uid) : arrayRemove(user.uid),
    updatedBy: user.uid,
  });
}

/**
 * Move a card to a position in a column. ONE document write, which is what makes
 * two people dragging in the same column both succeed — see
 * packages/shared/src/rank.ts.
 *
 * `before`/`after` are the cards that will surround it at the destination.
 */
export async function moveCard(params: {
  card: Card;
  toColumnId: string;
  before: Card | null;
  after: Card | null;
  user: SessionUser;
}): Promise<void> {
  const rank = rankBetween(params.before?.rank ?? null, params.after?.rank ?? null);
  await updateCard(params.card.id, { columnId: params.toColumnId, rank }, params.user);
}

/** Members archive; only this board's owners and admins destroy. Rules enforce both. */
export async function archiveCard(cardId: string, user: SessionUser): Promise<void> {
  // `archivedAt` on EVERY archive path, not just the bulk one. It was written by
  // bulkArchive alone, so half the archive had the field and half did not — and
  // the archive screen, which wants "what did I just put away", had nothing
  // trustworthy to order by.
  await updateCard(cardId, { archived: true, archivedAt: Date.now() }, user);
}

/**
 * Bring an archived card back to the board.
 *
 * The column it was archived FROM may no longer exist, and that is not exotic:
 * a column is deletable once it holds no LIVE cards, and the message shown when
 * it is blocked tells you to "move or archive them first" — so archiving a
 * column's cards and then deleting it is the documented path. Restoring such a
 * card with its stale `columnId` is rejected outright by firestore.rules, whose
 * `wellFormed()` requires `columnId in board.columnIds` on every update. The
 * card would be frozen: unrestorable, uneditable, and (for a member, who cannot
 * delete) with no way out at all.
 *
 * So restore lands it in the first column when its own is gone, at the bottom,
 * and reports where it went — the caller tells the user, because a card
 * quietly reappearing somewhere else is its own kind of lost.
 */
export async function restoreCard(
  card: Card,
  user: SessionUser,
  columns: readonly BoardColumn[],
): Promise<{ movedTo?: string }> {
  // `archivedAt: undefined` clears the field (updateCard maps undefined to
  // deleteField). A live card carrying a stale archive time would sort wrongly
  // the next time it is archived.
  if (columns.some((col) => col.id === card.columnId)) {
    await updateCard(card.id, { archived: false, archivedAt: undefined }, user);
    return {};
  }
  const target = columns[0];
  if (!target) {
    throw new Error(
      'This board has no columns to restore into. Add a column first.',
    );
  }
  const last = await destColumnLastRank(card.boardId, target.id);
  await updateCard(
    card.id,
    {
      archived: false,
      archivedAt: undefined,
      columnId: target.id,
      rank: rankBetween(last, null),
    },
    user,
  );
  return { movedTo: target.name };
}

export async function deleteCard(cardId: string): Promise<void> {
  await deleteDoc(cardRef(cardId));
}

// ---- Bulk actions ---------------------------------------------------------
//
// Multi-select exists partly for its own sake and partly because deleting a
// column is blocked while it holds cards: clearing a stale column of forty cards
// must not be forty separate gestures.
//
// Every bulk operation is ONE batch, so a partial application is impossible —
// either the whole selection moves or none of it does.

/** Move many cards into a column at once, preserving their relative order. */
export async function bulkMove(params: {
  cards: readonly Card[];
  toColumnId: string;
  /** Cards already in the destination, so the moved block lands after them. */
  destinationCards: readonly Card[];
  user: SessionUser;
}): Promise<void> {
  const moving = [...params.cards].sort(compareRank);
  const staying = params.destinationCards.filter(
    (c) => !moving.some((m) => m.id === c.id),
  );

  const batch = writeBatch(db);
  let prev = staying[staying.length - 1]?.rank ?? null;

  for (const card of moving) {
    // Ranks are assigned in sequence so the selection keeps its order at the
    // destination rather than arriving scrambled.
    const rank = rankBetween(prev, null);
    prev = rank;
    batch.update(cardRef(card.id), {
      columnId: params.toColumnId,
      rank,
      updatedAt: Date.now(),
      updatedBy: params.user.uid,
    });
  }

  await batch.commit();
}

export async function bulkArchive(
  cards: readonly Card[],
  user: SessionUser,
): Promise<void> {
  const batch = writeBatch(db);
  for (const c of cards) {
    batch.update(cardRef(c.id), {
      archived: true,
      archivedAt: Date.now(),
      updatedAt: Date.now(),
      updatedBy: user.uid,
    });
  }
  await batch.commit();
}

/** This board's owners and admins only — rules enforce it on the bulk path too. */
export async function bulkDelete(cards: readonly Card[]): Promise<void> {
  const batch = writeBatch(db);
  for (const c of cards) {
    batch.delete(cardRef(c.id));
  }
  await batch.commit();
}

/** Add or remove one person across a selection. */
export async function bulkAssign(params: {
  cards: readonly Card[];
  uid: string;
  assign: boolean;
  user: SessionUser;
}): Promise<void> {
  const batch = writeBatch(db);
  for (const c of params.cards) {
    const next = params.assign
      ? Array.from(new Set([...c.assigneeUids, params.uid]))
      : c.assigneeUids.filter((u) => u !== params.uid);
    batch.update(cardRef(c.id), {
      assigneeUids: next,
      updatedAt: Date.now(),
      updatedBy: params.user.uid,
    });
  }
  await batch.commit();
}

// ---- Cross-board move & copy ----------------------------------------------
//
// A move is now just an `update` of `boardId` (the card doc, and its comments/
// activity underneath it, stay put) — so any board member may do it and the
// delete gate never applies. A copy is a fresh card. In both cases labels are
// cleared (they belong to the source board) and assignees are filtered to
// members of the destination (the invariant that keeps "My Work" secure). Rules
// enforce membership of both boards, the destination column, and the assignee
// subset; the filtering here is what makes the write pass.

/** The rank of the last card in a destination column, so arrivals land at the
 *  bottom. Reuses the (boardId, archived, rank) board-view index. */
async function destColumnLastRank(
  destBoardId: string,
  destColumnId: string,
): Promise<string | null> {
  const snap = await getDocs(
    query(
      cardsRef(),
      where('boardId', '==', destBoardId),
      where('archived', '==', false),
      orderBy('rank'),
    ),
  );
  // The query is orderBy('rank') ascending, so after filtering to the column the
  // last entry holds the greatest rank — no re-sort needed.
  const ranks = snap.docs
    .map((d) => d.data())
    .filter((c) => c.columnId === destColumnId)
    .map((c) => c.rank as string)
    .filter(Boolean);
  return ranks[ranks.length - 1] ?? null;
}

const keepMembers = (uids: readonly string[], members: readonly string[]) =>
  uids.filter((u) => members.includes(u));

/** Move a selection to a column on another board — one batched write. */
export async function bulkMoveToBoard(params: {
  cards: readonly Card[];
  destBoardId: string;
  destColumnId: string;
  destMemberUids: readonly string[];
  user: SessionUser;
}): Promise<void> {
  const moving = [...params.cards].sort(compareRank);
  // Which cards are travelling together. A subtask link only survives if BOTH
  // ends move — select a parent and its subtasks and the family arrives intact;
  // move a child on its own and it arrives unlinked, because its parent stayed
  // behind and the id would resolve to nothing.
  const movingIds = new Set(moving.map((c) => c.id));
  let prev = await destColumnLastRank(params.destBoardId, params.destColumnId);
  const now = Date.now();
  const batch = writeBatch(db);
  for (const card of moving) {
    const rank = rankBetween(prev, null);
    prev = rank;
    const keptParent = parentAfterMove(card, movingIds);
    batch.update(cardRef(card.id), {
      boardId: params.destBoardId,
      columnId: params.destColumnId,
      rank,
      // `labelIds` is deliberately NOT reset. Labels are org-wide, so they mean
      // the same thing on the destination; a move used to strip every one of
      // them because the ids were board-local and would have resolved to
      // nothing. Assignees still have to be filtered — membership IS per board.
      assigneeUids: keepMembers(card.assigneeUids, params.destMemberUids),
      // Subscribers get the SAME filter, and must: the read rule has a
      // subscriber arm, so carrying one across to a board they are not on would
      // hand them access — and the rules would reject the write anyway.
      subscriberUids: keepMembers(card.subscriberUids, params.destMemberUids),
      // Scoped to the cards travelling together: kept only when the parent is
      // coming too, otherwise cleared rather than left dangling.
      parentId: keptParent ?? deleteField(),
      updatedAt: now,
      updatedBy: params.user.uid,
    });
  }
  await batch.commit();
}

/** Copy a selection to a column on another board — fresh cards, no comments. */
export async function bulkCopyToBoard(params: {
  cards: readonly Card[];
  destBoardId: string;
  destColumnId: string;
  destMemberUids: readonly string[];
  user: SessionUser;
}): Promise<void> {
  const copying = [...params.cards].sort(compareRank);
  let prev = await destColumnLastRank(params.destBoardId, params.destColumnId);
  const now = Date.now();
  const batch = writeBatch(db);
  for (const card of copying) {
    const rank = rankBetween(prev, null);
    prev = rank;
    const data = {
      boardId: params.destBoardId,
      title: card.title,
      description: card.description,
      columnId: params.destColumnId,
      rank,
      assigneeUids: keepMembers(card.assigneeUids, params.destMemberUids),
      priority: card.priority,
      // Carried, like priority: a label means the same thing on any board.
      labelIds: card.labelIds,
      archived: false,
      commentCount: 0,
      attachmentCount: 0,
      // No subscribers: a copy has no comments, so there is no conversation to
      // have subscribed to. Same reasoning as commentCount above.
      subscriberUids: [],
      // NOTE: `parentId` is deliberately absent — a copy is a new, independent
      // card and must not inherit a subtask link to the SOURCE board's parent.
      // This literal is untyped, so nothing but this comment stops someone
      // spreading `...card` here and reintroducing it.
      //
      // Subcollections do not come either: a copy gets no comments, no activity
      // and no ATTACHMENTS. Copying files would mean duplicating the bytes, and
      // a copy is a new piece of work rather than a second reference to the
      // same one. A MOVE keeps everything, because the card id does not change.
      createdAt: now,
      createdBy: params.user.uid,
      updatedAt: now,
      updatedBy: params.user.uid,
      ...(card.dueDate ? { dueDate: card.dueDate } : {}),
    };
    batch.set(doc(cardsRef()), data);
  }
  await batch.commit();
}

/**
 * Quietly rebuild a column's ranks when they have collided or grown long.
 *
 * Rank ties are possible — two clients can compute the same value for the same
 * gap — and are cosmetic rather than corrupting, so this is a background tidy-up
 * that nobody waits for and that is safe to skip on failure.
 */
/**
 * Called from the WEB drag path only, and deliberately so.
 *
 * Measured: appending grows a rank by about one character per five or six cards,
 * so `needsRerank`'s length trigger starts firing somewhere past sixty cards in
 * one column, and duplicate ranks are cosmetic anyway — `compareRank` breaks ties
 * on id, so everyone still sees the same order. Nothing is corrupted by skipping
 * this; ranks just get longer.
 *
 * Wiring it into the phone's bulk-move path would rewrite EVERY card in the
 * destination column, in the background, on whatever connection the phone has —
 * trading a cost nobody can see for a burst of writes on mobile data, which is
 * the failure mode this project has already been bitten by once. If a column ever
 * does grow big enough to matter, do it deliberately and where the user can see
 * it, not as a silent side effect of moving one card.
 */
export async function rerankColumnIfNeeded(
  columnCards: readonly Card[],
): Promise<void> {
  if (columnCards.length < 2) return;
  if (!needsRerank(columnCards.map((c) => c.rank))) return;

  const updates = rerank(columnCards);
  if (updates.size === 0) return;

  const batch = writeBatch(db);
  for (const [cardId, rank] of updates) {
    batch.update(cardRef(cardId), { rank });
  }
  await batch.commit();
}
