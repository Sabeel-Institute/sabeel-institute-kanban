import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  MAX_RECENT_BOARDS,
  canSeeEveryBoard,
  newBoard,
  pushRecent,
  type BoardColumn,
  type BoardDoc,
} from '@sabeel/shared';
import { db, functions } from './firebase';
import { useLiveDoc, useLiveQuery } from './liveQuery';
import type { SessionUser } from './session';
import { createViewStore } from './viewState';

export interface BoardMemberProfile {
  uid: string;
  displayName: string;
  email: string;
}

export interface BoardListItem {
  id: string;
  name: string;
  description: string;
  archived: boolean;
  memberUids: string[];
  /**
   * Who is on this board, with names. Read from the board doc rather than
   * `users/*` because only admins may list the directory — every member needs
   * this to assign a card or @mention someone.
   */
  members: BoardMemberProfile[];
  /**
   * Who may administer this board. Read together with `memberUids` — see
   * `canManageBoard` in @sabeel/shared, which every gate on this screen uses.
   */
  boardOwnerUids: string[];
  /**
   * Who made it. Carried because the members list badges that row and disables
   * its Owner toggle for everyone but an admin: the creator cannot be unseated by
   * someone they delegated to.
   */
  createdBy: string;
  columns: BoardColumn[];
  /** Non-archived cards on the board (server-maintained; shown in the Boards list). */
  activeCardCount: number;
}

