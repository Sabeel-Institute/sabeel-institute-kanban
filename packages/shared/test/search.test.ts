import { describe, it, expect } from 'vitest';
import {
  filterCards,
  hasActiveFilters,
  matchesText,
  lastActivityOf,
  orderCards,
  rankMatches,
  type SearchableCard,
} from '../src/search';

const card = (over: Partial<SearchableCard> = {}): SearchableCard => ({
  id: 'c1',
  boardId: 'b1',
  title: 'Fix signup flow',
  description: 'The email step fails',
  columnId: 'todo',
  assigneeUids: [],
  labelIds: [],
  priority: 'none',
  archived: false,
  ...over,
});

const TODAY = '2026-07-19';

describe('matchesText', () => {
  it('matches the title, case-insensitively', () => {
    expect(matchesText(card(), 'SIGNUP')).toBe(true);
  });

  it('matches the description', () => {
    expect(matchesText(card(), 'email step')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesText(card(), 'newsletter')).toBe(false);
  });

  it('an empty query matches everything', () => {
    expect(matchesText(card(), '   ')).toBe(true);
  });
});

describe('filterCards', () => {
  const cards = [
    card({ id: 'a', title: 'Alpha', assigneeUids: ['u1'], priority: 'high' }),
    card({ id: 'b', title: 'Beta', labelIds: ['l1'], dueDate: '2026-07-18' }),
    card({ id: 'c', title: 'Gamma', labelIds: ['l2'], dueDate: TODAY }),
    card({ id: 'd', title: 'Delta', archived: true }),
    card({ id: 'e', title: 'Epsilon', dueDate: '2026-08-01' }),
  ];

  it('narrows to one board, and absent means every board', () => {
    const mixed = [
      card({ id: 'x', boardId: 'b1' }),
      card({ id: 'y', boardId: 'b2' }),
      card({ id: 'z', boardId: 'b2' }),
    ];
    expect(filterCards(mixed, { boardId: 'b2' }, TODAY).map((c) => c.id)).toEqual(['y', 'z']);
    // Absent is not "no results" — it is every board you can see.
    expect(filterCards(mixed, {}, TODAY)).toHaveLength(3);
  });

  it('composes with the other filters rather than replacing them', () => {
    // The board is one more narrowing, not a mode. If it replaced the rest,
    // this would return both cards on b2.
    const mixed = [
      card({ id: 'x', boardId: 'b2', title: 'Budget', priority: 'high' }),
      card({ id: 'y', boardId: 'b2', title: 'Newsletter', priority: 'none' }),
      card({ id: 'z', boardId: 'b1', title: 'Budget', priority: 'high' }),
    ];
    expect(
      filterCards(mixed, { boardId: 'b2', text: 'budget', priorities: ['high'] }, TODAY).map(
        (c) => c.id,
      ),
    ).toEqual(['x']);
  });

  it('still hides the archive when a board is chosen', () => {
    // Board narrows WITHIN the live set; it must not drag archived cards in.
    const mixed = [
      card({ id: 'live', boardId: 'b2' }),
      card({ id: 'old', boardId: 'b2', archived: true }),
    ];
    expect(filterCards(mixed, { boardId: 'b2' }, TODAY).map((c) => c.id)).toEqual(['live']);
    expect(
      filterCards(mixed, { boardId: 'b2', archivedOnly: true }, TODAY).map((c) => c.id),
    ).toEqual(['old']);
  });

  it('hides archived cards by default', () => {
    // The archive is a separate place, not something that pollutes results.
    expect(filterCards(cards, {}, TODAY).map((c) => c.id)).not.toContain('d');
  });

  it('shows ONLY archived when asked — it narrows, like every other chip', () => {
    // Regression: this used to ADD the archive to the live results, so turning
    // the chip on made the list LONGER (63 -> 67, with the same live cards still
    // on top). Sitting beside Overdue/Urgent/High, which all narrow, that read
    // as a bug you could only notice by counting rows.
    const ids = filterCards(cards, { archivedOnly: true }, TODAY).map((c) => c.id);
    expect(ids).toContain('d');
    // Every live card is gone, not merely outnumbered.
    const live = cards.filter((c) => !c.archived).map((c) => c.id);
    for (const id of live) expect(ids).not.toContain(id);
  });

  it('filters by assignee', () => {
    expect(filterCards(cards, { assigneeUid: 'u1' }, TODAY).map((c) => c.id)).toEqual([
      'a',
    ]);
  });

  it('filters by label', () => {
    expect(filterCards(cards, { labelIds: ['l1'] }, TODAY).map((c) => c.id)).toEqual(['b']);
  });

  it('matches ANY of several labels, not all of them', () => {
    // Requiring every label would be useless at this size — few cards carry two
    // SPECIFIC labels, so a second pick would almost always empty the list.
    expect(filterCards(cards, { labelIds: ['l1', 'l2'] }, TODAY).map((c) => c.id)).toEqual([
      'b',
      'c',
    ]);
  });

  it('treats an empty label list as no filter at all', () => {
    expect(filterCards(cards, { labelIds: [] }, TODAY)).toHaveLength(
      filterCards(cards, {}, TODAY).length,
    );
  });

  it('returns nothing for a label no card carries', () => {
    expect(filterCards(cards, { labelIds: ['nope'] }, TODAY)).toEqual([]);
  });

  it('filters by priority', () => {
    expect(filterCards(cards, { priorities: ['high'] }, TODAY).map((c) => c.id)).toEqual([
      'a',
    ]);
  });

  /** ANY, like labels — "urgent or high" was impossible while it was one value. */
  it('matches ANY of several priorities', () => {
    const mixed = [
      card({ id: 'u', title: 'U', priority: 'urgent' }),
      card({ id: 'h', title: 'H', priority: 'high' }),
      card({ id: 'm', title: 'M', priority: 'medium' }),
    ];
    expect(
      filterCards(mixed, { priorities: ['urgent', 'high'] }, TODAY).map((c) => c.id),
    ).toEqual(['u', 'h']);
  });

  /** `'none'` is a VALUE, not the absence of a filter. */
  it('can filter to cards with no priority set', () => {
    expect(filterCards(cards, { priorities: ['none'] }, TODAY).map((c) => c.id)).toEqual([
      'b',
      'c',
      'e',
    ]);
  });

  it('an empty priority list filters nothing', () => {
    expect(filterCards(cards, { priorities: [] }, TODAY)).toHaveLength(4);
  });

  it('leaves a finished card out of Overdue', () => {
    expect(filterCards(cards, { due: 'overdue' }, TODAY, (c) => c.id === 'b')).toEqual([]);
  });

  it('filters overdue', () => {
    expect(filterCards(cards, { due: 'overdue' }, TODAY).map((c) => c.id)).toEqual(['b']);
  });

  it('filters due today', () => {
    expect(filterCards(cards, { due: 'today' }, TODAY).map((c) => c.id)).toEqual(['c']);
  });

  it('filters cards with no due date', () => {
    expect(filterCards(cards, { due: 'none' }, TODAY).map((c) => c.id).sort()).toEqual([
      'a',
    ]);
  });

  it('combines filters', () => {
    expect(
      filterCards(cards, { text: 'alpha', priorities: ['high'] }, TODAY).map((c) => c.id),
    ).toEqual(['a']);
    expect(
      filterCards(cards, { text: 'alpha', priorities: ['low'] }, TODAY),
    ).toHaveLength(0);
  });

  it('returns everything with no filters', () => {
    expect(filterCards(cards, {}, TODAY)).toHaveLength(4); // archived excluded
  });
});

