import { describe, expect, it } from 'vitest';
import {
  OVERVIEW_HIDDEN_MAX,
  boardOverdueDays,
  describeMark,
  groupOverview,
  laneSignature,
  nextHidden,
  overviewBoards,
  sortOverview,
  type OverviewRow,
} from '../src/overview';
import { boardExtras } from '../src/boardShape';

const columns = [{ id: 'todo' }, { id: 'done' }];
const lanes = [{ id: 'l1', name: 'Planning' }];

describe('overviewBoards', () => {
  const b = (over: object) => ({ id: 'x', columns, lanesOn: true, lanes, archived: false, ...over });

  it('lists a board with live lanes', () => {
    expect(overviewBoards([b({})])).toHaveLength(1);
  });

  it('leaves out a board without live lanes, a template, and an archived board', () => {
    expect(
      overviewBoards([
        b({ lanesOn: false }),
        b({ lanes: [] }),
        b({ template: true }),
        b({ archived: true }),
      ]),
    ).toEqual([]);
  });
});

describe('laneSignature', () => {
  it('matches the same names in the same order, whatever the capitals or spaces', () => {
    expect(laneSignature([{ name: 'Planning ' }, { name: 'marketing' }])).toBe(
      laneSignature([{ name: 'planning' }, { name: 'Marketing' }]),
    );
  });

  it('tells a different order or a renamed lane apart', () => {
    const base = laneSignature([{ name: 'A' }, { name: 'B' }]);
    expect(laneSignature([{ name: 'B' }, { name: 'A' }])).not.toBe(base);
    expect(laneSignature([{ name: 'A' }, { name: 'C' }])).not.toBe(base);
    expect(laneSignature([{ name: 'A' }])).not.toBe(base);
  });
});

describe('boardOverdueDays', () => {
  const board = { columns, lanesOn: true, lanes, doneColumnId: 'done' };
  const today = '2026-11-15';

  it('is the days late of the most overdue unfinished card', () => {
    expect(
      boardOverdueDays(
        [
          { columnId: 'todo', laneId: 'l1', dueDate: '2026-11-10' },
          { columnId: 'todo', laneId: 'l1', dueDate: '2026-11-01' },
          { columnId: 'todo', laneId: 'l1', dueDate: '2026-11-20' },
        ],
        board,
        today,
      ),
    ).toBe(14);
  });

  it('leaves out finished and archived cards, and is 0 when nothing is late', () => {
    expect(
      boardOverdueDays(
        [
          { columnId: 'done', laneId: 'l1', dueDate: '2026-10-01' },
          { columnId: 'todo', laneId: 'l1', dueDate: '2026-10-01', archived: true },
          { columnId: 'todo', laneId: 'l1', dueDate: today },
          { columnId: 'todo', laneId: 'l1' },
        ],
        board,
        today,
      ),
    ).toBe(0);
  });

  it('counts only cards in a lane, the cards the row has marks for', () => {
    expect(
      boardOverdueDays(
        [
          { columnId: 'todo', dueDate: '2026-01-01' },
          { columnId: 'todo', laneId: 'gone', dueDate: '2026-01-01' },
          { columnId: 'todo', laneId: 'l1', dueDate: '2026-11-14' },
        ],
        board,
        today,
      ),
    ).toBe(1);
  });
});

const row = (id: string, over: Partial<OverviewRow> = {}): OverviewRow => ({
  id,
  name: id,
  createdAt: 0,
  start: null,
  overdueDays: 0,
  laneNames: ['Planning'],
  ...over,
});
const ids = (rows: OverviewRow[]) => rows.map((r) => r.id);

