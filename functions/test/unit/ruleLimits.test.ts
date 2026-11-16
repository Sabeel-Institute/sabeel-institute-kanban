import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BOARD_FIELDS_MAX, LANES_MAX, OVERVIEW_HIDDEN_MAX } from '@sabeel/shared';

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
});