describe('date ranges', () => {
  const day = (d: string) => Date.parse(`${d}T18:00:00Z`); // midday in Chicago
  const cards = [
    card({ id: 'nov', dueDate: '2026-11-30', lastActivityAt: day('2026-11-02') }),
    card({ id: 'dec1', dueDate: '2026-12-01', lastActivityAt: day('2026-11-18') }),
    card({ id: 'dec31', dueDate: '2026-12-31', lastActivityAt: day('2026-11-20') }),
    card({ id: 'undated', lastActivityAt: day('2026-11-19') }),
  ];
  const ids = (f: Parameters<typeof filterCards>[1]) => filterCards(cards, f, TODAY).map((c) => c.id);

  it('a due range is inclusive at both ends, and a card with no due date is never in one', () => {
    expect(ids({ dueFrom: '2026-12-01', dueTo: '2026-12-31' })).toEqual(['dec1', 'dec31']);
    expect(ids({ dueTo: '2026-12-01' })).toEqual(['nov', 'dec1']);
    expect(ids({ dueFrom: '2026-12-02' })).toEqual(['dec31']);
  });

  it('an activity range reads the last activity as a day in the org timezone, inclusive', () => {
    expect(ids({ activeFrom: '2026-11-18', activeTo: '2026-11-19' })).toEqual(['dec1', 'undated']);
    expect(ids({ activeFrom: '2026-11-19' })).toEqual(['dec31', 'undated']);
    // 03:00 UTC on the 21st is still the 20th in Chicago.
    const late = [card({ id: 'late', lastActivityAt: Date.parse('2026-11-21T03:00:00Z') })];
    expect(filterCards(late, { activeTo: '2026-11-20' }, TODAY).map((c) => c.id)).toEqual(['late']);
  });

  it('counts as an active filter', () => {
    expect(hasActiveFilters({ dueFrom: '2026-12-01' })).toBe(true);
    expect(hasActiveFilters({ activeTo: '2026-11-20' })).toBe(true);
  });
});