describe('sortOverview', () => {
  const rows = [
    row('b', { start: '2027-07-01', createdAt: 2, overdueDays: 3 }),
    row('none', { start: null, createdAt: 1, overdueDays: 9 }),
    row('a', { start: '2027-06-01', createdAt: 3, overdueDays: 0 }),
  ];

  it('runs start date earliest first, and puts a board with none last', () => {
    expect(ids(sortOverview(rows, 'start', false))).toEqual(['a', 'b', 'none']);
  });

  it('keeps a board with no start date last when the order is reversed', () => {
    expect(ids(sortOverview(rows, 'start', true))).toEqual(['b', 'a', 'none']);
  });

  it('runs date created oldest first, and newest first reversed', () => {
    expect(ids(sortOverview(rows, 'created', false))).toEqual(['none', 'b', 'a']);
    expect(ids(sortOverview(rows, 'created', true))).toEqual(['a', 'b', 'none']);
  });

  it('runs most overdue first, and least first reversed', () => {
    expect(ids(sortOverview(rows, 'late', false))).toEqual(['none', 'b', 'a']);
    expect(ids(sortOverview(rows, 'late', true))).toEqual(['a', 'b', 'none']);
  });

  it('puts a board whose lateness is not known yet last, either way', () => {
    const rs = [row('slow', { overdueDays: null }), row('late', { overdueDays: 5 }), row('fine', { overdueDays: 0 })];
    expect(ids(sortOverview(rs, 'late', false))).toEqual(['late', 'fine', 'slow']);
    expect(ids(sortOverview(rs, 'late', true))).toEqual(['fine', 'late', 'slow']);
  });

  it('breaks ties on the name', () => {
    const tied = [row('Zeta', { start: '2027-06-01' }), row('Alpha', { start: '2027-06-01' })];
    expect(ids(sortOverview(tied, 'start', false))).toEqual(['Alpha', 'Zeta']);
    expect(ids(sortOverview([row('Zeta'), row('Alpha')], 'late', false))).toEqual(['Alpha', 'Zeta']);
  });
});

describe('groupOverview', () => {
  it('puts boards with the same lanes together, the group of the first row first', () => {
    const sorted = [
      row('a', { laneNames: ['Planning', 'Supplies'] }),
      row('b', { laneNames: ['Prep'] }),
      row('c', { laneNames: ['planning', 'Supplies'] }),
    ];
    const groups = groupOverview(sorted);
    expect(groups.map((g) => g.laneNames)).toEqual([['Planning', 'Supplies'], ['Prep']]);
    expect(groups.map((g) => ids(g.rows))).toEqual([['a', 'c'], ['b']]);
  });
});

describe('nextHidden', () => {
  it('hides and shows a board', () => {
    expect(nextHidden([], 'a', true)).toEqual(['a']);
    expect(nextHidden(['a', 'b'], 'a', false)).toEqual(['b']);
  });

  it('keeps boards not listed now, so one archived and restored stays hidden', () => {
    expect(nextHidden(['archived', 'a'], 'b', true)).toEqual(['archived', 'a', 'b']);
  });

  it('never holds more than the most a person may hide', () => {
    const many = Array.from({ length: OVERVIEW_HIDDEN_MAX }, (_, i) => `b${i}`);
    const next = nextHidden(many, 'new', true);
    expect(next).toHaveLength(OVERVIEW_HIDDEN_MAX);
    expect(next[next.length - 1]).toBe('new');
  });
});

describe('describeMark', () => {
  it('says the state in words, then the count', () => {
    expect(describeMark('Marketing', { total: 4, done: 2, status: 'late' })).toBe(
      'Marketing, a card is late, 2 of 4 finished',
    );
    expect(describeMark('Supplies', { total: 3, done: 0, status: 'undated' })).toBe(
      'Supplies, no due dates, 0 of 3 finished',
    );
    expect(describeMark('Wrap-up', { total: 0, done: 0, status: 'none' })).toBe('Wrap-up, no cards');
    expect(describeMark('Planning', { total: 3, done: 3, status: 'complete' })).toBe('Planning, all finished');
  });
});

describe('a board with a malformed lane, as read', () => {
  it('goes through every overview reader without a throw', () => {
    const data = { columns: [{ id: 'c' }], lanesOn: true, lanes: [null, { id: 'l', name: 'Planning' }], archived: false };
    const board = { ...data, ...boardExtras(data) };
    expect(overviewBoards([board])).toHaveLength(1);
    expect(laneSignature(board.lanes)).toBe('planning');
  });
});
