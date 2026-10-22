import { collection, query, where } from 'firebase/firestore';
import type { Priority } from '@sabeel/shared';
import { db } from './firebase';
import { createViewStore } from './viewState';
import { useLiveQuery } from './liveQuery';
import type { SessionUser } from './session';

export interface MyWorkCard {
  id: string;
  boardId: string;
  title: string;
  columnId: string;
  dueDate?: string;
  priority: Priority;
  labelIds: string[];
  assigneeUids: string[];
  archived: boolean;
}

/**
 * Shared mapper for both cross-board card queries below. Extracted rather than
 * duplicated: the two differ ONLY in which array they match on, and a second
 * copy of this is how one of them quietly stops filtering archived cards.
 */
function toMyWorkCards(docs: { id: string; data: Record<string, unknown> }[]): MyWorkCard[] {
  return docs
    .map((d) => ({
      id: d.id,
      boardId: (d.data.boardId as string) ?? '',
      title: (d.data.title as string) ?? '',
      columnId: (d.data.columnId as string) ?? '',
      dueDate: d.data.dueDate as string | undefined,
      priority: (d.data.priority as Priority) ?? 'none',
      labelIds: (d.data.labelIds as string[]) ?? [],
      assigneeUids: (d.data.assigneeUids as string[]) ?? [],
      archived: Boolean(d.data.archived),
    }))
    .filter((c) => !c.archived);
}

/**
 * Every card assigned to me, across every board — the cross-board "My Work"
 * view, and the phone's most useful screen.
 *
 * Cards are a top-level collection, so this is a plain COLLECTION query. Two
 * things make it work:
 *
 *  1. The `array-contains` constraint on my own uid is mandatory. Rules only
 *     permit a list they can prove is restricted to the caller (the read rule's
 *     assignee arm); an unconstrained `collection('cards')` would be every card
 *     in the organisation and is rejected outright.
 *
 *  2. The board id is now a FIELD on the card; the board NAME is resolved from
 *     the caller's own board list. That works because assignment implies board
 *     membership, so every board appearing here is already one the user can see
 *     — which is why no board name is denormalised onto cards and no fan-out is
 *     needed when a board is renamed.
 *
 * The `archived` filter is applied client-side rather than in the query so the
 * whole thing needs only the automatic single-field array index.
 */
export function useMyWork(user: SessionUser) {
  return useLiveQuery<MyWorkCard[]>(
    () =>
      query(collection(db, 'cards'), where('assigneeUids', 'array-contains', user.uid)),
    [user.uid],
    'my-work',
    toMyWorkCards,
  );
}

/**
 * Every card I subscribed to, across every board — the Subscribed half of My
 * Work.
 *
 * The same shape as `useMyWork` for the same reasons, and legal for the same
 * one: the `array-contains` constraint on my own uid is what the read rule's
 * subscriber arm can prove, so an unconstrained query would be rejected.
 *
 * Board names resolve from the caller's own board list here too, because
 * subscribing requires board membership exactly as assignment does — so every
 * board appearing in this list is already one they can see.
 */
export function useMySubscriptions(user: SessionUser) {
  return useLiveQuery<MyWorkCard[]>(
    () =>
      query(collection(db, 'cards'), where('subscriberUids', 'array-contains', user.uid)),
    [user.uid],
    'my-subscriptions',
    toMyWorkCards,
  );
}


/**
 * Which half of My Work you are looking at.
 *
 * Outside the component for the same reason Search's filters are: opening a card
 * unmounts the screen, so choosing Subscribed and tapping through to a card put
 * you back on Assigned. My Work is the phone's default landing surface, which
 * makes that the most-hit version of the bug.
 */
export const myWorkView = createViewStore<{ mode: 'assigned' | 'subscribed' }>({
  mode: 'assigned',
});
