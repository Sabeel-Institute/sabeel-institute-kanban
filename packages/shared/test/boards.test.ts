import { describe, it, expect } from 'vitest';
import {
  BOARD_NAME_MAX,
  COLUMN_NAME_MAX,
  LABEL_COLORS,
  columnDeleteBlocked,
  columnsPatch,
  describeLabelUsage,
  defaultColumns,
  newBoard,
  labelIdsAfterBoardChange,
  labelsForBoard,
  newLabel,
  sortLabels,
  pushRecent,
  renameColumn,
  sortBoardsForList,
  validateBoardName,
  validateColumnName,
  validateLabelName,
  LABEL_NAME_MAX,
} from '../src/boards';

describe('newBoard', () => {
  it('always includes the creator as a member', () => {
    // A board nobody can see is a support ticket.
    const b = newBoard({ name: 'Ops', createdBy: 'u1', now: 1 });
    expect(b.memberUids).toEqual(['u1']);
  });

  it('starts with the three default columns', () => {
    const b = newBoard({ name: 'Ops', createdBy: 'u1', now: 1 });
    expect(b.columns.map((c) => c.name)).toEqual(['To Do', 'In Progress', 'Done']);
  });

  it('gives every default column a distinct id', () => {
    const ids = defaultColumns().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('trims the name and description', () => {
    const b = newBoard({ name: '  Ops  ', description: '  x  ', createdBy: 'u1', now: 1 });
    expect(b.name).toBe('Ops');
    expect(b.description).toBe('x');
  });

  it('is never born archived', () => {
    expect(newBoard({ name: 'Ops', createdBy: 'u1', now: 1 }).archived).toBe(false);
  });
});

describe('validation', () => {
  it('rejects an empty or whitespace name', () => {
    expect(validateBoardName('')).not.toBeNull();
    expect(validateBoardName('   ')).not.toBeNull();
  });

  it('accepts a normal name', () => {
    expect(validateBoardName('Fundraising 2026')).toBeNull();
  });

  it('rejects an over-long name', () => {
    expect(validateBoardName('x'.repeat(BOARD_NAME_MAX + 1))).not.toBeNull();
    expect(validateBoardName('x'.repeat(BOARD_NAME_MAX))).toBeNull();
  });

  it('rejects an empty or over-long label name', () => {
    expect(validateLabelName('', [])).not.toBeNull();
    expect(validateLabelName('   ', [])).not.toBeNull();
    expect(validateLabelName('donor-facing', [])).toBeNull();
    expect(validateLabelName('x'.repeat(LABEL_NAME_MAX), [])).toBeNull();
    expect(validateLabelName('x'.repeat(LABEL_NAME_MAX + 1), [])).not.toBeNull();
  });

  it('measures the label name AFTER trimming', () => {
    // The field caps raw input, so an at-the-limit name padded with spaces is
    // the shape that would otherwise be rejected for being one over.
    expect(validateLabelName(`  ${'x'.repeat(LABEL_NAME_MAX)}  `, [])).toBeNull();
  });

  it('rejects a duplicate label name, case-insensitively', () => {
    // Two chips reading "Urgent" and "urgent" are indistinguishable on a card
    // face, so the pair is unusable rather than merely untidy. Uniqueness is
    // now org-wide, not per board: one set, one name each.
    const labels = [label('l1', 'Urgent')];
    expect(validateLabelName('urgent', labels)).not.toBeNull();
    expect(validateLabelName('  URGENT  ', labels)).not.toBeNull();
    expect(validateLabelName('Urgent', labels)).not.toBeNull();
    expect(validateLabelName('donor-facing', labels)).toBeNull();
  });

  it('lets a rename keep its own name', () => {
    // Without the self-exclusion, renaming "Urgent" to "Urgent " — or opening
    // the editor and saving unchanged — fails its own uniqueness check.
    const labels = [label('l1', 'Urgent'), label('l2', 'Blocked')];
    expect(validateLabelName('Urgent', labels, 'l1')).toBeNull();
    expect(validateLabelName('Urgent Fix', labels, 'l1')).toBeNull();
    // But it still cannot take a name another label already holds.
    expect(validateLabelName('Blocked', labels, 'l1')).not.toBeNull();
  });

  it('rejects a duplicate column name, case-insensitively', () => {
    const cols = [{ id: 'c1', name: 'To Do' }];
    expect(validateColumnName('to do', cols)).not.toBeNull();
    expect(validateColumnName('  TO DO  ', cols)).not.toBeNull();
    expect(validateColumnName('Blocked', cols)).toBeNull();
  });
});

function label(id: string, name: string, color = '#83114F') {
  return { id, name, color, createdAt: 1, createdBy: 'u1' };
}

describe('label colours', () => {
  it('offers a fixed palette rather than a free picker', () => {
    // Free colour choice guarantees someone picks pale yellow and it disappears
    // in light mode. The palette is chosen to hold on both backgrounds.
    expect(LABEL_COLORS.length).toBeGreaterThan(4);
    for (const c of LABEL_COLORS) expect(c).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe('sortBoardsForList', () => {
  const boards = [
    { id: 'b1', name: 'Zebra' },
    { id: 'b2', name: 'Apple' },
    { id: 'b3', name: 'Mango' },
    { id: 'b4', name: 'Banana' },
  ];

  it('puts favourites first, alphabetically', () => {
    const { favourites } = sortBoardsForList(boards, ['b1', 'b2'], []);
    expect(favourites.map((b) => b.name)).toEqual(['Apple', 'Zebra']);
  });

  it('orders recents most-recent-first, not alphabetically', () => {
    const { recents } = sortBoardsForList(boards, [], ['b3', 'b4']);
    expect(recents.map((b) => b.name)).toEqual(['Mango', 'Banana']);
  });

  it('never repeats a board across sections', () => {
    const { favourites, recents, others } = sortBoardsForList(
      boards,
      ['b1'],
      ['b1', 'b2'],
    );
    const all = [...favourites, ...recents, ...others].map((b) => b.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(['b1', 'b2', 'b3', 'b4']);
  });

  it('a favourite outranks its recent entry', () => {
    const { favourites, recents } = sortBoardsForList(boards, ['b1'], ['b1']);
    expect(favourites.map((b) => b.id)).toEqual(['b1']);
    expect(recents).toEqual([]);
  });

  it('sorts the remainder alphabetically', () => {
    const { others } = sortBoardsForList(boards, [], []);
    expect(others.map((b) => b.name)).toEqual(['Apple', 'Banana', 'Mango', 'Zebra']);
  });

  it('ignores favourite/recent ids for boards that are gone', () => {
    const { favourites, recents } = sortBoardsForList(boards, ['deleted'], ['gone']);
    expect(favourites).toEqual([]);
    expect(recents).toEqual([]);
  });
});

describe('columnsPatch', () => {
  // The invariant: columnIds must always be exactly the ids of columns, in order.
  // firestore.rules validates card writes against columnIds, so a desynced pair
  // would reject valid cards or accept invented columns.
  it('derives columnIds as the columns ids, in order', () => {
    const columns = [
      { id: 'c1', name: 'To Do' },
      { id: 'c3', name: 'Doing' },
      { id: 'c2', name: 'Done' },
    ];
    expect(columnsPatch(columns)).toEqual({
      columns,
      columnIds: ['c1', 'c3', 'c2'],
    });
  });

  it('handles an empty column list', () => {
    expect(columnsPatch([])).toEqual({ columns: [], columnIds: [] });
  });

  it('keeps columnIds in sync after a column is removed', () => {
    const columns = [
      { id: 'c1', name: 'To Do' },
      { id: 'c2', name: 'Done' },
    ];
    const { columnIds } = columnsPatch(columns.filter((c) => c.id !== 'c1'));
    expect(columnIds).toEqual(['c2']);
  });
});

describe('newLabel', () => {
  it('trims the name and records colour and authorship', () => {
    const made = newLabel({ name: '  Urgent  ', color: '#83114F', createdBy: 'u1', now: 7, boardId: null });
    expect(made).toEqual({
      name: 'Urgent',
      color: '#83114F',
      createdAt: 7,
      createdBy: 'u1',
    });
  });

  it('mints no id — a label is a real document now, so Firestore does', () => {
    // The id used to be a `lbl_` local id embedded in the board array. Handing
    // one out here again would mean two id schemes for the same thing.
    expect(
      'id' in newLabel({ name: 'x', color: '#83114F', createdBy: 'u1', now: 1, boardId: null }),
    ).toBe(false);
  });
});

describe('describeLabelUsage', () => {
  it('says nothing uses it', () => {
    expect(describeLabelUsage({ active: 0, archived: 0 })).toBe('No cards use it.');
  });

  it('counts live cards alone when nothing is archived', () => {
    expect(describeLabelUsage({ active: 1, archived: 0 })).toBe('It is on 1 card.');
    expect(describeLabelUsage({ active: 4, archived: 0 })).toBe('It is on 4 cards.');
  });

  it('says so when every card is archived', () => {
    // Otherwise "on 3 cards" sends someone looking for cards no board shows.
    expect(describeLabelUsage({ active: 0, archived: 3 })).toBe(
      'It is on 3 cards, all archived.',
    );
  });

  it('separates the two when there are both', () => {
    expect(describeLabelUsage({ active: 2, archived: 1 })).toBe(
      'It is on 2 cards, plus 1 card in the archive.',
    );
  });
});

describe('sortLabels', () => {
  it('orders by name the way a reader would, not by code unit', () => {
    const sorted = sortLabels([
      label('l1', 'Volunteers'),
      label('l2', 'blocked'),
      label('l3', 'Finance'),
    ]).map((l) => l.name);
    expect(sorted).toEqual(['blocked', 'Finance', 'Volunteers']);
  });

  it('files an emoji-prefixed name under its WORD, not under the emoji', () => {
    // Twelve of the migrated labels carry a ClickUp emoji. Sorting on the raw
    // string — by code unit OR by locale — piles all of them at one end, which
    // is not where anyone looks for "Governance".
    const sorted = sortLabels([
      label('l1', 'Volunteers'),
      label('l2', '📋 Governance'),
      label('l3', 'Finance'),
      label('l4', '🚧 Blocked'),
    ]).map((l) => l.name);
    expect(sorted).toEqual(['🚧 Blocked', 'Finance', '📋 Governance', 'Volunteers']);
  });

  it('still places a name that is nothing but punctuation', () => {
    expect(sortLabels([label('l1', 'a'), label('l2', '???')]).length).toBe(2);
  });

  it('does not mutate its input', () => {
    const input = [label('l1', 'b'), label('l2', 'a')];
    sortLabels(input);
    expect(input.map((l) => l.name)).toEqual(['b', 'a']);
  });
});


describe('pushRecent', () => {
  it('puts the board first', () => {
    expect(pushRecent(['a', 'b'], 'c', 10)).toEqual(['c', 'a', 'b']);
  });

  it('de-duplicates rather than growing', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b', 10)).toEqual(['b', 'a', 'c']);
  });

  it('caps the list', () => {
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
});

describe('renameColumn', () => {
  const cols = () => [
    { id: 'c1', name: 'To Do' },
    { id: 'c2', name: 'In Progress' },
    { id: 'c3', name: 'Done' },
  ];

  it('renames the target and leaves the others alone', () => {
    const r = renameColumn(cols(), 'c2', 'Doing');
    expect(r.ok).toBe(true);
    expect(r.ok && r.columns).toEqual([
      { id: 'c1', name: 'To Do' },
      { id: 'c2', name: 'Doing' },
      { id: 'c3', name: 'Done' },
    ]);
  });

  it('trims', () => {
    const r = renameColumn(cols(), 'c1', '  Backlog  ');
    expect(r.ok && r.columns[0].name).toBe('Backlog');
  });

  // The whole reason this helper exists: the column being renamed is itself in
  // the list, so a naive duplicate check rejects its own name.
  it('accepts re-saving a column with the name it already has', () => {
    expect(renameColumn(cols(), 'c1', 'To Do').ok).toBe(true);
  });

  it('accepts a CASE-ONLY change, which a naive check would reject', () => {
    const r = renameColumn(cols(), 'c1', 'TO DO');
    expect(r.ok).toBe(true);
    expect(r.ok && r.columns[0].name).toBe('TO DO');
  });

  it('still rejects colliding with a DIFFERENT column, case-insensitively', () => {
    for (const name of ['Done', 'done']) {
      const r = renameColumn(cols(), 'c1', name);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toBe('There is already a column with that name.');
    }
  });

  it('rejects an empty or whitespace-only name', () => {
    const r = renameColumn(cols(), 'c1', '   ');
    expect(!r.ok && r.error).toBe('Give the column a name.');
  });

  it('rejects an over-long name', () => {
    const r = renameColumn(cols(), 'c1', 'x'.repeat(COLUMN_NAME_MAX + 1));
    expect(!r.ok && r.error).toContain(`under ${COLUMN_NAME_MAX}`);
  });

  it('returns columns that survive columnsPatch with ids intact', () => {
    // Renaming must never desync columns from columnIds — rules validate card
    // writes against the flat mirror.
    const r = renameColumn(cols(), 'c2', 'Doing');
    expect(r.ok && columnsPatch(r.columns).columnIds).toEqual(['c1', 'c2', 'c3']);
  });

  it('is a no-op for an unknown column id', () => {
    const r = renameColumn(cols(), 'nope', 'Whatever');
    expect(r.ok && r.columns).toEqual(cols());
  });
});

describe('columnDeleteBlocked', () => {
  it('allows deleting an empty column', () => {
    expect(columnDeleteBlocked('To Do', 0)).toBeNull();
  });

  it('blocks a column that still holds cards, and says how many', () => {
    expect(columnDeleteBlocked('To Do', 3)).toContain('still has 3 cards');
  });

  it('singularises one card', () => {
    const msg = columnDeleteBlocked('To Do', 1)!;
    expect(msg).toContain('still has 1 card.');
    expect(msg).not.toContain('1 cards');
  });

  it('names the column so the message is actionable', () => {
    expect(columnDeleteBlocked('Waiting on donor', 2)).toContain('Waiting on donor');
  });
});

describe('label scopes', () => {
  const labels = [
    { id: 'i_b', name: 'Budget' },
    { id: 'own_z', name: 'Zebra', boardId: 'b1' },
    { id: 'i_a', name: 'Approved' },
    { id: 'own_a', name: 'Agenda', boardId: 'b1' },
    { id: 'other', name: 'Homework', boardId: 'b2' },
  ];

  it('offers a board the institute labels first, then its own, each sorted', () => {
    expect(labelsForBoard(labels, 'b1').map((l) => l.id)).toEqual(['i_a', 'i_b', 'own_a', 'own_z']);
  });

  it('never offers another board its neighbour’s labels', () => {
    expect(labelsForBoard(labels, 'b2').map((l) => l.id)).toEqual(['i_a', 'i_b', 'other']);
  });

  it('keeps institute labels on a cross-board move and leaves the board’s own behind', () => {
    expect(labelIdsAfterBoardChange(['i_a', 'own_a', 'i_b'], labels, 'b2')).toEqual(['i_a', 'i_b']);
  });

  it('keeps one of the destination’s own, and an id the list does not know', () => {
    // `new` may be a label created since a cached list was read: dropping it
    // would strip a real label off the card.
    expect(labelIdsAfterBoardChange(['other', 'new', 'i_a'], labels, 'b2')).toEqual(['other', 'new', 'i_a']);
  });

  it('writes boardId only on a board label', () => {
    expect(newLabel({ name: ' Venue ', color: '#83114F', createdBy: 'u', now: 1, boardId: 'b1' })).toEqual({
      boardId: 'b1', name: 'Venue', color: '#83114F', createdAt: 1, createdBy: 'u',
    });
    expect('boardId' in newLabel({ name: 'Finance', color: '#83114F', createdBy: 'u', now: 1, boardId: null })).toBe(false);
  });
});
