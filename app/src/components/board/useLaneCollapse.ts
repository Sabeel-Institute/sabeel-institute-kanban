import { useEffect, useMemo } from 'react';
import { laneKey, laneOf, NO_LANE_KEY, type LaneBoard, type LaneCard } from '@sabeel/shared';
import { setAllLanesCollapsed, setLaneCollapsed, useMyCollapsed } from '../../boards';
import type { SessionUser } from '../../session';
import { useAction } from '../../useAction';

const NONE: readonly string[] = [];

/**
 * Which of a board's lanes this person has collapsed, and the ways to change
 * it (#115): one lane, every lane, and opening the lane a card just went to.
 * ONE hook for the three board layouts, so the phone, the browser and a tablet
 * cannot decide differently what is collapsed or what is hidden (practice 7).
 *
 * Stored on the person's own user document (`collapsedLanes`, by board), so it
 * holds across reloads and devices. A lane collapses in EVERY column at once:
 * a lane holds one place across the board, so it is one choice, not one per
 * column. A board without live lanes has nothing to collapse, and a failed or
 * loading read collapses nothing: a display preference must never hide cards
 * because it could not be read.
 *
 * A folded lane's cards are hidden, so they leave the selection as it folds
 * (`deselect`), and `visible` is what a range or a select-all may take: a bulk
 * action must never reach cards the person cannot see.
 */
export function useLaneCollapse<C extends LaneCard & { id: string }>(
  user: SessionUser,
  boardId: string,
  laneBoard: LaneBoard | null,
  live: boolean,
  cards: readonly C[],
  deselect: (cardIds: readonly string[]) => void,
) {
  const prefs = useMyCollapsed(user);
  const { run, error, setError } = useAction('collapseLane');
  const stored = prefs.data?.lanes[boardId] ?? NONE;

  // A fold can arrive from elsewhere (another tab, the phone), not only from
  // a press here, so whatever is folded leaves the selection whenever the
  // stored folds change: a bulk action never reaches a hidden card.
  useEffect(() => {
    if (!live || !laneBoard || stored.length === 0) return;
    const folded = new Set(stored);
    deselect(cards.filter((c) => folded.has(laneKey(laneOf(c, laneBoard)))).map((c) => c.id));
  }, [live, laneBoard, stored, cards, deselect]);

  return useMemo(() => {
    const on = live && laneBoard !== null;
    const collapsed = new Set(on ? stored : NONE);
    const keyOf = (c: C) => laneKey(laneOf(c, laneBoard!));
    // Every group the board draws: its lanes, and No lane only while some
    // card is in it (as `groupByLane` draws it). A fold of a No lane nobody
    // can see would later swallow the first card to lose its lane.
    const hasNoLane = on && cards.some((c) => laneOf(c, laneBoard!) === null);
    const keys = on
      ? [...(laneBoard!.lanes ?? []).map((l) => l.id), ...(hasNoLane ? [NO_LANE_KEY] : [])]
      : [];
    const isCollapsed = (laneId: string | null) => collapsed.has(laneKey(laneId));
    const cardsIn = (key: string) => cards.filter((c) => keyOf(c) === key).map((c) => c.id);
    // Opening the last folded lane deletes the board's entry, so nothing is
    // left behind for a board whose lanes are all open.
    const open = (key: string) =>
      // A stored key for a lane that is gone, or for a No lane not drawn,
      // does not keep the entry alive.
      stored.every((k) => k === key || !keys.includes(k))
        ? setAllLanesCollapsed(user, boardId, null)
        : setLaneCollapsed(user, boardId, key, false);
    return {
      isCollapsed,
      /** These cards less those in folded lanes: what a range or select-all may take. */
      visible: <T extends C>(list: readonly T[]): readonly T[] =>
        on && collapsed.size > 0 ? list.filter((c) => !collapsed.has(keyOf(c))) : list,
      /** Every drawn group collapsed: "Collapse all" has nothing to do. */
      allCollapsed: keys.length > 0 && keys.every((k) => collapsed.has(k)),
      /** No drawn group collapsed: "Expand all" has nothing to do. */
      noneCollapsed: !keys.some((k) => collapsed.has(k)),
      toggle: (laneId: string | null) => {
        const key = laneKey(laneId);
        if (collapsed.has(key)) return run(() => open(key));
        deselect(cardsIn(key));
        return run(() => setLaneCollapsed(user, boardId, key, true));
      },
      collapseAll: () => {
        deselect(cards.map((c) => c.id));
        return run(() => setAllLanesCollapsed(user, boardId, keys));
      },
      expandAll: () => {
        return run(() => setAllLanesCollapsed(user, boardId, null));
      },
      /**
       * Open the lane a card just went to (an add, a drop), so the card is
       * seen arriving rather than vanishing into a folded lane.
       */
      reveal: (laneId: string | null) =>
        isCollapsed(laneId) ? run(() => open(laneKey(laneId))) : Promise.resolve(true),
      error,
      clearError: () => setError(null),
    };
  }, [live, laneBoard, stored, cards, deselect, run, user, boardId, error, setError]);
}
