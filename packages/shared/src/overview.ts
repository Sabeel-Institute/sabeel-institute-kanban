import { isFinished, laneOf, lanesLive, type LaneBoard, type LaneCard, type LaneInfo, type LaneStatus } from './lanes';
import type { BoardLane } from './types';

/**
 * The overview: one row per board with lanes, one mark per lane, so the people
 * running programs see what is late without opening each board (Faisal,
 * 2026-11-15). Read-only, and it stores nothing but two preferences per
 * person: the order chosen, and the boards hidden.
 *
 * Pure, so the rules of its order and grouping are tested here and the screen
 * only draws.
 */

/** The three orders. Each runs either way (`reverse`). */
export type OverviewSort = 'start' | 'created' | 'late';

export const OVERVIEW_SORTS: readonly OverviewSort[] = ['start', 'created', 'late'];

export const OVERVIEW_SORT_LABELS: Record<OverviewSort, string> = {
  start: 'Start date',
  created: 'Date created',
  late: 'Most overdue',
};

/** The most boards one person may hide. Restated in firestore.rules. */
export const OVERVIEW_HIDDEN_MAX = 500;

/**
 * The boards the overview lists, of those a person can see: lanes switched on
 * with at least one lane, not marked as a template, not archived. Archiving a
 * board is how a finished program leaves everyone's overview.
 */
export function overviewBoards<T extends LaneBoard & { archived: boolean; template?: boolean }>(
  boards: readonly T[],
): T[] {
  return boards.filter((b) => lanesLive(b) && !b.template && !b.archived);
}

/**
 * What decides whether two boards share a heading: their lanes' names, in
 * order, trimmed and without regard to capitals. A board that renames or adds
 * a lane gets a heading of its own.
 */
export function laneSignature(lanes: readonly Pick<BoardLane, 'name'>[]): string {
  return lanes.map((l) => l.name.trim().toLowerCase()).join('\u0000');
}

function dayNumber(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/**
 * How many days late the board's most overdue unfinished card is, 0 if none
 * is: what "most overdue" orders by. Only cards in one of the board's lanes
 * count, since only those have a mark on the row: a board must not sort first
 * for a late card the row does not show. Archived and finished cards do not
 * count either.
 */
export function boardOverdueDays(
  cards: readonly LaneCard[],
  board: LaneBoard,
  today: string,
): number {
  let most = 0;
  const now = dayNumber(today);
  for (const c of cards) {
    if (c.archived || !c.dueDate || c.dueDate >= today || isFinished(c, board)) continue;
    if (laneOf(c, board) === null) continue;
    most = Math.max(most, now - dayNumber(c.dueDate));
  }
  return most;
}

/** What the order and the grouping read of a row. */
export interface OverviewRow {
  id: string;
  name: string;
  createdAt: number;
  /** The board's Start date, `YYYY-MM-DD`, or null. */
  start: string | null;
  overdueDays: number;
  /** The lanes' names, in order: the group's heading. */
  laneNames: readonly string[];
}

const byName = (a: OverviewRow, b: OverviewRow) => a.name.localeCompare(b.name);

/**
 * The rows in the chosen order. Start date runs earliest first, date created
 * oldest first and most overdue most first; `reverse` turns each around. A
 * board with no start date goes last whichever way the start-date order runs,
 * since "no date" is not early or late. Ties fall back on the name.
 */
export function sortOverview<T extends OverviewRow>(
  rows: readonly T[],
  sort: OverviewSort,
  reverse: boolean,
): T[] {
  const way = reverse ? -1 : 1;
  if (sort === 'start') {
    const dated = rows
      .filter((r) => r.start !== null)
      .sort((a, b) => way * a.start!.localeCompare(b.start!) || byName(a, b));
    const undated = rows.filter((r) => r.start === null).sort(byName);
    return [...dated, ...undated];
  }
  if (sort === 'created') {
    return [...rows].sort((a, b) => way * (a.createdAt - b.createdAt) || byName(a, b));
  }
  return [...rows].sort((a, b) => way * (b.overdueDays - a.overdueDays) || byName(a, b));
}

export interface OverviewGroup<T> {
  signature: string;
  laneNames: readonly string[];
  rows: T[];
}

/**
 * Boards whose lanes have the same names in the same order, together under one
 * heading. Each group keeps the order the rows came in, and the group holding
 * the first row comes first: give it `sortOverview`'s answer.
 */
export function groupOverview<T extends OverviewRow>(sorted: readonly T[]): OverviewGroup<T>[] {
  const groups = new Map<string, OverviewGroup<T>>();
  for (const row of sorted) {
    const signature = laneSignature(row.laneNames.map((name) => ({ name })));
    const group = groups.get(signature);
    if (group) group.rows.push(row);
    else groups.set(signature, { signature, laneNames: row.laneNames, rows: [row] });
  }
  return [...groups.values()];
}

/**
 * A person's hidden boards after hiding or showing one, with ids of boards no
 * longer listed dropped, so the list cannot grow without end.
 */
export function nextHidden(
  hidden: readonly string[],
  listedIds: readonly string[],
  boardId: string,
  hide: boolean,
): string[] {
  const listed = new Set(listedIds);
  const kept = hidden.filter((id) => listed.has(id) && id !== boardId);
  return hide ? [...kept, boardId].slice(-OVERVIEW_HIDDEN_MAX) : kept;
}

/** What each mark says, in words, for a screen reader and for anyone who cannot tell the colours apart. */
const LANE_STATUS_WORDS: Record<LaneStatus, string> = {
  complete: 'all finished',
  late: 'a card is late',
  soon: 'due soon',
  open: 'under way',
  undated: 'no due dates',
  none: 'no cards',
};

/**
 * One lane's mark as words: "Marketing, a card is late, 2 of 4 finished". A
 * lane with no cards, or all finished, needs no count.
 */
export function describeMark(laneName: string, info: LaneInfo): string {
  const words = LANE_STATUS_WORDS[info.status];
  return info.status === 'none' || info.status === 'complete'
    ? `${laneName}, ${words}`
    : `${laneName}, ${words}, ${info.done} of ${info.total} finished`;
}
