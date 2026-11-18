import { bucketFor } from './due';
import type { BoardLane } from './types';

/**
 * Lanes, and the finished column that comes with them.
 *
 * A board may be divided into lanes (Planning, Marketing, Supplies) as well as
 * columns, and a card sits in one of each. A lane's heading says how many of
 * its cards are finished, which is what lets a board stand in for a
 * program-tracking spreadsheet. A board that does not use lanes looks and
 * behaves exactly as it did before they existed: every function here answers
 * "nothing" for it.
 *
 * The app and the functions read lane state through this module and nowhere
 * else, so the board, a card, My Work, Search and the due-soon reminder cannot
 * disagree about whether a card is finished or a lane is late.
 */

/** The most lanes a board may have (Faisal, 2026-11-15). Restated in firestore.rules. */
export const LANES_MAX = 12;

export const LANE_NAME_MAX = 40;

/** What a lane function needs of a board: its columns and its lane fields. */
export interface LaneBoard {
  columns: readonly { id: string }[];
  lanesOn?: boolean;
  lanes?: readonly BoardLane[];
  doneColumnId?: string;
}

/** What a lane function needs of a card. */
export interface LaneCard {
  columnId: string;
  laneId?: string;
  dueDate?: string;
  archived?: boolean;
}

/**
 * Whether the board is drawn with lanes: switched on, with at least one lane.
 * Switched on with none added, a board is drawn as it always was, so every
 * surface asks this, never `lanesOn` alone.
 */
export function lanesLive(board: LaneBoard): boolean {
  return board.lanesOn === true && (board.lanes?.length ?? 0) > 0;
}

/**
 * The column whose cards count as finished, or null on a board without live
 * lanes, where nothing is finished and every past date is late, as before.
 *
 * The stored id is used while it is still one of the board's columns. The app
 * moves it with every column write (`columnsPatch`); a stored id that is gone
 * anyway, deleted by an app too old to know about lanes, falls back to the last
 * column rather than leaving the board with no finish.
 */
export function finishedColumnId(board: LaneBoard): string | null {
  return lanesLive(board) ? finishedColumnChoice(board) : null;
}

/**
 * The column chosen to hold finished cards, whether or not lanes are live yet:
 * what the Lanes page shows in its "Finished cards are in" choice. Everything
 * that decides whether a card IS finished reads `finishedColumnId` instead.
 */
export function finishedColumnChoice(board: LaneBoard): string | null {
  const { columns, doneColumnId } = board;
  if (doneColumnId && columns.some((c) => c.id === doneColumnId)) return doneColumnId;
  return columns[columns.length - 1]?.id ?? null;
}

/**
 * Whether a card counts as finished: in the finished column of a board with
 * live lanes. A finished card is never late, on any screen (decision C).
 */
export function isFinished(card: Pick<LaneCard, 'columnId'>, board: LaneBoard): boolean {
  const done = finishedColumnId(board);
  return done !== null && card.columnId === done;
}

/** A card's lane id, or null for No lane: lanes not live, no lane, or a lane that is gone. */
export function laneOf(card: Pick<LaneCard, 'laneId'>, board: LaneBoard): string | null {
  if (!lanesLive(board) || !card.laneId) return null;
  return board.lanes!.some((l) => l.id === card.laneId) ? card.laneId : null;
}

export interface LaneGroup<T> {
  /** null is "No lane". */
  lane: BoardLane | null;
  cards: T[];
}

/**
 * One column's cards under the board's lane headings, in lane order.
 *
 * Every lane is listed, holding cards here or not, so a lane keeps its place
 * from column to column. "No lane" comes last, and only when some card on the
 * BOARD has none, for the same reason. Call it only when `lanesLive(board)`.
 *
 * @param columnCards the cards to place, in the order they are drawn
 * @param boardCards every open card on the board, to know whether No lane is needed
 */
export function groupByLane<T extends Pick<LaneCard, 'laneId'>>(
  columnCards: readonly T[],
  board: LaneBoard,
  boardCards: readonly Pick<LaneCard, 'laneId'>[],
): LaneGroup<T>[] {
  const lanes = board.lanes ?? [];
  const groups: LaneGroup<T>[] = lanes.map((lane) => ({ lane, cards: [] }));
  const at = new Map(lanes.map((l, i) => [l.id, i]));
  const none: T[] = [];
  for (const card of columnCards) {
    const i = card.laneId !== undefined ? at.get(card.laneId) : undefined;
    if (i === undefined) none.push(card);
    else groups[i].cards.push(card);
  }
  if (none.length > 0 || boardCards.some((c) => laneOf(c, board) === null)) {
    groups.push({ lane: null, cards: none });
  }
  return groups;
}

/** Where a lane stands, as its heading's badge and the overview's mark say it. */
export type LaneStatus = 'none' | 'complete' | 'late' | 'soon' | 'undated' | 'open';

export interface LaneInfo {
  /** Open cards in the lane, in every column. */
  total: number;
  /** Of those, the ones in the finished column. */
  done: number;
  status: LaneStatus;
}

