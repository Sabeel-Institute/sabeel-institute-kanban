import { describe, expect, it } from 'vitest';
import { SYSTEM_ACTOR } from '../src/activity';
import { boardClone, boardCloneBytes, utf8Length, type CloneSourceCard } from '../src/boardClone';

const columns = [
  { id: 'c_todo', name: 'To Do' },
  { id: 'c_done', name: 'Done' },
];
const labels = [
  { id: 'inst', boardId: undefined },
  { id: 'own', boardId: 'tmpl' },
  { id: 'other', boardId: 'elsewhere' },
];
const card = (over: Partial<CloneSourceCard> & { id: string }): CloneSourceCard => ({
  title: `Title ${over.id}`,
  description: `Body of ${over.id}`,
  columnId: 'c_todo',
  rank: 'm',
  labelIds: [],
  archived: false,
  ...over,
});

function clone(
  cards: CloneSourceCard[],
  subscribe = false,
  lanes: {
    lanesOn?: boolean;
    lanes?: { id: string; name: string }[];
    doneColumnId?: string;
    fields?: { id: string; name: string; type: 'text' | 'start' }[];
    details?: Record<string, string>;
  } = {},
) {
  let n = 0;
  return boardClone({
    source: { description: 'For every program', columns, ...lanes },
    cards,
    labels,
    boardId: 'clone',
    name: '  Spring Program  ',
    cloner: 'u_org',
    subscribe,
    copierProfile: { displayName: 'Org', email: 'org@example.com' },
    now: 1000,
    newCardId: () => `new${(n += 1)}`,
  });
}

describe('boardClone: the board', () => {
  const { board } = clone([]);

  it('is a new board with the cloner as its only member and owner', () => {
    expect(board.name).toBe('Spring Program');
    expect(board.memberUids).toEqual(['u_org']);
    expect(board.boardOwnerUids).toEqual(['u_org']);
    expect(board.memberProfiles).toEqual({ u_org: { displayName: 'Org', email: 'org@example.com' } });
    expect(board.createdBy).toBe('u_org');
    expect(board.createdAt).toBe(1000);
    expect(board.archived).toBe(false);
    expect(board.activeCardCount).toBe(0);
  });

  it('counts its own cards: the clone keeps its own books', () => {
    const { board: counted } = clone([card({ id: 'a' }), card({ id: 'b' }), card({ id: 'gone', archived: true })]);
    expect(counted.activeCardCount).toBe(2);
  });

  it('keeps the description and the columns in order, under new ids', () => {
    expect(board.description).toBe('For every program');
    expect(board.columns.map((c) => c.name)).toEqual(['To Do', 'Done']);
    expect(board.columnIds).toEqual(board.columns.map((c) => c.id));
    expect(board.columnIds).not.toContain('c_todo');
    expect(board.columnIds).not.toContain('c_done');
    expect(new Set(board.columnIds).size).toBe(2);
  });
});

describe('boardClone: the cards', () => {
  it('clones an open card with its title, description, column and rank, and nothing of one run', () => {
    const { board, cards } = clone([card({ id: 'a', columnId: 'c_done', rank: 'q' })]);
    expect(cards).toEqual([
      {
        id: 'new1',
        data: {
          boardId: 'clone',
          title: 'Title a',
          description: 'Body of a',
          columnId: board.columnIds[1],
          rank: 'q',
          assigneeUids: [],
          // The sheet's bell starts off.
          subscriberUids: [],
          priority: 'none',
          labelIds: [],
          archived: false,
          commentCount: 0,
          attachmentCount: 0,
          createdAt: 1000,
          createdBy: 'u_org',
          updatedAt: 1000,
          // Keeps the card triggers out: the clone writes the count, the history
          // and Stats itself.
          updatedBy: SYSTEM_ACTOR,
        },
        created: { type: 'created', actorUid: 'u_org', at: 1000 },
      },
    ]);
  });

  it('subscribes the cloner to every card when the bell is on, and only the cloner', () => {
    const { cards } = clone([card({ id: 'a' }), card({ id: 'b', columnId: 'c_done' })], true);
    expect(cards.map((c) => c.data.subscriberUids)).toEqual([['u_org'], ['u_org']]);
  });

  it('leaves archived cards behind', () => {
    const { cards } = clone([card({ id: 'a' }), card({ id: 'gone', archived: true })]);
    expect(cards.map((c) => c.data.title)).toEqual(['Title a']);
  });

  it('keeps institute labels only, dropping the template’s own, another board’s and a deleted one', () => {
    const { cards } = clone([card({ id: 'a', labelIds: ['own', 'inst', 'other', 'deleted'] })]);
    expect(cards[0]!.data.labelIds).toEqual(['inst']);
  });

  it('links each subtask to its parent’s clone, at any depth', () => {
    const { cards } = clone([
      card({ id: 'p' }),
      card({ id: 'child', parentId: 'p' }),
      card({ id: 'grandchild', parentId: 'child' }),
    ]);
    const byTitle = new Map(cards.map((c) => [c.data.title, c]));
    expect(byTitle.get('Title child')!.data.parentId).toBe(byTitle.get('Title p')!.id);
    expect(byTitle.get('Title grandchild')!.data.parentId).toBe(byTitle.get('Title child')!.id);
    expect('parentId' in byTitle.get('Title p')!.data).toBe(false);
  });

  it('makes a subtask of an archived parent an ordinary card', () => {
    const { cards } = clone([
      card({ id: 'p', archived: true }),
      card({ id: 'child', parentId: 'p' }),
    ]);
    expect(cards).toHaveLength(1);
    expect('parentId' in cards[0]!.data).toBe(false);
  });

  it('puts a card whose column has gone in the first column', () => {
    const { board, cards } = clone([card({ id: 'a', columnId: 'c_deleted' })]);
    expect(cards[0]!.data.columnId).toBe(board.columnIds[0]);
  });

  it('never carries a due date, assignee or priority across', () => {
    // The source type cannot even hold them; a source spread in by mistake
    // would bring them, so prove the output has none whatever came in.
    const source = {
      ...card({ id: 'a' }),
      dueDate: '2026-12-01',
      assigneeUids: ['u_x'],
      priority: 'urgent',
      commentCount: 4,
    } as CloneSourceCard;
    const { data } = clone([source]).cards[0]!;
    expect(data.dueDate).toBeUndefined();
    expect(data.assigneeUids).toEqual([]);
    expect(data.priority).toBe('none');
    expect(data.commentCount).toBe(0);
  });
});

