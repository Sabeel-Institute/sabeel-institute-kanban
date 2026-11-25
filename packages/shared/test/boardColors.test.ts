import { describe, expect, it } from 'vitest';
import { BOARD_COLORS, BOARD_COLOR_NAMES, isBoardColor } from '../src/boardColors';
import { boardExtras, withCleanExtras } from '../src/boardShape';

describe('board colours', () => {
  it('names every colour, and no two alike', () => {
    expect(Object.keys(BOARD_COLOR_NAMES).sort()).toEqual([...BOARD_COLORS].sort());
    expect(new Set(Object.values(BOARD_COLOR_NAMES)).size).toBe(BOARD_COLORS.length);
  });

  it('knows its own keys only, never a hex value', () => {
    expect(BOARD_COLORS.every(isBoardColor)).toBe(true);
    for (const v of ['#4E7A43', 'Green', 'teal', '', null, undefined, 3]) expect(isBoardColor(v)).toBe(false);
  });

  it('reads a board’s colour, and drops one this build does not know', () => {
    expect(boardExtras({ color: 'green' }).color).toBe('green');
    expect('color' in boardExtras({ color: 'teal' })).toBe(false);
    expect('color' in boardExtras({})).toBe(false);
    // The server's reader replaces what it does not know rather than passing it through.
    expect('color' in withCleanExtras({ color: 'teal' })).toBe(false);
  });
});
