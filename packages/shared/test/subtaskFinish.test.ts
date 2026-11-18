import { describe, expect, it } from 'vitest';
import { finishBlockedMessage, finishBlockers, finishRefusal, type FinishCard } from '../src/subtaskFinish';

const columns = [{ id: 'todo' }, { id: 'doing' }, { id: 'done' }];
const lanes = [{ id: 'ln-a', name: 'Planning' }];
const board = { columns, lanesOn: true, lanes, doneColumnId: 'done' };

const card = (id: string, over: Partial<FinishCard> = {}): FinishCard => ({
  id,
  title: id,
  columnId: 'todo',
  laneId: 'ln-a',
  ...over,
});

const parent = card('parent', { columnId: 'doing' });
const openA = card('a', { parentId: 'parent' });
const openB = card('b', { parentId: 'parent', columnId: 'doing' });
const finished = card('f', { parentId: 'parent', columnId: 'done' });
const archived = card('x', { parentId: 'parent', archived: true });
const other = card('other');

const blockers = (moving: FinishCard[], cards: FinishCard[], toColumnId = 'done', b = board) =>
  finishBlockers({ board: b, toColumnId, moving, cards });

describe('finishBlockers', () => {
  it('holds a parent out of the finished column while a subtask is open', () => {
    const got = blockers([parent], [parent, openA, openB, finished, archived, other]);
    expect(got.map((b) => [b.parent.id, b.open.map((c) => c.id)])).toEqual([['parent', ['a', 'b']]]);
  });

  it('lets it go once every subtask is finished or archived', () => {
    expect(blockers([parent], [parent, finished, archived, other])).toEqual([]);
  });

  it('counts subtasks moving into the finished column with it as finishing too', () => {
    expect(blockers([parent, openA, openB], [parent, openA, openB, other])).toEqual([]);
    const got = blockers([parent, openA], [parent, openA, openB]);
    expect(got[0].open.map((c) => c.id)).toEqual(['b']);
  });

  it('refuses nothing on the way to any other column', () => {
    expect(blockers([parent], [parent, openA], 'doing')).toEqual([]);
  });

  it('refuses nothing on a board without lanes, which has no finished column', () => {
    expect(blockers([parent], [parent, openA], 'done', { ...board, lanesOn: false })).toEqual([]);
  });

  it('follows the finished column the board names, not the last one', () => {
    const middle = { ...board, doneColumnId: 'doing' };
    expect(blockers([card('parent')], [card('parent'), openA], 'doing', middle)).toHaveLength(1);
    expect(blockers([card('parent')], [card('parent'), openA], 'done', middle)).toEqual([]);
  });
});

describe('finishBlockedMessage', () => {
  it('names the card, its open subtasks and what to do', () => {
    const msg = finishBlockedMessage(blockers([parent], [parent, openA, openB]), 'Done');
    expect(msg).toBe('“parent” can’t go to Done while 2 of its subtasks are still open: “a”, “b”. Finish them first.');
    const one = finishBlockedMessage(blockers([parent], [parent, openA]), 'Done');
    expect(one).toBe('“parent” can’t go to Done while its subtask is still open: “a”. Finish it first.');
  });

  it('names every held-back card when several are moved', () => {
    const p2 = card('p2');
    const msg = finishBlockedMessage(
      blockers([parent, p2], [parent, p2, openA, card('c', { parentId: 'p2' })]),
      'Done',
    );
    expect(msg).toBe('2 cards can’t go to Done while they have open subtasks: “parent”, “p2”. Finish their subtasks first.');
  });
});

describe('finishRefusal', () => {
  const named = { ...board, columns: [{ id: 'todo', name: 'To Do' }, { id: 'doing', name: 'Doing' }, { id: 'done', name: 'Wrapped' }] };
  it('says the refusal with the column’s own name, or nothing', () => {
    expect(finishRefusal({ board: named, toColumnId: 'done', moving: [parent], cards: [parent, openA] })).toBe(
      '“parent” can’t go to Wrapped while its subtask is still open: “a”. Finish it first.',
    );
    expect(finishRefusal({ board: named, toColumnId: 'doing', moving: [parent], cards: [parent, openA] })).toBeNull();
  });
});
