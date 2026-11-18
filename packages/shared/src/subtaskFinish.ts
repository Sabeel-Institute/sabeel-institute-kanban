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
