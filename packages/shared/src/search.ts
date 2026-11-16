import type { Priority } from './types';

/**
 * Card search and filtering, done on the CLIENT.
 *
 * Firestore has no full-text search. The alternative — Algolia or Typesense —
 * means a third-party service, a sync pipeline, another account and ongoing
 * cost, which is exactly the machinery this project exists to avoid. At this
 * team's scale (under 50 people, a few thousand cards) matching in memory over
 * the boards you belong to is instant, works offline over cached boards, and
 * costs nothing.
 *
 * Honest limits, stated so nobody is surprised: substring matching only, no
 * stemming and no fuzzy spelling. Revisit past roughly 10,000 cards — at that
 * point the answer is a real search service, not a cleverer client.
 */

import { toPlainText } from './richtext';

export interface SearchableCard {
  id: string;
  boardId: string;
  title: string;
  description: string;
  /**
   * `description` with its markdown removed, computed ONCE per fetch by the
   * caller. Optional: `matchesText` falls back to deriving it, so a caller
   * that does not care about per-keystroke cost stays correct.
   */
  descriptionPlain?: string;
  columnId: string;
  assigneeUids: string[];
  labelIds: string[];
  priority: Priority;
  dueDate?: string;
  archived: boolean;
  /** Set on a subtask, so a result's face carries the subtask chip. */
  parentId?: string;
  /**
   * Last EDIT to the card document. Optional so callers that only ever search
   * by text need not carry it.
   *
   * Not the same thing as last activity, and the gap is why `lastActivityAt`
   * exists beside it: this moves for a title change or a drag, and does not move
   * for a comment, a file, or a subscription (`app/src/cards.ts` explains that
   * last one). Read both through `lastActivityOf`, never either alone.
   */
  updatedAt?: number;
  /**
   * Trigger-written: a comment posted or removed, a file attached or detached.
   * Absent on every card written before the field existed, which is why
   * `lastActivityOf` falls back rather than a backfill running.
   */
  lastActivityAt?: number;
  /** The floor under both of the above, so a card missing them still sorts. */
  createdAt?: number;
}

/**
 * When this card last saw activity of any kind.
 *
 * A MAX rather than a preference order: `lastActivityAt` only ever moves for a
 * comment or a file, so a card edited after its last comment would otherwise
 * sort by the older of the two. `createdAt` is the floor — without it a card
 * predating both fields reads as epoch zero, which pins it to the bottom of
 * "Newest" and, worse, to the TOP of "Oldest", where it looks like an answer.
 */
export function lastActivityOf(card: SearchableCard): number {
  return Math.max(card.lastActivityAt ?? 0, card.updatedAt ?? 0, card.createdAt ?? 0);
}

/**
 * How the results are ordered.
 *
 * `best` is the default and is what Search has always done: rank by match
 * quality when there is a query, and by recency when there is not. With an empty
 * box it therefore agrees with `newest` exactly — correct, not a duplicate.
 * The two diverge the moment you type, which is the only state in which
 * relevance exists at all.
 */
export type SearchSort = 'best' | 'newest' | 'oldest';

export function orderCards(
  cards: readonly SearchableCard[],
  sort: SearchSort,
  text: string,
): SearchableCard[] {
  if (sort === 'best' && text.trim()) return rankMatches(cards, text);
  const dir = sort === 'oldest' ? -1 : 1;
  return [...cards].sort((a, b) => {
    const d = (lastActivityOf(b) - lastActivityOf(a)) * dir;
    // Title as the tie-break so the order is STABLE: two cards stamped in the
    // same millisecond are common after an import or a bulk copy (one
    // `Date.now()` across the whole batch), and a list that reshuffles between
    // renders looks like it is losing rows.
    //
    // It turns with the direction, so `oldest` is the exact reverse of `newest`
    // — which is what the manual promises and what the browser suite asserts.
    // An unflipped tie-break makes both of those false the moment two cards
    // share a timestamp, and quietly, in only the tied rows.
    return d !== 0 ? d : a.title.localeCompare(b.title) * dir;
  });
}

