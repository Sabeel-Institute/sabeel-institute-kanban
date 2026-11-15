/**
 * A card tile's accessible name: its title, then what the face's subtask
 * chips say.
 *
 * On a phone a tile is one button, and its label stands in for everything
 * drawn inside it, so a screen reader hears this and nothing of the face.
 * Without the chips' words here, the only sign that a card belongs to another
 * would be invisible to anyone who cannot see it.
 */
export function cardTileName(
  card: { title: string; parentId?: string },
  marks: { subtaskCount?: number; parentTitle?: string } = {},
): string {
  const parts = [card.title];
  if (card.parentId) {
    parts.push(marks.parentTitle !== undefined ? `subtask of ${marks.parentTitle}` : 'subtask');
  }
  const n = marks.subtaskCount ?? 0;
  if (n > 0) parts.push(`${n} subtask${n === 1 ? '' : 's'}`);
  return parts.join(', ');
}
