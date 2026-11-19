import { finishedColumnId, isFinished, type LaneBoard, type LaneCard } from './lanes';

/**
 * A parent card stays out of the finished column while it has open subtasks
 * (#111; Faisal, 2026-11-18: always, on every board with lanes, no setting).
 * Otherwise a parent reads as finished, and never late, while work under it,
 * often someone else's, is still open.
 *
 * An OPEN subtask is one on the same board that is neither finished nor
 * archived: an archived subtask has been put away, so it no longer holds its
 * parent back. Subtasks are board-scoped by convention (`parentId`), and a
 * link to a card on another board draws as nothing, so only this board's cards
 * are asked.
 *
 * Every way of moving a card asks this one function — the card's column
 * picker, a drag on either wide board, the selection bar's Move — so none can
 * let through what another refuses. Rules cannot see subtasks, so this is the
 * app's to keep, as the other lane rules are. A board without lanes has no
 * finished column, so nothing is ever refused there.
 */
export interface FinishCard extends LaneCard {
  id: string;
  title: string;
  parentId?: string;
}

export interface FinishBlocker<T extends FinishCard> {
  parent: T;
  /** Its open subtasks, in the order given. */
  open: T[];
}

/**
 * Each moving card that would land in the finished column with open subtasks,
 * and those subtasks. Subtasks moving into the finished column with their
 * parent finish with it, so they do not count. Empty: the move may go ahead.
 */
export function finishBlockers<T extends FinishCard>(params: {
  board: LaneBoard;
  toColumnId: string;
  /** The cards being moved, as they are now. */
  moving: readonly T[];
  /** The board's cards; archived ones are skipped, so either list will do. */
  cards: readonly T[];
}): FinishBlocker<T>[] {
  const { board, toColumnId, moving, cards } = params;
  if (toColumnId !== finishedColumnId(board)) return [];
  const movingIds = new Set(moving.map((c) => c.id));
  const out: FinishBlocker<T>[] = [];
  for (const parent of moving) {
    // Already finished, it is not going INTO the finished column: a reorder
    // or a lane change within it is not refused (a board that switches lanes
    // on, or moves its finish, can hold finished parents with open subtasks).
    if (isFinished(parent, board)) continue;
    const open = cards.filter(
      (c) =>
        c.parentId === parent.id &&
        c.archived !== true &&
        !movingIds.has(c.id) &&
        !isFinished(c, board),
    );
    if (open.length > 0) out.push({ parent, open });
  }
  return out;
}

/** The refusal in words: which card, which subtasks, and what to do. */
export function finishBlockedMessage<T extends FinishCard>(
  blockers: readonly FinishBlocker<T>[],
  columnName: string,
): string {
  const quote = (c: FinishCard) => `“${c.title}”`;
  const list = (cs: readonly FinishCard[]) =>
    cs.length <= 3
      ? cs.map(quote).join(', ')
      : `${cs.slice(0, 3).map(quote).join(', ')} and ${cs.length - 3} more`;
  if (blockers.length === 1) {
    const { parent, open } = blockers[0];
    return `${quote(parent)} can’t go to ${columnName} while ${
      open.length === 1 ? 'its subtask' : `${open.length} of its subtasks`
    } ${open.length === 1 ? 'is' : 'are'} still open: ${list(open)}. Finish ${
      open.length === 1 ? 'it' : 'them'
    } first.`;
  }
  return `${blockers.length} cards can’t go to ${columnName} while they have open subtasks: ${list(
    blockers.map((b) => b.parent),
  )}. Finish their subtasks first.`;
}

/**
 * What every move path asks: the refusal in words, or null when the move may
 * go ahead. Names the destination column as the board does.
 */
export function finishRefusal<T extends FinishCard>(params: {
  board: Omit<LaneBoard, 'columns'> & { columns: readonly { id: string; name: string }[] };
  toColumnId: string;
  moving: readonly T[];
  cards: readonly T[];
}): string | null {
  const blockers = finishBlockers(params);
  if (blockers.length === 0) return null;
  const name = params.board.columns.find((c) => c.id === params.toColumnId)?.name ?? 'the finished column';
  return finishBlockedMessage(blockers, name);
}

/**
 * A subtask is not reopened while the card it belongs to is finished or
 * archived (Faisal, 2026-11-18): it would be open work under a card that
 * reads as done. To reopen it, it is unlinked from its parent first.
 *
 * Reopening is taking a subtask out of the finished column, or restoring an
 * archived one, to anywhere but the finished column. `parentOf` answers for a
 * parent id: the parent as it is (looked up off the board when it is not on
 * it), or undefined for one that is gone or on another board, which holds
 * nothing back. A parent moving in the same move ends where its subtask
 * does, so it is not finished by it.
 */
export interface ParentState {
  id: string;
  title: string;
  columnId: string;
  archived?: boolean;
}

export interface ReopenBlocker<T extends FinishCard> {
  card: T;
  parent: ParentState;
  why: 'finished' | 'archived';
}

/**
 * The moving cards whose parent's state could refuse this move: subtasks
 * being reopened on a board with lanes. Only these need a parent looked up,
 * so an ordinary move never waits on a read.
 */
export function reopenCandidates<T extends FinishCard>(params: {
  board: LaneBoard;
  toColumnId: string;
  moving: readonly T[];
}): T[] {
  const { board, toColumnId, moving } = params;
  const done = finishedColumnId(board);
  if (done === null || toColumnId === done) return [];
  return moving.filter((c) => !!c.parentId && (c.archived === true || isFinished(c, board)));
}

export function reopenBlockers<T extends FinishCard>(params: {
  board: LaneBoard;
  toColumnId: string;
  moving: readonly T[];
  parentOf: (id: string) => ParentState | undefined;
}): ReopenBlocker<T>[] {
  const { board, toColumnId, moving, parentOf } = params;
  const done = finishedColumnId(board);
  if (done === null || toColumnId === done) return [];
  const movingIds = new Set(moving.map((c) => c.id));
  const out: ReopenBlocker<T>[] = [];
  for (const card of moving) {
    if (!card.parentId) continue;
    const reopening = card.archived === true || isFinished(card, board);
    if (!reopening) continue;
    const parent = parentOf(card.parentId);
    if (!parent) continue;
    if (parent.archived) out.push({ card, parent, why: 'archived' });
    else if (!movingIds.has(parent.id) && isFinished(parent, board)) out.push({ card, parent, why: 'finished' });
  }
  return out;
}

/** The refusal in words, and what to do instead. */
export function reopenBlockedMessage<T extends FinishCard>(blockers: readonly ReopenBlocker<T>[]): string {
  const quote = (s: string) => `“${s}”`;
  if (blockers.length === 1) {
    const { card, parent, why } = blockers[0];
    const unlink = `open ${quote(card.title)} and tap “Unlink from parent card”`;
    return why === 'archived'
      ? `${quote(card.title)} is a subtask of ${quote(parent.title)}, which is archived. Restore ${quote(parent.title)} first, or to reopen ${quote(card.title)} on its own, unlink it from its parent: ${unlink}.`
      : `${quote(card.title)} is a subtask of ${quote(parent.title)}, which is finished. To reopen it, first unlink it from its parent: ${unlink}.`;
  }
  return `${blockers.length} of these cards are subtasks of cards that are finished or archived: ${blockers
    .map((b) => quote(b.card.title))
    .join(', ')}. To reopen them, first unlink each from its parent card.`;
}
