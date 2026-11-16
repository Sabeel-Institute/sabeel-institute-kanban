import { describe, expect, it } from 'vitest';
import { LANES_MAX, LANE_NAME_MAX } from '@sabeel/shared';
import { MARK_MIN, NAME_LINE, SLANT_ANGLES, laneColumns, nameGap, nameWidth, slantEnd } from './overviewLayout';

// A 320px phone: the screen's two 16pt gutters, then a row's padding each side.
const PAD = 13;
const PHONE_INNER = 320 - 32 - 2 * PAD;

describe('laneColumns', () => {
  it('writes short names straight when each fits its column', () => {
    const cols = laneColumns(PHONE_INNER, PAD, ['Planning', 'Marketing', 'Supplies']);
    expect(cols.straight).toBe(true);
    expect(cols.width).toBe(PHONE_INNER);
    expect(cols.mark).toBe(22);
  });

  it('slants names that do not fit, keeping every one inside the row', () => {
    const names = ['Planning', 'Curriculum', 'Marketing', 'Staffing', 'Supplies', 'Wrap-up'];
    const cols = laneColumns(PHONE_INNER, PAD, names);
    expect(cols.straight).toBe(false);
    names.forEach((_, i) => expect(slantEnd(cols, i)).toBeLessThanOrEqual(PHONE_INNER + PAD));
  });

  it('fits twelve lanes of the longest names on a 320px phone, the marks apart', () => {
    const names = Array.from({ length: LANES_MAX }, (_, i) => `${'M'.repeat(LANE_NAME_MAX - 2)}${i}`.slice(0, LANE_NAME_MAX));
    const cols = laneColumns(PHONE_INNER, PAD, names);
    expect(cols.width).toBeGreaterThan(0);
    expect(cols.width).toBeLessThanOrEqual(PHONE_INNER);
    names.forEach((_, i) => expect(slantEnd(cols, i)).toBeLessThanOrEqual(PHONE_INNER + PAD + 0.5));
    expect(cols.mark).toBeGreaterThanOrEqual(MARK_MIN);
    // Two marks never touch: each sits in its own column with room either side.
    expect(cols.cell - cols.mark).toBeGreaterThanOrEqual(2);
    // Each name is drawn at its whole width: written in full.
    expect(cols.nameWidths).toEqual(names.map(nameWidth));
  });

  it('with the longest name last, where it reaches furthest, still keeps neighbours a line apart', () => {
    const names = [...Array.from({ length: LANES_MAX - 1 }, (_, i) => `Lane ${i}`), 'M'.repeat(LANE_NAME_MAX)];
    const cols = laneColumns(PHONE_INNER, PAD, names);
    names.forEach((_, i) => expect(slantEnd(cols, i)).toBeLessThanOrEqual(PHONE_INNER + PAD + 0.5));
    expect(nameGap(cols)).toBeGreaterThanOrEqual(NAME_LINE);
    expect(cols.cell - cols.mark).toBeGreaterThanOrEqual(2);
  });

  it('slants as gently as keeps the names apart', () => {
    const six = laneColumns(PHONE_INNER, PAD, ['Planning', 'Curriculum', 'Marketing', 'Staffing', 'Supplies', 'Wrap-up']);
    expect(six.angle).toBe(SLANT_ANGLES[0]);
    const twelve = laneColumns(PHONE_INNER, PAD, [...Array(11).fill('Food'), 'M'.repeat(LANE_NAME_MAX)]);
    expect(twelve.angle).toBeGreaterThan(SLANT_ANGLES[0]);
  });

  it('keeps only the room the furthest-reaching name needs', () => {
    // A long name first reaches less far than the same name last.
    const long = 'Marketing and outreach to local families';
    const first = laneColumns(PHONE_INNER, PAD, [long, ...Array(11).fill('Food')]);
    const last = laneColumns(PHONE_INNER, PAD, [...Array(11).fill('Food'), long]);
    expect(first.width).toBeGreaterThan(last.width);
  });

  it('shrinks the mark before two would touch', () => {
    const cols = laneColumns(PHONE_INNER, PAD, Array.from({ length: LANES_MAX }, (_, i) => `Lane ${i}`));
    expect(cols.mark).toBeLessThan(22);
    expect(cols.cell - cols.mark).toBeGreaterThanOrEqual(2);
  });
});
