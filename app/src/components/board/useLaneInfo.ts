import { useMemo } from 'react';
import { laneInfo, todayInOrgTz, type LaneBoard, type LaneCard, type LaneInfo } from '@sabeel/shared';

/**
 * Each lane's heading state (`laneInfo`), for every board layout. One hook so
 * the three layouts cannot work it out differently. Today is read on every
 * render and is a dependency: worked out inside the memo, it stayed at the day
 * the board was opened, so past midnight a card's face could say "1 day late"
 * while its lane's heading did not.
 */
export function useLaneInfo(
  laneBoard: LaneBoard | null,
  live: boolean,
  cards: readonly LaneCard[],
): Map<string, LaneInfo> {
  const today = todayInOrgTz();
  return useMemo(() => {
    const map = new Map<string, LaneInfo>();
    if (!laneBoard || !live) return map;
    for (const lane of laneBoard.lanes ?? []) {
      map.set(lane.id, laneInfo(cards, laneBoard, lane.id, today));
    }
    return map;
  }, [laneBoard, live, cards, today]);
}
