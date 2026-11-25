/**
 * A board's colour: a stripe down the left edge of its card in the Boards
 * list, and nowhere else (Faisal, 2026-11-25). A lighter stand-in for board
 * categories: nothing to name or manage, just a colour the board's owners and
 * admins pick.
 *
 * Stored as one of these KEYS, never a hex value, so the shades stay the
 * app's to tune (`palette.ts`, where each one measures at least 3:1 against a
 * card) and a stored board never needs rewriting for it. `firestore.rules`
 * restates the list, held to it by `functions/test/unit/ruleLimits.test.ts`.
 */
export const BOARD_COLORS = [
  'raspberry',
  'green',
  'blue',
  'violet',
  'orange',
  'red',
  'gold',
  'taupe',
] as const;

export type BoardColor = (typeof BOARD_COLORS)[number];

/** Each colour's name, as a person and an agent read it. */
export const BOARD_COLOR_NAMES: Record<BoardColor, string> = {
  raspberry: 'Raspberry',
  green: 'Green',
  blue: 'Blue',
  violet: 'Violet',
  orange: 'Orange',
  red: 'Red',
  gold: 'Gold',
  taupe: 'Taupe',
};

export function isBoardColor(value: unknown): value is BoardColor {
  return typeof value === 'string' && (BOARD_COLORS as readonly string[]).includes(value);
}