describe('hasActiveFilters', () => {
  it('is false for an empty filter set', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ text: '   ', due: 'any' })).toBe(false);
    // An EMPTY list is not a filter — otherwise clearing the last chip would
    // leave the screen insisting something is still narrowing. `Boolean([])` is
    // `true`, so this is the trap a truthiness test walks straight into, for
    // BOTH array facets.
    expect(hasActiveFilters({ labelIds: [] })).toBe(false);
    expect(hasActiveFilters({ priorities: [] })).toBe(false);
  });

  it('is true when anything narrows', () => {
    expect(hasActiveFilters({ text: 'x' })).toBe(true);
    expect(hasActiveFilters({ assigneeUid: 'u1' })).toBe(true);
    expect(hasActiveFilters({ due: 'overdue' })).toBe(true);
    expect(hasActiveFilters({ archivedOnly: true })).toBe(true);
    expect(hasActiveFilters({ labelIds: ['l1'] })).toBe(true);
    expect(hasActiveFilters({ priorities: ['urgent'] })).toBe(true);
    // `'none'` narrows to cards with no priority — a real filter, not an absent one.
    expect(hasActiveFilters({ priorities: ['none'] })).toBe(true);
  });
});

describe('hasActiveFilters', () => {
  it('counts a board filter — it is what shows the clear button', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ boardId: 'b2' })).toBe(true);
  });
});

