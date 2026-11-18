import { useMemo } from 'react';
import { laneKey, NO_LANE_KEY, type LaneBoard } from '@sabeel/shared';
import { setAllLanesCollapsed, setLaneCollapsed, useMyCollapsed } from '../../boards';
import type { SessionUser } from '../../session';
import { useAction } from '../../useAction';

const NONE: readonly string[] = [];

/**
 * Which of a board's lanes this person has collapsed, and the ways to change
 * it (#115): one lane, every lane, and opening the lane a card was just added
 * to. ONE hook for the three board layouts, so the phone, the browser and a
 * tablet cannot decide differently what is collapsed (practice 7).
 *
 * Stored on the person's own user document (`collapsedLanes`, by board), so it
 * holds across reloads and devices. A lane collapses in EVERY column at once:
 * a lane holds one place across the board, so it is one choice, not one per
 * column. A board without live lanes has nothing to collapse, and a failed or
 * loading read collapses nothing: a display preference must never hide cards
 * because it could not be read.
 */
export function useLaneCollapse(
  user: SessionUser,
  boardId: string,
  laneBoard: LaneBoard | null,
  live: boolean,
) {
  const prefs = useMyCollapsed(user);
  const { run, error, setError } = useAction('collapseLane');
  const stored = prefs.data?.lanes[boardId] ?? NONE;

  return useMemo(() => {
    const collapsed = new Set(live ? stored : NONE);
    // Every group a board can draw: its lanes, and No lane.
    const keys = live && laneBoard ? [...(laneBoard.lanes ?? []).map((l) => l.id), NO_LANE_KEY] : [];
    const laneIds = keys.filter((k) => k !== NO_LANE_KEY);
    const isCollapsed = (laneId: string | null) => collapsed.has(laneKey(laneId));
    return {
      isCollapsed,
      /** Every lane collapsed: "Collapse all" has nothing to do. */
      allCollapsed: laneIds.length > 0 && laneIds.every((k) => collapsed.has(k)),
      /** Nothing collapsed: "Expand all" has nothing to do. */
      noneCollapsed: !keys.some((k) => collapsed.has(k)),
      toggle: (laneId: string | null) => {
        return run(() => setLaneCollapsed(user, boardId, laneKey(laneId), !isCollapsed(laneId)));
      },
      collapseAll: () => {
        return run(() => setAllLanesCollapsed(user, boardId, keys));
      },
      expandAll: () => {
        return run(() => setAllLanesCollapsed(user, boardId, null));
      },
      /**
       * Open the lane a card was just added to, so the card is seen landing,
       * rather than vanishing into a folded lane.
       */
      reveal: (laneId: string | null) =>
        isCollapsed(laneId)
          ? run(() => setLaneCollapsed(user, boardId, laneKey(laneId), false))
          : Promise.resolve(true),
      error,
      clearError: () => setError(null),
    };
  }, [live, stored, laneBoard, run, user, boardId, error, setError]);
}
