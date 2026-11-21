import { describe, it, expect, beforeEach } from 'vitest';
import type { Priority } from '@sabeel/shared';
import {
  EMPTY_SEARCH_FILTERS,
  chipsForIds,
  clearSearchFilters,
  getSearchFilters,
  setSearchFilters,
  toggleIn,
} from './searchFilters';

/**
 * The store behind Search, tested without React.
 *
 * The reason it exists at all is that `App.tsx` renders one screen per route, so
 * opening a card unmounts `SearchScreen` and anything held in `useState` dies.
 * These cover the two things that can go wrong in a store like this: losing a
 * change, and losing the ability to reset.
 */
// NOT `clearSearchFilters`, which deliberately keeps the chosen order — so it
// would carry one test's `sort` into the next. The store is module state; the
// reset between tests has to put back every field.
beforeEach(() => setSearchFilters(EMPTY_SEARCH_FILTERS));

describe('setSearchFilters', () => {
  it('merges rather than replacing', () => {
    setSearchFilters({ text: 'budget' });
    setSearchFilters({ boardId: 'b2' });
    const seen = getSearchFilters();
    expect(seen.text).toBe('budget');
    expect(seen.boardId).toBe('b2');
  });

  it('a FUNCTIONAL patch sees every earlier change, even in one tick', () => {
    // The bug this form exists for. A chip handler closes over the value from
    // its own render, so two taps landing before React re-renders both compute
    // from the same snapshot and one is silently lost. Two toggles in a row here
    // stand in for two taps inside one batch.
    setSearchFilters({ archivedOnly: false });
    setSearchFilters((f) => ({ archivedOnly: !f.archivedOnly }));
    setSearchFilters((f) => ({ archivedOnly: !f.archivedOnly }));
    const seen = getSearchFilters();
    // Two toggles from false is false. Reading a stale snapshot would leave it
    // true — one tap's worth of work thrown away.
    expect(seen.archivedOnly).toBe(false);
  });

  it('accumulates labels without dropping one', () => {
    setSearchFilters((f) => ({ labelIds: [...f.labelIds, 'l1'] }));
    setSearchFilters((f) => ({ labelIds: [...f.labelIds, 'l2'] }));
    setSearchFilters((f) => ({ labelIds: f.labelIds.filter((id) => id !== 'l1') }));
    const seen = getSearchFilters();
    expect(seen.labelIds).toEqual(['l2']);
  });

  it('accumulates priorities the same way labels do', () => {
    setSearchFilters((f) => ({ priorities: toggleIn(f.priorities, 'urgent') }));
    setSearchFilters((f) => ({ priorities: toggleIn(f.priorities, 'high') }));
    expect(getSearchFilters().priorities).toEqual(['urgent', 'high']);
    setSearchFilters((f) => ({ priorities: toggleIn(f.priorities, 'urgent') }));
    expect(getSearchFilters().priorities).toEqual(['high']);
  });
});

describe('toggleIn', () => {
  it('adds what is absent and removes what is present', () => {
    expect(toggleIn([], 'urgent')).toEqual(['urgent']);
    expect(toggleIn(['urgent', 'high'], 'urgent')).toEqual(['high']);
  });

  it('does not mutate its input', () => {
    const before = ['urgent'];
    toggleIn(before, 'high');
    expect(before).toEqual(['urgent']);
  });
});

describe('clearSearchFilters', () => {
  const everything = {
    text: 'x',
    archivedOnly: true,
    overdueOnly: true,
    priorities: ['urgent', 'none'] as Priority[],
    labelIds: ['l1'],
    boardId: 'b1',
    assigneeUid: 'u1',
    dueFrom: '2026-11-18',
    dueTo: '2026-11-22',
    activeFrom: '2026-11-19',
    activeTo: '2026-11-21',
  };

  it('clears every narrowing filter, which is what the control promises', () => {
    // Every narrowing field, deliberately: this asserts the WHOLE object below,
    // so a field added to `SearchFilters` and forgotten here fails loudly rather
    // than surviving a clear.
    setSearchFilters({ ...everything, sort: 'best' });
    clearSearchFilters();
    expect(getSearchFilters()).toEqual(EMPTY_SEARCH_FILTERS);
  });

  /**
   * Sort is NOT a filter, and the clear control is not a reset button.
   *
   * `hasActiveFilters` — the one condition the control even appears on — ignores
   * `sort`, because reordering a list is not narrowing it. A clear that put the
   * order back would fire from a control that appeared for another reason
   * entirely, and flip the list from `Oldest first` to `Best match` with nothing
   * on screen to explain it.
   */
  it('leaves the chosen order alone', () => {
    setSearchFilters({ ...everything, sort: 'oldest' });
    clearSearchFilters();
    expect(getSearchFilters()).toEqual({ ...EMPTY_SEARCH_FILTERS, sort: 'oldest' });
  });
});

describe('chipsForIds', () => {
  const byName = <T extends { name: string }>(ls: T[]) =>
    [...ls].sort((a, b) => a.name.localeCompare(b.name));
  const labels = [
    { id: 'l1', name: 'Finance' },
    { id: 'l2', name: 'Admin' },
  ];

  it('resolves chosen ids to names, sorted', () => {
    expect(chipsForIds(['l1', 'l2'], labels, 'Deleted label', byName)).toEqual([
      { id: 'l2', name: 'Admin' },
      { id: 'l1', name: 'Finance' },
    ]);
  });

  it('STILL yields a chip for an id whose label was deleted', () => {
    // The whole point. An admin can delete a label someone is filtering by;
    // building chips by filtering the org-wide set down to the chosen ids meant
    // a dead id produced no chip while still narrowing the results — Search went
    // empty with no cause on screen and nothing to tap.
    const chips = chipsForIds(['l1', 'gone'], labels, 'Deleted label', byName);
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.id)).toContain('gone');
  });

  it('keeps the dead id itself, so tapping the chip can remove it', () => {
    // A chip that cannot identify its own filter is decoration, not an escape.
    const [chip] = chipsForIds(['gone'], labels, 'Deleted label', byName);
    expect(chip).toEqual({ id: 'gone', name: 'Deleted label' });
  });

  it('is empty when nothing is chosen', () => {
    expect(chipsForIds([], labels, 'Deleted label', byName)).toEqual([]);
  });

  /**
   * The same rule now covers the board and the assignee, which is why this is
   * one function rather than three inline copies. A board can be ARCHIVED while
   * it is selected, and `removeBoardMember` can take away the last board a
   * chosen assignee shared with you — both leave an id pointing at nothing.
   */
  it('names each facet\'s missing case in its own words', () => {
    const boards = [{ id: 'b1', name: 'Fundraising 2026' }];
    expect(chipsForIds(['b1'], boards, 'Unavailable board')).toEqual([
      { id: 'b1', name: 'Fundraising 2026' },
    ]);
    expect(chipsForIds(['b9'], boards, 'Unavailable board')).toEqual([
      { id: 'b9', name: 'Unavailable board' },
    ]);
    expect(chipsForIds(['u9'], [], 'Someone no longer on a board')).toEqual([
      { id: 'u9', name: 'Someone no longer on a board' },
    ]);
  });

  it('leaves order alone when no sort is given', () => {
    expect(chipsForIds(['l1', 'l2'], labels, 'Deleted label').map((c) => c.name)).toEqual([
      'Finance',
      'Admin',
    ]);
  });
});