describe('boardClone: lanes', () => {
  const lanes = [
    { id: 'ln_plan', name: 'Planning' },
    { id: 'ln_mkt', name: 'Marketing' },
  ];
  const onLanes = { lanesOn: true, lanes, doneColumnId: 'c_done' };

  it('carries lanes switched on, in order, under new ids, with the finished column mapped', () => {
    // A finished column that is NOT the last, so a clone that dropped it and
    // fell back to the last column would not pass.
    const { board } = clone([], false, { ...onLanes, doneColumnId: 'c_todo' });
    expect(board.lanesOn).toBe(true);
    expect(board.lanes!.map((l) => l.name)).toEqual(['Planning', 'Marketing']);
    expect(board.lanes!.map((l) => l.id)).not.toContain('ln_plan');
    expect(board.doneColumnId).toBe(board.columns[0].id);
  });

  it('puts each card in its lane on the clone', () => {
    const { board, cards } = clone([card({ id: 'a', laneId: 'ln_mkt' })], false, onLanes);
    expect(cards[0].data.laneId).toBe(board.lanes![1].id);
  });

  it('clones a card whose lane is gone, or that has none, with no lane', () => {
    const { cards } = clone(
      [card({ id: 'a', laneId: 'ln_gone' }), card({ id: 'b' })],
      false,
      onLanes,
    );
    expect(cards.map((c) => 'laneId' in c.data)).toEqual([false, false]);
  });

  it('keeps lanes switched off as they were, lanes and all', () => {
    const { board, cards } = clone([card({ id: 'a', laneId: 'ln_plan' })], false, {
      ...onLanes,
      lanesOn: false,
    });
    expect(board.lanesOn).toBeUndefined();
    expect(board.lanes!.map((l) => l.name)).toEqual(['Planning', 'Marketing']);
    expect(cards[0].data.laneId).toBe(board.lanes![0].id);
  });

  it('leaves a finished column that is gone on the source unset', () => {
    expect(clone([], false, { ...onLanes, doneColumnId: 'c_gone' }).board.doneColumnId).toBeUndefined();
  });

  it('never marks a clone as a template, though the callable passes the marked source whole', () => {
    // `cloneBoard` hands the source BoardDoc over as it is, mark and all.
    expect('template' in clone([], false, { template: true } as never).board).toBe(false);
  });

  it('gives a board without lanes none of the lane fields', () => {
    const { board, cards } = clone([card({ id: 'a' })]);
    expect(['lanesOn', 'lanes', 'doneColumnId'].filter((k) => k in board)).toEqual([]);
    expect('laneId' in cards[0].data).toBe(false);
  });
});

describe('boardClone: details', () => {
  it('carries the fields under new ids, and none of their values', () => {
    const fields = [
      { id: 'f1', name: 'Teachers', type: 'text' as const },
      { id: 'f2', name: 'Start date', type: 'start' as const },
    ];
    // Values in the source, so leaving them behind is something the clone does.
    const { board } = clone([], false, { fields, details: { f1: 'Sara', f2: '2027-06-01' } });
    expect(board.fields!.map((f) => [f.name, f.type])).toEqual([
      ['Teachers', 'text'],
      ['Start date', 'start'],
    ]);
    expect(board.fields!.map((f) => f.id)).not.toContain('f1');
    expect('details' in board).toBe(false);
  });

  it('gives a board without details none', () => {
    expect('fields' in clone([]).board).toBe(false);
  });
});

describe('boardCloneBytes', () => {
  it('counts UTF-8 bytes, which is what Firestore limits', () => {
    expect(utf8Length('a')).toBe(1);
    expect(utf8Length('ب')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
  });

  it('grows with the bytes in the descriptions, not their characters', () => {
    const plain = boardCloneBytes(clone([card({ id: 'a', description: 'x'.repeat(1000) })]));
    const euros = boardCloneBytes(clone([card({ id: 'a', description: '€'.repeat(1000) })]));
    expect(euros - plain).toBe(2000);
  });
});
