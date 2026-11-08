/**
 * Subtask links between cards on the same board.
 *
 * The link lives on the CHILD as `parentId` (see CardDoc), so a parent's list of
 * subtasks is DERIVED, never stored — two documents can never disagree about the
 * relationship, and re-parenting is a single write.
 *
 * Everything here is pure and operates on cards the caller already has. That is
 * deliberate: the card detail screen and every board layout already hold the
 * whole board's cards in memory, so subtasks need no extra query and no index.
 */

/** The minimum a card must expose to take part in a subtask relationship. */
export interface SubtaskCard {
  id: string;
  parentId?: string;
}

/**
 * The direct children of `parentId`, in the order the caller supplied — board
 * cards arrive rank-sorted, so subtasks read in board order for free.
 *
 * Only DIRECT children: nesting is allowed by the model, but the UI shows one
 * level plus a single parent line, which makes deep chains navigable without
 * anyone having to build a tree view.
 */
export function childrenOf<T extends SubtaskCard>(
  cards: readonly T[],
  parentId: string,
): T[] {
  return cards.filter((c) => c.parentId === parentId);
}

/**
 * How many subtasks each parent has, for the count on a card's face.
 *
 * Computed rather than denormalised: unlike `commentCount` or `activeCardCount`,
 * whose source documents are not loaded, every board layout already has all the
 * cards it needs. A derived count cannot drift, and costs no trigger and no field.
 */
export function subtaskCounts(cards: readonly SubtaskCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of cards) {
    if (!c.parentId) continue;
    counts.set(c.parentId, (counts.get(c.parentId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The chain of ancestors above `cardId`, nearest first.
 *
 * Guarded by a visited set so already-corrupt data (a cycle written by an older
 * build, a hand-edited document) is walked once and returned, never looped on
 * forever. A pure function that can hang is a pure function that can freeze the
 * app.
 */
export function ancestorsOf(
  cards: readonly SubtaskCard[],
  cardId: string,
): string[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: string[] = [];
  const seen = new Set<string>([cardId]);
  let current = byId.get(cardId)?.parentId;
  while (current && !seen.has(current)) {
    out.push(current);
    seen.add(current);
    current = byId.get(current)?.parentId;
  }
  return out;
}

/**
 * May `candidateId` become a subtask of `parentId`? Returns null if it may, or
 * the reason it may not — the picker uses this both to filter and to explain.
 *
 * Three refusals, each closing a real hole:
 *  - ITSELF. A card that is its own subtask renders an infinite ladder.
 *  - ALREADY A SUBTASK. Linking would silently steal it from its current parent,
 *    which looks like the other card losing work it did not lose.
 *  - AN ANCESTOR of the parent. This is the cycle case: making A a subtask of its
 *    own descendant B leaves A → B → A with no root, so neither card can be
 *    reached from the top and the count map never terminates for a human reading
 *    it.
 */
export function canBeSubtaskOf(
  cards: readonly SubtaskCard[],
  candidateId: string,
  parentId: string,
): string | null {
  if (candidateId === parentId) return 'A card cannot be its own subtask.';

  const candidate = cards.find((c) => c.id === candidateId);
  if (candidate?.parentId) {
    return 'That card is already a subtask of another card.';
  }

  if (ancestorsOf(cards, parentId).includes(candidateId)) {
    return 'That card is further up this subtask chain.';
  }

  return null;
}

/**
 * What a card's `parentId` should be after a CROSS-BOARD move, given the set of
 * cards travelling with it.
 *
 * A subtask link is board-scoped, like a board's own labels: the id only means
 * anything while both ends sit on the same board. So the link survives exactly when the parent
 * is moving too — select a parent and its subtasks and the family arrives
 * intact; move a child on its own and it arrives unlinked rather than pointing
 * at a card left behind.
 *
 * Returning `undefined` is the caller's signal to CLEAR the field, matching how
 * `updateCard` treats undefined.
 */
export function parentAfterMove(
  card: SubtaskCard,
  movingIds: ReadonlySet<string>,
): string | undefined {
  if (!card.parentId) return undefined;
  return movingIds.has(card.parentId) ? card.parentId : undefined;
}

/**
 * The cards on this board that may be linked under `parentId` right now.
 * Everything `canBeSubtaskOf` would refuse is simply absent from the picker,
 * so the common case never surfaces an error at all.
 */
export function linkableUnder<T extends SubtaskCard>(
  cards: readonly T[],
  parentId: string,
): T[] {
  return cards.filter((c) => canBeSubtaskOf(cards, c.id, parentId) === null);
}
