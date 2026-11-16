/**
 * The overview's geometry: how wide each lane's column is, whether its name is
 * written straight or on a slant, and how big a mark is. Pure, so the case the
 * decision turns on is tested rather than looked at: twelve lanes on a 320px
 * phone, every name in full, nothing scrolling sideways, no two marks touching
 * (docs/PRODUCT_BRIEF.md § Overview).
 *
 * A group's heading and every row in it draw from one answer, so a name always
 * sits over its own mark.
 */

export const NAME_FONT = 11;
/** One line of a name, at NAME_FONT. */
export const NAME_LINE = 15;
/** Room left beside a measured name, so rounding never cuts its last letter. */
const NAME_PAD = 2;
/**
 * The slants tried, gentlest first: the gentlest is easiest to read, a steeper
 * one reaches less far right, which leaves wider columns, and packs closer.
 */
export const SLANT_ANGLES = [60, 66, 72, 78] as const;
const rad = (deg: number) => (deg * Math.PI) / 180;

export const MARK_MAX = 22;
export const MARK_MIN = 10;

export interface LaneColumns {
  /** Names written straight, on one line each, over their marks. */
  straight: boolean;
  /** A slanted name's angle from the horizontal, in degrees. */
  angle: number;
  /** The marks' line, and the heading's: `cell` times the lane count. */
  width: number;
  cell: number;
  /** Each name's drawn width, in order: as measured, plus a little room. */
  nameWidths: number[];
  /** A slanted heading's height; a straight one sizes to its text. */
  height: number;
  /** A mark's diameter. */
  mark: number;
}

function markSize(cell: number): number {
  return Math.max(MARK_MIN, Math.min(MARK_MAX, Math.floor(cell) - 4));
}

/**
 * The columns for names of `measured` widths in `inner` points, where a
 * slanted name may run on `overflow` points past the right edge (the row's
 * padding).
 *
 * The widths are MEASURED, each name laid out in the app's font on the
 * platform at hand: an estimate from the letters was short for capitals, and
 * a name drawn narrower than it needs is cut with an ellipsis, which "written
 * in full" rules out.
 *
 * Straight when every name fits its column on one line. Otherwise each name
 * starts at its mark's centre and leans up to the right, and the columns
 * narrow until the name that reaches furthest ends inside `inner + overflow`:
 * the room kept on the right is what the names need, not a fixed margin, and
 * the marks shrink to fit. The slant is the gentlest at which two neighbouring
 * names are a line apart, or failing that the steepest.
 */
export function laneColumns(inner: number, overflow: number, measured: readonly number[]): LaneColumns {
  const n = Math.max(1, measured.length);
  const nameWidths = measured.map((w) => Math.ceil(w) + NAME_PAD);
  const even = inner / n;
  if (nameWidths.every((w) => w <= even - 4)) {
    return { straight: true, angle: 0, width: inner, cell: even, nameWidths, height: 0, mark: markSize(even) };
  }
  let cols: LaneColumns | null = null;
  for (const angle of SLANT_ANGLES) {
    const cos = Math.cos(rad(angle));
    // Name i ends at (i + 0.5) * width / n + its width * cos.
    let width = inner;
    nameWidths.forEach((w, i) => {
      width = Math.min(width, ((inner + overflow - w * cos) * n) / (i + 0.5));
    });
    width = Math.max(0, Math.floor(width));
    const cell = width / n;
    const height = Math.ceil(Math.max(0, ...nameWidths) * Math.sin(rad(angle)) + NAME_LINE * cos) + 6;
    cols = { straight: false, angle, width, cell, nameWidths, height, mark: markSize(cell) };
    if (namesApart(cols)) break;
  }
  return cols!;
}

/** How far apart two neighbouring slanted names are, across their slant. */
export function nameGap(cols: LaneColumns): number {
  return cols.cell * Math.sin(rad(cols.angle));
}

function namesApart(cols: LaneColumns): boolean {
  return nameGap(cols) >= NAME_LINE;
}

/** Where name i's slant ends, from the left of the marks' line. For tests. */
export function slantEnd(cols: LaneColumns, i: number): number {
  return (i + 0.5) * cols.cell + cols.nameWidths[i] * Math.cos(rad(cols.angle));
}
