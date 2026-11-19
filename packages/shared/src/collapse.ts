/**
 * What a person has collapsed: sections of the Boards list, and lanes on a
 * board. Stored on their own user document, so it holds across reloads and
 * devices (Faisal, 2026-11-18), like the overview's hidden boards. Display
 * preferences only: collapsing grants and hides nothing anyone else sees.
 *
 * Both are written one entry at a time with arrayUnion/arrayRemove, which the
 * server applies, so two quick taps cannot overwrite each other; expanding
 * every lane of a board deletes that board's entry, so boards that are gone do
 * not accumulate.
 */

/** The Boards list's sections, by a key that does not change with the heading's words. */
export const BOARD_SECTIONS = ['starred', 'recent', 'all', 'templates'] as const;
export type BoardSection = (typeof BOARD_SECTIONS)[number];

/** How many section keys the user document may hold. Restated in firestore.rules. */
export const COLLAPSED_SECTIONS_MAX = 10;
/** How many boards may have collapsed lanes stored. Restated in firestore.rules. */
export const COLLAPSED_LANE_BOARDS_MAX = 500;

/**
 * The "No lane" group's key. Lane ids are `localId('ln')`, which never holds
 * a tilde, so this cannot name a real lane.
 */
export const NO_LANE_KEY = '~none';

/** The key a lane group is stored under: its id, or NO_LANE_KEY. */
export function laneKey(laneId: string | null): string {
  return laneId ?? NO_LANE_KEY;
}

export interface CollapsedPrefs {
  sections: BoardSection[];
  /** Board id → the keys of its collapsed lanes. */
  lanes: Record<string, string[]>;
}

/**
 * The stored preferences, read from a user document. Self-written, so a
 * value in a shape this app never writes (an old build, another client) is
 * dropped here rather than trusted: what is not a known section key, or a
 * list of strings under a board, reads as not collapsed.
 */
export function collapsedPrefs(data: Record<string, unknown> | undefined): CollapsedPrefs {
  const rawSections = data?.collapsedBoardSections;
  const sections = Array.isArray(rawSections)
    ? BOARD_SECTIONS.filter((s) => rawSections.includes(s))
    : [];
  const rawLanes = data?.collapsedLanes;
  const lanes: Record<string, string[]> = {};
  if (rawLanes && typeof rawLanes === 'object' && !Array.isArray(rawLanes)) {
    for (const [boardId, keys] of Object.entries(rawLanes)) {
      if (Array.isArray(keys)) lanes[boardId] = keys.filter((k): k is string => typeof k === 'string');
    }
  }
  return { sections, lanes };
}
