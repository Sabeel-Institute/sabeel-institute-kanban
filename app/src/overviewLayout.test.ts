import { describe, expect, it } from 'vitest';
import { LANES_MAX } from '@sabeel/shared';
import { MARK_MIN, NAME_LINE, SLANT_ANGLES, laneColumns, nameGap, slantEnd } from './overviewLayout';

// A 320px phone: the screen's two 16pt gutters, then a row's padding each side.
const PAD = 13;
const PHONE_INNER = 320 - 32 - 2 * PAD;
// Widths as measured at 11px, 600 weight: the longest a 40-letter name came to
// in capitals in the fonts measured (Liberation Sans Bold, 431), and ordinary
// names.
const LONGEST = 431;
const SIX = [49, 59, 55, 47, 50, 44];

describe('laneColumns', () => {
  it('writes names straight when each fits its column on one line', () => {
    const cols = laneColumns(PHONE_INNER, PAD, [49, 55, 50]);
    expect(cols.straight).toBe(true);
    expect(cols.width).toBe(PHONE_INNER);
    expect(cols.mark).toBe(22);
  });

  it('slants names that do not fit, keeping every one inside the row', () => {
    const cols = laneColumns(PHONE_INNER, PAD, SIX);
    expect(cols.straight).toBe(false);
    SIX.forEach((_, i) => expect(slantEnd(cols, i)).toBeLessThanOrEqual(PHONE_INNER + PAD));
  });

  it('draws each name at its measured width, so none is cut', () => {
    const cols = laneColumns(PHONE_INNER, PAD, [60.4, 66.6]);
    expect(cols.nameWidths.every((w, i) => w >= [60.4, 66.6][i])).toBe(true);
  });

  it('fits twelve lanes of the longest names on a 320px phone, the marks apart', () => {
    const widths = Array(LANES_MAX).fill(LONGEST);
    const cols = laneColumns(PHONE_INNER, PAD, widths);
    expect(cols.width).toBeGreaterThan(0);
    expect(cols.width).toBeLessThanOrEqual(PHONE_INNER);
    widths.forEach((_, i) => expect(slantEnd(cols, i)).toBeLessThanOrEqual(PHONE_INNER + PAD + 0.5));
    expect(cols.mark).toBeGreaterThanOrEqual(MARK_MIN);
    expect(cols.cell - cols.mark).toBeGreaterThanOrEqual(2);
  });

  it('with the longest name last, where it reaches furthest, still keeps neighbours a line apart', () => {
    const widths = [...Array(LANES_MAX - 1).fill(40), LONGEST];
    const cols = laneColumns(PHONE_INNER, PAD, widths);
    widths.forEach((_, i) => expect(slantEnd(cols, i)).toBeLessThanOrEqual(PHONE_INNER + PAD + 0.5));
    expect(nameGap(cols)).toBeGreaterThanOrEqual(NAME_LINE);
    expect(cols.cell - cols.mark).toBeGreaterThanOrEqual(2);
  });

  it('slants as gently as keeps the names apart', () => {
    expect(laneColumns(PHONE_INNER, PAD, SIX).angle).toBe(SLANT_ANGLES[0]);
    expect(laneColumns(PHONE_INNER, PAD, [...Array(11).fill(30), LONGEST]).angle).toBeGreaterThan(SLANT_ANGLES[0]);
  });

  it('keeps only the room the furthest-reaching name needs', () => {
    const long = 214;
    const first = laneColumns(PHONE_INNER, PAD, [long, ...Array(11).fill(30)]);
    const last = laneColumns(PHONE_INNER, PAD, [...Array(11).fill(30), long]);
    expect(first.width).toBeGreaterThan(last.width);
  });

  it('shrinks the mark before two would touch', () => {
    const cols = laneColumns(PHONE_INNER, PAD, Array(LANES_MAX).fill(42));
    expect(cols.mark).toBeLessThan(22);
    expect(cols.cell - cols.mark).toBeGreaterThanOrEqual(2);
  });
});