/**
 * A lane's state, counted over every open card in it, dated or not. Due dates
 * decide only late and soon, through `bucketFor`, so they mean what they mean
 * on every other screen. Archived cards do not count.
 *
 * Call it only when `lanesLive(board)`; `laneId` null counts No lane.
 */
export function laneInfo(
  boardCards: readonly LaneCard[],
  board: LaneBoard,
  laneId: string | null,
  today: string,
): LaneInfo {
  const cards = boardCards.filter((c) => !c.archived && laneOf(c, board) === laneId);
  const open = cards.filter((c) => !isFinished(c, board));
  const total = cards.length;
  const done = total - open.length;
  const buckets = open.map((c) => bucketFor(c.dueDate, today));
  const status: LaneStatus =
    total === 0
      ? 'none'
      : open.length === 0
        ? 'complete'
        : buckets.includes('overdue')
          ? 'late'
          : buckets.includes('today') || buckets.includes('soon')
            ? 'soon'
            : buckets.every((b) => b === 'none')
              ? 'undated'
              : 'open';
  return { total, done, status };
}

/** The badge on a lane's heading: finished of total, or "No cards". */
export function laneBadge(info: LaneInfo): string {
  return info.total === 0 ? 'No cards' : `${info.done} of ${info.total}`;
}

/** The heading as a screen reader says it, the badge's colour put in words. */
export function describeLane(name: string, info: LaneInfo): string {
  if (info.total === 0) return `${name}, no cards`;
  if (info.status === 'complete') return `${name}, all ${info.total} finished`;
  const counted = `${name}, ${info.done} of ${info.total} finished`;
  return info.status === 'late' ? `${counted}, a card is late` : counted;
}

export function validateLaneName(name: string, existing: readonly BoardLane[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Give the lane a name.';
  if (trimmed.length > LANE_NAME_MAX) return `Keep the lane name under ${LANE_NAME_MAX} characters.`;
  if (existing.some((l) => l.name.toLowerCase() === trimmed.toLowerCase()))
    return 'There is already a lane with that name.';
  return null;
}

/** Why another lane cannot be added, or null. */
export function laneAddBlocked(lanes: readonly BoardLane[]): string | null {
  return lanes.length >= LANES_MAX ? `A board can have at most ${LANES_MAX} lanes.` : null;
}

export type RenameLaneResult = { ok: true; lanes: BoardLane[] } | { ok: false; error: string };

/**
 * Rename one lane, or explain why not. The lane being renamed is left out of
 * the duplicate check, so re-saving its name or fixing its capitals is
 * allowed, as `renameColumn` allows for a column.
 */
export function renameLane(
  lanes: readonly BoardLane[],
  laneId: string,
  rawName: string,
): RenameLaneResult {
  const problem = validateLaneName(
    rawName,
    lanes.filter((l) => l.id !== laneId),
  );
  if (problem) return { ok: false, error: problem };
  const trimmed = rawName.trim();
  return { ok: true, lanes: lanes.map((l) => (l.id === laneId ? { ...l, name: trimmed } : l)) };
}

/** Open cards naming this lane, whether or not lanes are switched on. */
export function cardsInLane(cards: readonly LaneCard[], laneId: string): number {
  return cards.filter((c) => !c.archived && c.laneId === laneId).length;
}

/**
 * Why this lane cannot be removed yet, or null if it can. The same rule as a
 * column: empty first. A removed lane's cards would land under No lane rather
 * than vanish, but a lane full of work removed by a stray tap is still the
 * board coming apart.
 */
export function laneDeleteBlocked(name: string, cardCount: number): string | null {
  if (cardCount <= 0) return null;
  return (
    `“${name}” still has ${cardCount} card${cardCount === 1 ? '' : 's'}. ` +
    'Move them to another lane, or archive them, first.'
  );
}

/**
 * The write that switches lanes on or off.
 *
 * Off keeps the lanes and every card's lane, so on restores the board. On
 * writes the finished column (`finishedColumnChoice`: the stored one while it
 * exists, else the last), so adding a column later does not move it, and a
 * stored column deleted while lanes were off is replaced, not left to drift.
 */
export function lanesSwitchPatch(
  board: LaneBoard,
  on: boolean,
): { lanesOn: boolean; doneColumnId?: string } {
  const choice = finishedColumnChoice(board);
  if (on && choice && choice !== board.doneColumnId) return { lanesOn: true, doneColumnId: choice };
  return { lanesOn: on };
}

/**
 * What deleting a column does to the finished column, for its confirmation,
 * or null when it does nothing: deleting the finished column of a board with
 * lanes makes the last column left the finished one (`columnsPatch`).
 */
export function finishedColumnDeleteNote(
  board: Omit<LaneBoard, 'columns'> & { columns: readonly { id: string; name: string }[] },
  columnId: string,
): string | null {
  if (!lanesLive(board) || finishedColumnChoice(board) !== columnId) return null;
  const gone = board.columns.find((c) => c.id === columnId);
  const rest = board.columns.filter((c) => c.id !== columnId);
  const next = rest[rest.length - 1];
  if (!gone || !next) return null;
  return (
    `Finished cards are the ones in “${gone.name}”. Once it is gone, the cards in ` +
    `“${next.name}” count as finished instead, and none of them shows as late.`
  );
}
