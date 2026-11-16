/**
 * Where a card dropped on the wide board lands. Pure, so every target is
 * tested here rather than decided inside event handlers.
 *
 * An index is always a position in a group AS DRAWN: the lane's cards in the
 * column (or the column's, on a board without lanes), the dragged card among
 * them while it is still there. The drop bar is drawn before the card at that
 * index; the card lands exactly there. Working in two index spaces (drawn for
 * the bar, without the dragged card for the rank) once put a card dragged
 * downwards one place below its bar.
 */

/**
 * Whether a group takes the dragged card. A card with a lane is never put in
 * No lane (`null`), as the card screen never offers it one: over No lane, or a
 * card in it, the drop falls through to the end of the card's own lane. On a
 * board without lanes `laneId` is undefined and everything is taken.
 */
export function acceptsDrop(laneId: string | null | undefined, draggedLane: string | null): boolean {
  return !(laneId === null && draggedLane !== null);
}

/**
 * The two cards a drop at `index` of `group` lands between, or null when it
 * would land where it already is.
 */
export function dropPlacement<T extends { id: string }>(
  group: readonly T[],
  index: number,
  movingId: string,
): { before: T | null; after: T | null } | null {
  const from = group.findIndex((c) => c.id === movingId);
  if (from !== -1 && (index === from || index === from + 1)) return null;
  const others = group.filter((c) => c.id !== movingId);
  // Past the dragged card, every index counts it once too many.
  const at = Math.min(from !== -1 && from < index ? index - 1 : index, others.length);
  return { before: at > 0 ? others[at - 1] : null, after: at < others.length ? others[at] : null };
}
