import { describe, expect, it } from 'vitest';
import { acceptsDrop, dropPlacement } from './boardDrop';

const cards = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (p: ReturnType<typeof dropPlacement<{ id: string }>>) =>
  p ? [p.before?.id ?? null, p.after?.id ?? null] : null;

describe('dropPlacement', () => {
  const group = cards('A', 'B', 'C');

  it('lands a card dragged down where the bar is, above the card it was over', () => {
    expect(ids(dropPlacement(group, 2, 'A'))).toEqual(['B', 'C']);
  });

  it('lands a card dragged to the end after the last card', () => {
    expect(ids(dropPlacement(group, 3, 'A'))).toEqual(['C', null]);
  });

  it('lands a card dragged up above the card it was over', () => {
    expect(ids(dropPlacement(group, 0, 'C'))).toEqual([null, 'A']);
    expect(ids(dropPlacement(group, 1, 'C'))).toEqual(['A', 'B']);
  });

  it('does nothing where the card already is', () => {
    expect(dropPlacement(group, 1, 'B')).toBeNull();
    expect(dropPlacement(group, 2, 'B')).toBeNull();
  });

  it('places a card from elsewhere at the index, the end included', () => {
    expect(ids(dropPlacement(group, 1, 'X'))).toEqual(['A', 'B']);
    expect(ids(dropPlacement(group, 3, 'X'))).toEqual(['C', null]);
    expect(ids(dropPlacement([], 0, 'X'))).toEqual([null, null]);
  });

  it('clamps an index past the end', () => {
    expect(ids(dropPlacement(group, 9, 'X'))).toEqual(['C', null]);
  });
});

describe('acceptsDrop', () => {
  it('keeps a card with a lane out of No lane', () => {
    expect(acceptsDrop(null, 'planning')).toBe(false);
  });

  it('takes a card without a lane into No lane, and any card into a lane', () => {
    expect(acceptsDrop(null, null)).toBe(true);
    expect(acceptsDrop('planning', null)).toBe(true);
    expect(acceptsDrop('marketing', 'planning')).toBe(true);
  });

  it('takes everything on a board without lanes', () => {
    expect(acceptsDrop(undefined, null)).toBe(true);
  });
});