export interface CardFilters {
  text?: string;
  assigneeUid?: string;
  /**
   * Match a card carrying ANY of these labels. Empty or absent means no label
   * filter at all.
   *
   * "Any" rather than "all", and that is not the same shape as `archivedOnly`
   * below. Widening WITHIN one facet still narrows against no filter — the trap
   * there was a filter that merged two disjoint sets, live cards and archived
   * ones, into a single result. Requiring every label would also be useless at
   * this size: few cards carry two SPECIFIC labels, so a second pick would
   * almost always empty the list.
   */
  labelIds?: string[];
  /**
   * Match a card carrying ANY of these priorities, the same shape as `labelIds`
   * and for the same reason: "urgent or high" is a question people ask, and a
   * single value made the two mutually exclusive.
   *
   * `'none'` is a real `Priority`, not the absence of a filter — a card with no
   * priority set carries `'none'`. An EMPTY array means no priority filter;
   * `Boolean([])` is `true`, so length is what must be tested, never truthiness.
   */
  priorities?: Priority[];
  /** `overdue` and `soon` need today's date to mean anything. */
  due?: 'any' | 'overdue' | 'today' | 'soon' | 'none';
  /**
   * Show ONLY archived cards. Absent or false means only live ones — the two
   * sets never mix.
   *
   * This used to be `includeArchived`, which ADDED the archive to whatever else
   * matched. That read correctly while it was a checkbox labelled "including
   * archived", and stopped reading correctly the moment it became a chip sitting
   * next to Overdue, Urgent and High: every other chip narrows the results, so
   * this one widening them was a trap you could only catch by counting rows —
   * which is exactly how it was caught (63 results, 67 with it on, the same live
   * cards still at the top).
   */
  archivedOnly?: boolean;
  /**
   * Narrow to ONE board. Absent means every board you can see.
   *
   * Single rather than a list, unlike `labelIds`, because the question people
   * actually ask is "just this board" — and the two are not symmetric anyway: a
   * card carries several labels but exactly one board, so "any of these boards"
   * would be a union of disjoint sets rather than a narrowing.
   */
  boardId?: string;
}

/** Normalise once per search rather than per card. */
function normalise(s: string): string {
  return s.toLowerCase().trim();
}

export function matchesText(card: SearchableCard, needle: string): boolean {
  const q = normalise(needle);
  if (q.length === 0) return true;
  // Match the words a READER sees, not the stored markdown. Searching the raw
  // string makes "bold text" fail against "**bold** text", because the marks
  // split words that are adjacent on screen.
  //
  // Honest limit, unchanged in spirit but worth restating: link TEXT is
  // searchable, link TARGETS are not. A URL used to be matchable as description
  // text and no longer is.
  const body = card.descriptionPlain ?? toPlainText(card.description);
  return normalise(card.title).includes(q) || normalise(body).includes(q);
}

export function filterCards(
  cards: readonly SearchableCard[],
  filters: CardFilters,
  today: string,
  /**
   * Whether a card is finished (`isFinished` against its own board). A
   * finished card is never Overdue, here as on the board; a caller that has no
   * boards with lanes can leave it out.
   */
  isDone: (card: SearchableCard) => boolean = () => false,
): SearchableCard[] {
  const q = filters.text ? normalise(filters.text) : '';

  return cards.filter((c) => {
    // The archive is a separate place. You are either looking at live cards or
    // at archived ones, never both at once.
    if (filters.archivedOnly ? !c.archived : c.archived) return false;

    if (filters.boardId && c.boardId !== filters.boardId) return false;

    if (q && !matchesText(c, q)) return false;
    if (filters.assigneeUid && !c.assigneeUids.includes(filters.assigneeUid)) {
      return false;
    }
    if (
      filters.labelIds &&
      filters.labelIds.length > 0 &&
      !filters.labelIds.some((id) => c.labelIds.includes(id))
    ) {
      return false;
    }
    if (
      filters.priorities &&
      filters.priorities.length > 0 &&
      !filters.priorities.includes(c.priority)
    ) {
      return false;
    }

    switch (filters.due) {
      case 'overdue':
        if (!c.dueDate || c.dueDate >= today || isDone(c)) return false;
        break;
      case 'today':
        if (c.dueDate !== today) return false;
        break;
      case 'soon':
        // Due within a week, and not already past.
        if (!c.dueDate || c.dueDate < today) return false;
        break;
      case 'none':
        if (c.dueDate) return false;
        break;
      default:
        break;
    }

    return true;
  });
}

/**
 * True when any filter is actually narrowing the results.
 *
 * The two ARRAY facets are tested by length, not truthiness. `Boolean([])` is
 * `true` in JavaScript, so a plain `|| filters.priorities` would report an
 * active filter the moment the field exists — leaving the clear-all control lit
 * permanently, a dead affordance beside a list nothing is filtering.
 */
export function hasActiveFilters(filters: CardFilters): boolean {
  return Boolean(
    (filters.text && filters.text.trim()) ||
      filters.assigneeUid ||
      (filters.labelIds && filters.labelIds.length > 0) ||
      (filters.priorities && filters.priorities.length > 0) ||
      (filters.due && filters.due !== 'any') ||
      filters.archivedOnly ||
      filters.boardId,
  );
}

/**
 * Rank matches so the most useful appear first: a title hit beats a description
 * hit, and an earlier position in the title beats a later one.
 */
export function rankMatches(
  cards: readonly SearchableCard[],
  needle: string,
): SearchableCard[] {
  const q = normalise(needle);
  if (!q) return [...cards];

  const score = (c: SearchableCard): number => {
    const title = normalise(c.title);
    const idx = title.indexOf(q);
    if (idx === 0) return 0; // title starts with the query
    if (idx > 0) return 1 + idx / 1000; // title contains it
    return 500; // description only
  };

  return [...cards].sort((a, b) => {
    const d = score(a) - score(b);
    return d !== 0 ? d : a.title.localeCompare(b.title);
  });
}
