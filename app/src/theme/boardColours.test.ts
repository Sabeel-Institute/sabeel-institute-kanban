import { describe, expect, it } from 'vitest';
import { BOARD_COLORS, relativeLuminance } from '@sabeel/shared';
import { getTheme } from './index';

const ratio = (a: string, b: string) => {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * A board's stripe is a mark, not text: WCAG's 3:1 for non-text, against the
 * card it is drawn on and the page around the card. The screens sweep exempts
 * marks from its contrast check, so this is where the floor is held.
 */
describe('board colours in the theme', () => {
  const t = getTheme();

  it('draws every stored colour, and no other', () => {
    expect(Object.keys(t.board).sort()).toEqual([...BOARD_COLORS].sort());
  });

  it.each([...BOARD_COLORS])('%s reaches 3:1 on a card and on the canvas', (c) => {
    expect(ratio(t.board[c], t.bg.surface)).toBeGreaterThanOrEqual(3);
    expect(ratio(t.board[c], t.bg.canvas)).toBeGreaterThanOrEqual(3);
  });

  it('the empty stripe an owner aims at reaches 3:1 too: it is the only sign of the control', () => {
    // BoardStripe draws a board with no colour as a dashed outline in this ink.
    expect(ratio(t.text.secondary, t.bg.surface)).toBeGreaterThanOrEqual(3);
  });

  it('no two colours are the same', () => {
    expect(new Set(Object.values(t.board)).size).toBe(BOARD_COLORS.length);
  });
});