describe('rankMatches', () => {
  it('puts a title prefix first, then title contains, then description only', () => {
    const cards = [
      card({ id: 'desc', title: 'Zebra', description: 'about signup' }),
      card({ id: 'contains', title: 'Fix signup flow', description: '' }),
      card({ id: 'prefix', title: 'signup broken', description: '' }),
    ];
    expect(rankMatches(cards, 'signup').map((c) => c.id)).toEqual([
      'prefix',
      'contains',
      'desc',
    ]);
  });

  it('is stable and alphabetical within a tier', () => {
    const cards = [
      card({ id: 'b', title: 'signup beta' }),
      card({ id: 'a', title: 'signup alpha' }),
    ];
    expect(rankMatches(cards, 'signup').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('leaves order alone for an empty query', () => {
    const cards = [card({ id: 'x' }), card({ id: 'y' })];
    expect(rankMatches(cards, '').map((c) => c.id)).toEqual(['x', 'y']);
  });
});

describe('lastActivityOf', () => {
  it('takes the latest of the three, not a preference order', () => {
    // A card edited AFTER its last comment must sort by the edit. A preference
    // order that read `lastActivityAt` first would file it under the comment.
    expect(lastActivityOf(card({ lastActivityAt: 100, updatedAt: 500, createdAt: 1 }))).toBe(500);
    expect(lastActivityOf(card({ lastActivityAt: 900, updatedAt: 500, createdAt: 1 }))).toBe(900);
  });

  /**
   * The floor is what stops an old card reading as epoch zero — which pins it to
   * the bottom of "Newest" and, worse, to the TOP of "Oldest", where it looks
   * like an answer rather than a card with no timestamps.
   */
  it('falls back to createdAt when neither timestamp exists', () => {
    expect(lastActivityOf(card({ createdAt: 42 }))).toBe(42);
    expect(lastActivityOf(card())).toBe(0);
  });
});

describe('orderCards', () => {
  const cards = [
    card({ id: 'mid', title: 'Mid signup', createdAt: 200 }),
    card({ id: 'new', title: 'New signup', createdAt: 1, lastActivityAt: 300 }),
    card({ id: 'old', title: 'Old signup', createdAt: 1, updatedAt: 100 }),
  ];

  it('newest first puts the most recent activity at the top', () => {
    expect(orderCards(cards, 'newest', '').map((c) => c.id)).toEqual(['new', 'mid', 'old']);
  });

  it('oldest first is the exact reverse', () => {
    expect(orderCards(cards, 'oldest', '').map((c) => c.id)).toEqual(['old', 'mid', 'new']);
  });

  /**
   * With an empty box `best` IS `newest` — correct, not a duplicate option. The
   * two diverge only when there is a query, which is the only state in which
   * relevance exists.
   */
  it('best matches newest while the box is empty', () => {
    expect(orderCards(cards, 'best', '  ').map((c) => c.id)).toEqual(
      orderCards(cards, 'newest', '').map((c) => c.id),
    );
  });

  it('best ranks by relevance once there is a query', () => {
    const byTitle = [
      card({ id: 'desc', title: 'Zebra', description: 'about signup', createdAt: 900 }),
      card({ id: 'prefix', title: 'signup broken', createdAt: 1 }),
    ];
    // Relevance wins over recency: the newest card is the description-only match.
    expect(orderCards(byTitle, 'best', 'signup').map((c) => c.id)).toEqual(['prefix', 'desc']);
    // And a chosen date order overrides relevance rather than being ignored.
    expect(orderCards(byTitle, 'newest', 'signup').map((c) => c.id)).toEqual(['desc', 'prefix']);
  });

  it('breaks ties by title so the order does not reshuffle between renders', () => {
    const tied = [
      card({ id: 'b', title: 'Beta', createdAt: 5 }),
      card({ id: 'a', title: 'Alpha', createdAt: 5 }),
    ];
    expect(orderCards(tied, 'newest', '').map((c) => c.id)).toEqual(['a', 'b']);
    // And the tie-break TURNS with the direction, so the two stay exact reverses
    // of each other — which is what the manual promises "Oldest first" is.
    expect(orderCards(tied, 'oldest', '').map((c) => c.id)).toEqual(['b', 'a']);
  });

  /**
   * The property the browser suite asserts, tested where it can be made to fail.
   *
   * A tie is not exotic: `bulkCopyToBoard` stamps one `Date.now()` across a whole
   * batch, and the importer stamps every card in a list with its ClickUp date.
   * With an unflipped tie-break the reverse holds for every card EXCEPT the tied
   * ones — which is a failure that shows up in a browser run, occasionally, and
   * looks like flake.
   */
  it('orders oldest as the exact reverse of newest, ties included', () => {
    const set = [
      card({ id: 'a', title: 'Alpha', createdAt: 5 }),
      card({ id: 'b', title: 'Beta', createdAt: 5 }),
      card({ id: 'c', title: 'Gamma', createdAt: 9 }),
      card({ id: 'd', title: 'Delta', createdAt: 1 }),
      card({ id: 'e', title: 'Epsilon', createdAt: 9 }),
    ];
    const newest = orderCards(set, 'newest', '').map((c) => c.id);
    const oldest = orderCards(set, 'oldest', '').map((c) => c.id);
    expect(oldest).toEqual([...newest].reverse());
  });

  it('does not mutate its input', () => {
    const before = cards.map((c) => c.id);
    orderCards(cards, 'oldest', '');
    expect(cards.map((c) => c.id)).toEqual(before);
  });
});
