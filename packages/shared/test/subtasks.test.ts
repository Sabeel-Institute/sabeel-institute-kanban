import { describe, it, expect } from 'vitest';
import {
  ancestorsOf,
  canBeSubtaskOf,
  childrenOf,
  linkableUnder,
  parentAfterMove,
  parentTitles,
  subtaskCounts,
} from '../src/subtasks';

// A small board: `a` has two subtasks, `d` is free, `e` is a subtask of `b`
// (so a -> b -> e is a two-deep chain).
const board = () => [
  { id: 'a' },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'a' },
  { id: 'd' },
  { id: 'e', parentId: 'b' },
];

describe('childrenOf', () => {
  it('returns only DIRECT children, in the order given', () => {
    // `e` is a grandchild and must not appear under `a`.
    expect(childrenOf(board(), 'a').map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('returns nothing for a card with no subtasks', () => {
    expect(childrenOf(board(), 'd')).toEqual([]);
  });

  it('preserves the caller ordering, since board cards arrive rank-sorted', () => {
    const cards = [
      { id: 'z', parentId: 'p' },
      { id: 'y', parentId: 'p' },
    ];
    expect(childrenOf(cards, 'p').map((c) => c.id)).toEqual(['z', 'y']);
  });
});

describe('subtaskCounts', () => {
  it('counts direct children per parent', () => {
    const counts = subtaskCounts(board());
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
  });

  it('omits cards that have no subtasks rather than storing zeroes', () => {
    // The card face asks `counts.get(id)`; absent and 0 must both mean "no chip".
    expect(subtaskCounts(board()).has('d')).toBe(false);
  });

  it('is empty when nothing is linked', () => {
    expect(subtaskCounts([{ id: 'a' }, { id: 'b' }]).size).toBe(0);
  });
});

describe('ancestorsOf', () => {
  it('walks the chain nearest-first', () => {
    expect(ancestorsOf(board(), 'e')).toEqual(['b', 'a']);
  });

  it('returns nothing for a root card', () => {
    expect(ancestorsOf(board(), 'a')).toEqual([]);
  });

  it('TERMINATES on a self-referencing card', () => {
    // Corrupt data must not hang the app. A pure function that can loop forever
    // is a pure function that can freeze the UI thread.
    expect(ancestorsOf([{ id: 'x', parentId: 'x' }], 'x')).toEqual([]);
  });

  it('TERMINATES on a two-card cycle', () => {
    const cards = [
      { id: 'p', parentId: 'q' },
      { id: 'q', parentId: 'p' },
    ];
    expect(ancestorsOf(cards, 'p')).toEqual(['q']);
  });

  it('TERMINATES on a deep A -> B -> C -> A cycle', () => {
    const cards = [
      { id: 'a', parentId: 'c' },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ];
    expect(ancestorsOf(cards, 'b')).toEqual(['a', 'c']);
  });

  it('stops at a parent that no longer exists', () => {
    // The parent was deleted or moved to another board — the chain just ends.
    expect(ancestorsOf([{ id: 'x', parentId: 'gone' }], 'x')).toEqual(['gone']);
  });
});

describe('canBeSubtaskOf', () => {
  it('allows a free card', () => {
    expect(canBeSubtaskOf(board(), 'd', 'a')).toBeNull();
  });

  it('refuses a card as its own subtask', () => {
    expect(canBeSubtaskOf(board(), 'a', 'a')).toBe('A card cannot be its own subtask.');
  });

  it('refuses a card that already has a parent, rather than silently stealing it', () => {
    expect(canBeSubtaskOf(board(), 'b', 'd')).toBe(
      'That card is already a subtask of another card.',
    );
  });

  it('refuses an ANCESTOR of the parent — the cycle case', () => {
    // Making `a` a subtask of `e` would leave a -> b -> e -> a with no root.
    expect(canBeSubtaskOf(board(), 'a', 'e')).toBe(
      'That card is further up this subtask chain.',
    );
  });

  it('allows linking under a card that is itself a subtask (nesting is legal)', () => {
    expect(canBeSubtaskOf(board(), 'd', 'b')).toBeNull();
  });
});

describe('linkableUnder', () => {
  it('offers only the cards that could actually be linked', () => {
    // From `a`: not itself; not b/c/e (already parented). Only `d` is free.
    expect(linkableUnder(board(), 'a').map((c) => c.id)).toEqual(['d']);
  });

  it('excludes ancestors so the picker cannot create a cycle', () => {
    const ids = linkableUnder(board(), 'e').map((c) => c.id);
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('b');
    expect(ids).toContain('d');
  });

  it('offers nothing when every other card is already linked', () => {
    const cards = [{ id: 'a' }, { id: 'b', parentId: 'a' }];
    expect(linkableUnder(cards, 'a')).toEqual([]);
  });
});

describe('parentAfterMove', () => {
  const ids = (...v: string[]) => new Set(v);

  it('keeps the link when the parent moves too — a whole family stays intact', () => {
    expect(parentAfterMove({ id: 'b', parentId: 'a' }, ids('a', 'b'))).toBe('a');
  });

  it('CLEARS the link when only the child moves, rather than dangling', () => {
    // The parent stays on the old board, so the id would resolve to nothing.
    expect(parentAfterMove({ id: 'b', parentId: 'a' }, ids('b'))).toBeUndefined();
  });

  it('clears it when the parent moves but this child does not travel with it', () => {
    // Symmetric case: the child left behind is handled by its own move, but a
    // parent moving alone must not be treated as keeping anything.
    expect(parentAfterMove({ id: 'a' }, ids('a'))).toBeUndefined();
  });

  it('leaves an unparented card unparented', () => {
    expect(parentAfterMove({ id: 'x' }, ids('x', 'y'))).toBeUndefined();
  });

  it('keeps a grandchild linked when the whole chain moves', () => {
    expect(parentAfterMove({ id: 'c', parentId: 'b' }, ids('a', 'b', 'c'))).toBe('b');
  });
});

describe('parentTitles', () => {
  const titled = () => board().map((c) => ({ ...c, title: `Title ${c.id}` }));

  it('names the parent of every subtask whose parent is among the cards', () => {
    expect(parentTitles(titled())).toEqual(
      new Map([
        ['b', 'Title a'],
        ['c', 'Title a'],
        ['e', 'Title b'],
      ]),
    );
  });

  it('names nothing for a subtask whose parent is not there (archived, or another list)', () => {
    const withoutA = titled().filter((c) => c.id !== 'a');
    expect(parentTitles(withoutA)).toEqual(new Map([['e', 'Title b']]));
  });
});
