import { describe, expect, it } from 'vitest';
import { boardCopy, type CopySourceCard } from '../src/boardCopy';

const columns = [
  { id: 'c_todo', name: 'To Do' },
  { id: 'c_done', name: 'Done' },
];
const labels = [
  { id: 'inst', boardId: undefined },
  { id: 'own', boardId: 'tmpl' },
  { id: 'other', boardId: 'elsewhere' },
];
const card = (over: Partial<CopySourceCard> & { id: string }): CopySourceCard => ({
  title: `Title ${over.id}`,
  description: `Body of ${over.id}`,
  columnId: 'c_todo',
  rank: 'm',
  labelIds: [],
  archived: false,
  ...over,
});

function copy(cards: CopySourceCard[]) {
  let n = 0;
  return boardCopy({
    source: { description: 'For every program', columns },
    cards,
    labels,
    boardId: 'copy',
    name: '  Spring Program  ',
    copier: 'u_org',
    copierProfile: { displayName: 'Org', email: 'org@example.com' },
    now: 1000,
    newCardId: () => `new${(n += 1)}`,
  });
}

describe('boardCopy: the board', () => {
  const { board } = copy([]);

  it('is a new board with the copier as its only member and owner', () => {
    expect(board.name).toBe('Spring Program');
    expect(board.memberUids).toEqual(['u_org']);
    expect(board.boardOwnerUids).toEqual(['u_org']);
    expect(board.memberProfiles).toEqual({ u_org: { displayName: 'Org', email: 'org@example.com' } });
    expect(board.createdBy).toBe('u_org');
    expect(board.createdAt).toBe(1000);
    expect(board.archived).toBe(false);
    expect(board.activeCardCount).toBe(0);
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

describe('boardCopy: the cards', () => {
  it('copies an open card with its title, description, column and rank, and nothing of one run', () => {
    const { board, cards } = copy([card({ id: 'a', columnId: 'c_done', rank: 'q' })]);
    expect(cards).toEqual([
      {
        id: 'new1',
        data: {
          boardId: 'copy',
          title: 'Title a',
          description: 'Body of a',
          columnId: board.columnIds[1],
          rank: 'q',
          assigneeUids: [],
          subscriberUids: ['u_org'],
          priority: 'none',
          labelIds: [],
          archived: false,
          commentCount: 0,
          attachmentCount: 0,
          createdAt: 1000,
          createdBy: 'u_org',
          updatedAt: 1000,
          updatedBy: 'u_org',
        },
      },
    ]);
  });

  it('leaves archived cards behind', () => {
    const { cards } = copy([card({ id: 'a' }), card({ id: 'gone', archived: true })]);
    expect(cards.map((c) => c.data.title)).toEqual(['Title a']);
  });

  it('keeps institute labels only, dropping the template’s own, another board’s and a deleted one', () => {
    const { cards } = copy([card({ id: 'a', labelIds: ['own', 'inst', 'other', 'deleted'] })]);
    expect(cards[0]!.data.labelIds).toEqual(['inst']);
  });

  it('links each subtask to its parent’s copy, at any depth', () => {
    const { cards } = copy([
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
    const { cards } = copy([
      card({ id: 'p', archived: true }),
      card({ id: 'child', parentId: 'p' }),
    ]);
    expect(cards).toHaveLength(1);
    expect('parentId' in cards[0]!.data).toBe(false);
  });

  it('puts a card whose column has gone in the first column', () => {
    const { board, cards } = copy([card({ id: 'a', columnId: 'c_deleted' })]);
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
    } as CopySourceCard;
    const { data } = copy([source]).cards[0]!;
    expect(data.dueDate).toBeUndefined();
    expect(data.assigneeUids).toEqual([]);
    expect(data.priority).toBe('none');
    expect(data.commentCount).toBe(0);
  });
});
