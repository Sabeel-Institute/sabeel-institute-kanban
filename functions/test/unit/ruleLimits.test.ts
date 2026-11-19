import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BOARD_FIELDS_MAX,
  COLLAPSED_LANE_BOARDS_MAX,
  COLLAPSED_SECTIONS_MAX,
  COMMENT_BODY_MAX,
  LANES_MAX,
  MAX_WATCHED_COLUMNS,
  MAX_WATCHED_LANES,
  OVERVIEW_HIDDEN_MAX,
  OVERVIEW_SORTS,
} from '@sabeel/shared';

/**
 * LIMITS THE RULES RESTATE. Rules cannot import TypeScript, so a cap the app
 * enforces and the rules enforce again is written twice; this is what keeps the
 * two the same number. Paths resolve from the functions workspace, vitest's
 * cwd here.
 */
const rules = readFileSync(resolve('..', 'firestore.rules'), 'utf8');

/** Every number a rules expression compares `field.size()` against. */
function sizeBounds(field: string): number[] {
  const re = new RegExp(`\\.${field}\\.size\\(\\) <= (\\d+)`, 'g');
  return [...rules.matchAll(re)].map((m) => Number(m[1]));
}

describe('limits restated in firestore.rules', () => {
  it('bounds a board’s lanes at LANES_MAX, once', () => {
    expect(LANES_MAX).toBeGreaterThan(0);
    expect(sizeBounds('lanes')).toEqual([LANES_MAX]);
  });

  it('bounds a board’s fields, and the values they hold, at BOARD_FIELDS_MAX', () => {
    expect(BOARD_FIELDS_MAX).toBeGreaterThan(0);
    expect(sizeBounds('fields')).toEqual([BOARD_FIELDS_MAX]);
    expect(sizeBounds('details')).toEqual([BOARD_FIELDS_MAX]);
  });

  it('bounds the boards one person hides from the overview at OVERVIEW_HIDDEN_MAX', () => {
    expect(sizeBounds('overviewHiddenBoardIds')).toEqual([OVERVIEW_HIDDEN_MAX]);
  });

  it('bounds the columns and lanes one person watches', () => {
    expect(sizeBounds('watchedColumns')).toEqual([MAX_WATCHED_COLUMNS]);
    expect(sizeBounds('watchedLanes')).toEqual([MAX_WATCHED_LANES]);
  });

  it('bounds what one person collapses at the shared limits', () => {
    expect(sizeBounds('collapsedBoardSections')).toEqual([COLLAPSED_SECTIONS_MAX]);
    expect(sizeBounds('collapsedLanes')).toEqual([COLLAPSED_LANE_BOARDS_MAX]);
  });

  it('bounds a comment at COMMENT_BODY_MAX, which the comment box counts against', () => {
    const bounds = [...rules.matchAll(/comment\(\)\.body\.size\(\) <= (\d+)/g)].map((m) => Number(m[1]));
    expect(bounds).toEqual([COMMENT_BODY_MAX, COMMENT_BODY_MAX]);
  });

  it('admits exactly the overview orders the app offers', () => {
    const m = /\.overviewSort in \[([^\]]*)\]/.exec(rules);
    expect(m).not.toBeNull();
    const listed = [...m![1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    expect(listed).toEqual([...OVERVIEW_SORTS]);
  });
});
