import { describe, expect, it } from 'vitest';
import {
  finishBlockedMessage,
  finishBlockers,
  finishRefusal,
  reopenBlockedMessage,
  reopenBlockers,
  reopenCandidates,
  type FinishCard,
  type ParentState,
} from '../src/subtaskFinish';

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

  it('does not refuse a parent already finished: a reorder or a lane change within the column', () => {
    const doneParent = card('parent', { columnId: 'done' });
    expect(blockers([doneParent], [doneParent, openA])).toEqual([]);
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

describe('reopenBlockers', () => {
  const doneParent: ParentState = { id: 'parent', title: 'parent', columnId: 'done' };
  const openParent: ParentState = { id: 'parent', title: 'parent', columnId: 'doing' };
  const shelved: ParentState = { id: 'parent', title: 'parent', columnId: 'doing', archived: true };
  const sub = card('s', { parentId: 'parent', columnId: 'done' });
  const reopen = (moving: FinishCard[], parent: ParentState | undefined, to = 'doing', b = board) =>
    reopenBlockers({ board: b, toColumnId: to, moving, parentOf: () => parent }).map((r) => [r.card.id, r.why]);

  it('keeps a finished subtask finished while its parent is finished or archived', () => {
    expect(reopen([sub], doneParent)).toEqual([['s', 'finished']]);
    expect(reopen([sub], shelved)).toEqual([['s', 'archived']]);
  });

  it('counts restoring an archived subtask to an open column as reopening', () => {
    const archivedSub = card('s', { parentId: 'parent', columnId: 'todo', archived: true });
    expect(reopen([archivedSub], doneParent, 'todo')).toEqual([['s', 'finished']]);
    expect(reopen([archivedSub], doneParent, 'done')).toEqual([]);
  });

  it('lets it reopen under an open parent, a gone one, or a parent moving with it', () => {
    expect(reopen([sub], openParent)).toEqual([]);
    expect(reopen([sub], undefined)).toEqual([]);
    expect(reopen([sub, card('parent', { columnId: 'done' })], doneParent)).toEqual([]);
  });

  it('is not reopening to move an open subtask, or to stay in the finished column', () => {
    expect(reopen([card('s', { parentId: 'parent', columnId: 'todo' })], doneParent)).toEqual([]);
    expect(reopen([sub], doneParent, 'done')).toEqual([]);
  });

  it('holds nothing on a board without lanes', () => {
    expect(reopen([sub], doneParent, 'doing', { ...board, lanesOn: false })).toEqual([]);
  });

  it('says what to do instead', () => {
    const msg = reopenBlockedMessage(
      reopenBlockers({ board, toColumnId: 'doing', moving: [sub], parentOf: () => doneParent }),
    );
    expect(msg).toBe(
      '“s” is a subtask of “parent”, which is finished. To reopen it, first unlink it from its parent: open “s” and tap “Unlink from parent card”.',
    );
  });
});

describe('reopenCandidates', () => {
  it('names only subtasks being reopened on a board with lanes, so ordinary moves look nothing up', () => {
    const finishedSub = card('s', { parentId: 'parent', columnId: 'done' });
    const openSub = card('o', { parentId: 'parent' });
    const archivedSub = card('x', { parentId: 'parent', archived: true });
    const lone = card('l', { columnId: 'done' });
    const ids = (to: string, b = board) =>
      reopenCandidates({ board: b, toColumnId: to, moving: [finishedSub, openSub, archivedSub, lone] }).map((c) => c.id);
    expect(ids('doing')).toEqual(['s', 'x']);
    expect(ids('done')).toEqual([]);
    expect(ids('doing', { ...board, lanesOn: false })).toEqual([]);
  });
});

describe('reopenBlockedMessage under an archived parent', () => {
  it('offers restoring the parent first', () => {
    const sub = card('s', { parentId: 'parent', columnId: 'done' });
    const msg = reopenBlockedMessage(
      reopenBlockers({
        board,
        toColumnId: 'doing',
        moving: [sub],
        parentOf: () => ({ id: 'parent', title: 'parent', columnId: 'done', archived: true }),
      }),
    );
    expect(msg).toBe(
      '“s” is a subtask of “parent”, which is archived. Restore “parent” first, or to reopen “s” on its own, unlink it from its parent: open “s” and tap “Unlink from parent card”.',
    );
  });
});