function toBoard(id: string, data: Record<string, unknown>): BoardListItem {
  const uids = (data.memberUids as string[]) ?? [];
  const profiles =
    (data.memberProfiles as Record<string, { displayName: string; email: string }>) ?? {};

  return {
    id,
    name: (data.name as string) ?? '(untitled)',
    description: (data.description as string) ?? '',
    archived: Boolean(data.archived),
    memberUids: uids,
    // Derived from memberUids so a missing profile never hides a member — it
    // just shows a placeholder name until the next membership write fills it in.
    members: uids
      .map((uid) => ({
        uid,
        displayName: profiles[uid]?.displayName ?? 'Someone',
        email: profiles[uid]?.email ?? '',
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    // `?? []` on purpose: a board written before ownership existed has no field,
    // and the right reading of that is "nobody owns it" — an admin repairs it.
    // Every consumer goes through `canManageBoard`, which treats it that way.
    boardOwnerUids: (data.boardOwnerUids as string[]) ?? [],
    createdBy: (data.createdBy as string) ?? '',
    columns: (data.columns as BoardColumn[]) ?? [],
    activeCardCount: (data.activeCardCount as number) ?? 0,
  };
}

/**
 * The boards you can see.
 *
 * ADMINS query unconstrained (rules allow it because `isAdmin()` does not depend
 * on document data). Everyone else MUST carry the array-contains constraint —
 * without it Firestore rejects the whole query rather than filtering, since it
 * cannot prove the result set is readable.
 *
 * It used to be managers who queried unconstrained, and an app build that still
 * does is the one thing the ownership migration visibly breaks: the new rules
 * refuse that query, so their Boards screen errors until they update.
 */
export function useMyBoards(user: SessionUser) {
  const seesAll = canSeeEveryBoard(user);
  return useLiveQuery<BoardListItem[]>(
    () =>
      seesAll
        ? collection(db, 'boards')
        : query(collection(db, 'boards'), where('memberUids', 'array-contains', user.uid)),
    [user.uid, seesAll],
    'boards',
    (docs) => docs.map((d) => toBoard(d.id, d.data)).filter((b) => !b.archived),
  );
}

/** Archived boards — everyone's own, and every one of them for an admin. */
export function useArchivedBoards(user: SessionUser) {
  const seesAll = canSeeEveryBoard(user);
  return useLiveQuery<BoardListItem[]>(
    () =>
      seesAll
        ? collection(db, 'boards')
        : query(collection(db, 'boards'), where('memberUids', 'array-contains', user.uid)),
    [user.uid, seesAll],
    'archived-boards',
    (docs) => docs.map((d) => toBoard(d.id, d.data)).filter((b) => b.archived),
  );
}

export function useBoard(boardId: string) {
  return useLiveDoc<BoardListItem | null>(
    () => doc(db, 'boards', boardId),
    [boardId],
    'board',
    (d) => (d ? toBoard(d.id, d.data) : null),
  );
}

export async function createBoard(name: string, user: SessionUser): Promise<string> {
  const board: BoardDoc = newBoard({
    name,
    createdBy: user.uid,
    createdByProfile: { displayName: user.displayName, email: user.email },
    now: Date.now(),
  });
  const ref = await addDoc(collection(db, 'boards'), board);
  return ref.id;
}

/**
 * A board patch. `columns` may ONLY be written together with `columnIds` — the
 * type enforces what a comment cannot: rules validate card writes against the
 * flat mirror, so a desynced pair makes cards uncreatable in the new column with
 * a bare PERMISSION_DENIED as the only clue. Build it with `columnsPatch()`.
 */
export type BoardPatch = Partial<
  Pick<BoardListItem, 'name' | 'description' | 'archived'>
> &
  ({ columns: BoardColumn[]; columnIds: string[] } | { columns?: never; columnIds?: never });

export async function updateBoard(
  boardId: string,
  patch: BoardPatch,
): Promise<void> {
  // `createdBy` must be echoed back: the update rule pins it to its existing
  // value so authorship cannot be rewritten, and Firestore rules compare against
  // the full incoming document.
  const snap = await getDoc(doc(db, 'boards', boardId));
  const createdBy = snap.data()?.createdBy;
  await updateDoc(doc(db, 'boards', boardId), { ...patch, createdBy });
}

/**
 * Adding somebody is a callable too, for two reasons.
 *
 * `firestore.rules` allows `list` on `users/` to admins alone, so a non-admin
 * board owner had nothing to pick from even though the write was permitted —
 * which is the bug this replaced. And with the server doing the write it also
 * supplies the profile, so an owner cannot put an arbitrary name or address
 * against a uid.
 */
const addMemberFn = httpsCallable<
  { boardId: string; uid: string },
  { ok: boolean; added: boolean }
>(functions, 'addBoardMember');

export async function addBoardMember(boardId: string, uid: string): Promise<void> {
  await addMemberFn({ boardId, uid });
}

/**
 * Who could still be added. NAMES ONLY — a picker needs something to tap, not
 * everybody's address.
 */
const addableFn = httpsCallable<
  { boardId: string },
  { people: { uid: string; displayName: string }[] }
>(functions, 'listAddableUsers');

export async function listAddableUsers(
  boardId: string,
): Promise<{ uid: string; displayName: string }[]> {
  const res = await addableFn({ boardId });
  return res.data.people;
}

/**
 * Promote or demote a board owner.
 *
 * A plain board write, not a callable: `boardOwnerUids` is a field on a document
 * the rules already guard, and `ownsBoard()` decides this exactly as it decides a
 * rename. A callable would be a second place for the same check to live, and the
 * two would eventually disagree.
 *
 * `arrayUnion`/`arrayRemove` rather than writing the whole list, so two people
 * promoting at the same moment cannot lose each other's change. `createdBy` is
 * echoed back for the reason `updateBoard` explains.
 *
 * The rules refuse to let anyone but an admin take the CREATOR out of this list —
 * including the creator themselves — so a failure here on that row is the
 * protection working, not a bug.
 */
export async function setBoardOwner(
  boardId: string,
  uid: string,
  isOwner: boolean,
): Promise<void> {
  const snap = await getDoc(doc(db, 'boards', boardId));
  await updateDoc(doc(db, 'boards', boardId), {
    boardOwnerUids: isOwner ? arrayUnion(uid) : arrayRemove(uid),
    createdBy: snap.data()?.createdBy,
  });
}

const solelyOwnedFn = httpsCallable<
  { uid: string },
  { boards: { id: string; name: string }[] }
>(functions, 'boardsSolelyOwnedBy');

/**
 * Boards this person is the only owner of — asked BEFORE disabling them, so the
 * consequence appears in the confirmation rather than as a surprise afterwards.
 * Same shape as `countMemberAssignments`.
 */
export async function boardsSolelyOwnedBy(
  uid: string,
): Promise<{ id: string; name: string }[]> {
  const res = await solelyOwnedFn({ uid });
  return res.data.boards;
}

/**
 * Removal goes through a callable, because membership and card assignment must
 * move together — see functions/src/boards.ts for why.
 */
const removeMemberFn = httpsCallable<
  { boardId: string; uid: string },
  { ok: boolean; unassignedCards: number }
>(functions, 'removeBoardMember');

export async function removeBoardMember(
  boardId: string,
  uid: string,
): Promise<number> {
  const res = await removeMemberFn({ boardId, uid });
  return res.data.unassignedCards;
}

const countAssignmentsFn = httpsCallable<
  { boardId: string; uid: string },
  { count: number }
>(functions, 'countMemberAssignments');

/** "Remove Sara?" and "Remove Sara, unassigning 12 cards?" are different questions. */
export async function countMemberAssignments(
  boardId: string,
  uid: string,
): Promise<number> {
  const res = await countAssignmentsFn({ boardId, uid });
  return res.data.count;
}

// ---- Per-user board list state (favourites and recents) --------------------

export async function toggleFavourite(
  user: SessionUser,
  boardId: string,
  favourites: readonly string[],
): Promise<void> {
  const next = favourites.includes(boardId)
    ? favourites.filter((id) => id !== boardId)
    : [...favourites, boardId];
  await updateDoc(doc(db, 'users', user.uid), { favoriteBoardIds: next });
}

export async function noteBoardOpened(
  user: SessionUser,
  boardId: string,
  recents: readonly string[],
): Promise<void> {
  const next = pushRecent(recents, boardId, MAX_RECENT_BOARDS);
  if (next[0] === recents[0] && next.length === recents.length) return;
  await updateDoc(doc(db, 'users', user.uid), { recentBoardIds: next });
}

/** The signed-in user's own list preferences, live. */
export function useMyBoardPrefs(user: SessionUser) {
  return useLiveDoc<{ favourites: string[]; recents: string[] }>(
    () => doc(db, 'users', user.uid),
    [user.uid],
    'board-prefs',
    (d) => ({
      favourites: (d?.data.favoriteBoardIds as string[]) ?? [],
      recents: (d?.data.recentBoardIds as string[]) ?? [],
    }),
  );
}


/**
 * The boards-list filter text. Same reason as the two above: typing to find a
 * board, opening it, and coming back used to hand you the unfiltered list again.
 */
export const boardsView = createViewStore<{ filter: string }>({ filter: '' });
