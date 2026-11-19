import { watchKey } from '@sabeel/shared';
import { setLaneWatched, useWatchedLanes } from '../../notifications';
import type { SessionUser } from '../../session';
import { useAction } from '../../useAction';

/**
 * Who sees a lane's bell, what it says, and what a press does (lane watching):
 * ONE hook for the three board layouts. Board members only, as the column
 * bell: an admin visiting a board they are not on would watch a lane whose
 * arrivals the sweep never sends them. Disabled until the list is read, so a
 * list still loading is never shown as watching nothing.
 */
export function useLaneWatch(user: SessionUser, boardId: string, isMember: boolean) {
  const watched = useWatchedLanes(user);
  const { run, error, setError } = useAction('watchLane');
  const watching = (laneId: string) => (watched.data ?? []).includes(watchKey(boardId, laneId));
  return {
    show: isMember,
    busy: watched.status !== 'ready',
    watching,
    toggle: (laneId: string) => {
      return run(() => setLaneWatched(user, boardId, laneId, !watching(laneId)));
    },
    error,
    clearError: () => setError(null),
  };
}
