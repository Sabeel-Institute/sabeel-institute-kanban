/**
 * What Search is currently filtering by — held OUTSIDE React.
 *
 * `App.tsx` renders one screen per route, so pushing a card unmounts
 * `SearchScreen` and every `useState` in it dies. Coming back re-mounted an
 * empty screen: the text gone, the chips off, the label picks lost. Back is
 * supposed to return you to what you were looking at, and nothing about the
 * navigation stack was wrong — the state simply has to outlive the component.
 *
 * So it lives here, in a module, with the same shape `nav.ts` uses: one
 * variable, a set of listeners, and a hook that subscribes. No new concept, and
 * no provider to thread through the tree.
 *
 * SESSION ONLY. Nothing is persisted: a filter you set last week is not a filter
 * you meant to still be looking through today, and the app reloading is the
 * natural moment to forget. Within a session it survives everything — a card, a
 * different tab, a rotation — until the clear control on the screen is used, or
 * until somebody signs out (see `session.ts`, which resets the view stores for
 * the same reason it clears the live-query cache).
 */
import type { CardFilters, Priority, SearchSort } from '@sabeel/shared';
import { createViewStore } from './viewState';

export type SearchDates = Pick<CardFilters, 'dueFrom' | 'dueTo' | 'activeFrom' | 'activeTo'>;

export const SEARCH_DATE_RANGES = [
  { title: 'Due between', from: 'dueFrom', to: 'dueTo' },
  { title: 'Active between', from: 'activeFrom', to: 'activeTo' },
] as const;

export function dateRangeSummary(from?: string, to?: string): string | undefined {
  if (from && to) return `${from} to ${to}`;
  if (from) return `from ${from}`;
  if (to) return `through ${to}`;
  return undefined;
}

export interface SearchFilters extends SearchDates {
  text: string;
  archivedOnly: boolean;
  overdueOnly: boolean;
  /**
   * Priorities to match ANY of — the same shape as `labelIds`.
   *
   * A single value made Urgent and High mutually exclusive, so "the things that
   * matter" could not be asked for at all. `'none'` is one of the five values,
   * not the absence of a filter.
   */
  priorities: Priority[];
  /** Labels to match ANY of. */
  labelIds: string[];
  /** One board, or undefined for every board you can see. */
  boardId: string | undefined;
  /**
   * One person, or undefined for anyone. Single rather than a list because
   * `CardFilters.assigneeUid` in @sabeel/shared has always been singular, and
   * "whose is this" is a question about one person.
   */
  assigneeUid: string | undefined;
  sort: SearchSort;
}

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  text: '',
  archivedOnly: false,
  overdueOnly: false,
  priorities: [],
  labelIds: [],
  boardId: undefined,
  assigneeUid: undefined,
  dueFrom: undefined,
  dueTo: undefined,
  activeFrom: undefined,
  activeTo: undefined,
  sort: 'best',
};

const store = createViewStore<SearchFilters>(EMPTY_SEARCH_FILTERS);

/** The filters right now, without subscribing. */
export const getSearchFilters = store.get;

/**
 * Merge a change in. Pass a FUNCTION when the new value derives from the old —
 * see `createViewStore` for why a plain object loses a rapid second tap.
 */
export const setSearchFilters = store.set;

/**
 * Clear everything that NARROWS, and leave the order alone.
 *
 * Deliberately not `store.reset`. `EMPTY_SEARCH_FILTERS` carries `sort: 'best'`,
 * so resetting also put the order back — and `hasActiveFilters`, the one
 * condition the clear control even appears on, was taught to ignore `sort` for
 * the reason that reordering a list is not narrowing it. A control that appears
 * because of the filters and silently changes the order too is doing something
 * its name does not say, and nothing on screen would explain the list flipping
 * from `Oldest first` back to `Best match`.
 *
 * Sign-out still uses `store.reset` through `resetAllViewStores`, which is
 * right: there the whole point IS to leave nothing of the last person behind.
 */
export const clearSearchFilters = (): void =>
  store.set((f) => ({ ...EMPTY_SEARCH_FILTERS, sort: f.sort }));

export const useSearchFilters = store.use;

/** Add or remove one value from a multi-select facet, for `setSearchFilters`. */
export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

/**
 * Turn chosen ids into chips, keeping ids that no longer resolve.
 *
 * Pure, and separate from the screen so it can be tested: the case it exists for
 * is hard to stage in a browser and easy to get wrong. Building chips by
 * filtering a live list down to the chosen ids means a dead id produces NO chip
 * while it goes on narrowing the results — the screen empties with no cause
 * shown and nothing to tap.
 *
 * The rule is that every active filter is visible and removable, even a broken
 * one, and it applies to all three id-shaped facets, each of which can genuinely
 * go stale: `deleteLabel` removes a label mid-filter, archiving a board drops it
 * out of `useMyBoards`, and `removeBoardMember` can take away the last board a
 * chosen assignee shared with you. One implementation rather than three, because
 * the two written inline were already inconsistent — the board case had no test
 * and the assignee case did not exist.
 */
export function chipsForIds(
  ids: readonly string[],
  known: readonly { id: string; name: string }[],
  /** What an unresolvable id is called. Specific to the facet, so the chip still
   *  says what kind of thing has gone. */
  missingName: string,
  sort: <T extends { name: string }>(ls: T[]) => T[] = (ls) => ls,
): { id: string; name: string }[] {
  const byId = new Map(known.map((l) => [l.id, l]));
  const resolved = sort(
    ids
      .map((id) => byId.get(id))
      .filter((l): l is { id: string; name: string } => l !== undefined)
      .map((l) => ({ id: l.id, name: l.name })),
  );
  const missing = ids.filter((id) => !byId.has(id));
  return [...resolved, ...missing.map((id) => ({ id, name: missingName }))];
}
