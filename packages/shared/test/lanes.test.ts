import { describe, expect, it } from 'vitest';
import {
  LANES_MAX,
  LANE_NAME_MAX,
  addDays,
  cardsInLane,
  describeLane,
  finishedColumnChoice,
  finishedColumnId,
  groupByLane,
  isFinished,
  laneAddBlocked,
  laneBadge,
  laneDeleteBlocked,
  laneInfo,
  laneOf,
  lanesLive,
  lanesSwitchPatch,
  renameLane,
  validateLaneName,
  type LaneBoard,
  type LaneCard,
} from '../src';

const TODAY = '2026-11-15';
const columns = [{ id: 'todo' }, { id: 'doing' }, { id: 'done' }];
const lanes = [
  { id: 'plan', name: 'Planning' },
  { id: 'mkt', name: 'Marketing' },
];
const board: LaneBoard = { columns, lanesOn: true, lanes, doneColumnId: 'done' };
const card = (over: Partial<LaneCard> = {}): LaneCard => ({ columnId: 'todo', ...over });

describe('lanesLive', () => {
  it('needs the switch on and a lane', () => {
    expect(lanesLive(board)).toBe(true);
    expect(lanesLive({ ...board, lanesOn: false })).toBe(false);
    expect(lanesLive({ ...board, lanes: [] })).toBe(false);
    expect(lanesLive({ columns })).toBe(false);
  });
});

describe('finishedColumnId', () => {
  it('is the stored column while it exists', () => {
    expect(finishedColumnId(board)).toBe('done');
    expect(finishedColumnId({ ...board, doneColumnId: 'doing' })).toBe('doing');
  });

  it('falls back to the last column when the stored one is gone, or none is stored', () => {
    expect(finishedColumnId({ ...board, doneColumnId: 'deleted' })).toBe('done');
    expect(finishedColumnId({ ...board, doneColumnId: undefined })).toBe('done');
  });

  it('is null on a board without live lanes, which has no finish', () => {
    expect(finishedColumnId({ ...board, lanesOn: false })).toBeNull();
    expect(finishedColumnId({ ...board, lanes: [] })).toBeNull();
    expect(finishedColumnId({ columns })).toBeNull();
  });

  it('is still chosen while lanes are not live, for the Lanes page to show', () => {
    expect(finishedColumnChoice({ ...board, lanesOn: false })).toBe('done');
    expect(finishedColumnChoice({ columns, doneColumnId: 'doing' })).toBe('doing');
    expect(finishedColumnChoice({ columns, doneColumnId: 'gone' })).toBe('done');
    expect(finishedColumnChoice({ columns: [] })).toBeNull();
  });

  it('is null on a board with no columns', () => {
    expect(finishedColumnId({ ...board, columns: [], doneColumnId: undefined })).toBeNull();
  });
});

describe('isFinished', () => {
  it('is a card in the finished column of a board with lanes', () => {
    expect(isFinished(card({ columnId: 'done' }), board)).toBe(true);
    expect(isFinished(card({ columnId: 'doing' }), board)).toBe(false);
  });

  it('is never true on a board without lanes', () => {
    expect(isFinished(card({ columnId: 'done' }), { columns })).toBe(false);
    expect(isFinished(card({ columnId: 'done' }), { ...board, lanesOn: false })).toBe(false);
  });
});

describe('laneOf', () => {
  it('is the lane when it exists', () => {
    expect(laneOf(card({ laneId: 'mkt' }), board)).toBe('mkt');
  });

  it('is No lane for no lane, a lane that is gone, or lanes not live', () => {
    expect(laneOf(card(), board)).toBeNull();
    expect(laneOf(card({ laneId: 'gone' }), board)).toBeNull();
    expect(laneOf(card({ laneId: 'mkt' }), { ...board, lanesOn: false })).toBeNull();
  });
});

describe('groupByLane', () => {
  const a = card({ laneId: 'mkt' });
  const b = card({ laneId: 'plan' });
  const c = card({ laneId: 'mkt' });

  it('places the column in lane order and keeps every lane, holding cards or not', () => {
    const groups = groupByLane([a, c], board, [a, c]);
    expect(groups.map((g) => g.lane?.id ?? null)).toEqual(['plan', 'mkt']);
    expect(groups[0].cards).toEqual([]);
    expect(groups[1].cards).toEqual([a, c]);
  });

  it('keeps the column order within a lane', () => {
    expect(groupByLane([c, b, a], board, [a, b, c])[1].cards).toEqual([c, a]);
  });

  it('puts a stale lane id under No lane, last', () => {
    const stale = card({ laneId: 'gone' });
    const groups = groupByLane([stale, b], board, [stale, b]);
    expect(groups.map((g) => g.lane?.id ?? null)).toEqual(['plan', 'mkt', null]);
    expect(groups[2].cards).toEqual([stale]);
  });

  it('draws No lane in every column once any card on the board has none', () => {
    const elsewhere = card({ columnId: 'done' });
    const groups = groupByLane([b], board, [b, elsewhere]);
    expect(groups[groups.length - 1]).toEqual({ lane: null, cards: [] });
  });

  it('leaves No lane out when every card has a lane', () => {
    expect(groupByLane([b], board, [b, a]).some((g) => g.lane === null)).toBe(false);
  });
});

describe('laneInfo', () => {
  const info = (cards: LaneCard[], laneId: string | null = 'mkt') =>
    laneInfo(cards, board, laneId, TODAY);
  const inMkt = (over: Partial<LaneCard>) => card({ laneId: 'mkt', ...over });

  it('is none for a lane with no cards', () => {
    expect(info([])).toEqual({ total: 0, done: 0, status: 'none' });
  });

  it('is complete when every card is in the finished column', () => {
    expect(info([inMkt({ columnId: 'done' }), inMkt({ columnId: 'done' })])).toEqual({
      total: 2,
      done: 2,
      status: 'complete',
    });
  });

  it('is late when an unfinished card is past its date', () => {
    const s = info([inMkt({ dueDate: addDays(TODAY, -1) }), inMkt({ dueDate: TODAY })]);
    expect(s.status).toBe('late');
  });

  it('is not late for a finished card past its date', () => {
    const s = info([inMkt({ columnId: 'done', dueDate: addDays(TODAY, -9) }), inMkt({})]);
    expect(s).toEqual({ total: 2, done: 1, status: 'undated' });
  });

  it('is soon for an unfinished card due today or within seven days', () => {
    expect(info([inMkt({ dueDate: TODAY })]).status).toBe('soon');
    expect(info([inMkt({ dueDate: addDays(TODAY, 7) })]).status).toBe('soon');
  });

  it('is undated when no unfinished card has a date', () => {
    expect(info([inMkt({}), inMkt({ columnId: 'doing' })]).status).toBe('undated');
  });

  it('is open when the dates are further off', () => {
    expect(info([inMkt({ dueDate: addDays(TODAY, 8) }), inMkt({})]).status).toBe('open');
  });

  it('counts every column, and leaves out other lanes and archived cards', () => {
    const s = info([
      inMkt({ columnId: 'todo' }),
      inMkt({ columnId: 'doing' }),
      inMkt({ columnId: 'done' }),
      inMkt({ archived: true }),
      card({ laneId: 'plan' }),
    ]);
    expect(s).toEqual({ total: 3, done: 1, status: 'undated' });
  });

  it('counts No lane, stale lane ids included', () => {
    const s = info([card({}), card({ laneId: 'gone' }), inMkt({})], null);
    expect(s.total).toBe(2);
  });
});

describe('the badge and its words', () => {
  it('says finished of total, or No cards', () => {
    expect(laneBadge({ total: 4, done: 2, status: 'open' })).toBe('2 of 4');
    expect(laneBadge({ total: 0, done: 0, status: 'none' })).toBe('No cards');
  });

  it('puts what the colour shows into words', () => {
    expect(describeLane('Marketing', { total: 4, done: 2, status: 'late' })).toBe(
      'Marketing, 2 of 4 finished, a card is late',
    );
    expect(describeLane('Marketing', { total: 4, done: 2, status: 'soon' })).toBe(
      'Marketing, 2 of 4 finished',
    );
    expect(describeLane('Marketing', { total: 3, done: 3, status: 'complete' })).toBe(
      'Marketing, all 3 finished',
    );
    expect(describeLane('Marketing', { total: 0, done: 0, status: 'none' })).toBe(
      'Marketing, no cards',
    );
  });
});

describe('naming and removing lanes', () => {
  it('validates a name like a column’s', () => {
    expect(validateLaneName('  ', lanes)).toBe('Give the lane a name.');
    expect(validateLaneName('x'.repeat(LANE_NAME_MAX + 1), lanes)).toMatch(/under 40/);
    expect(validateLaneName('marketing', lanes)).toBe('There is already a lane with that name.');
    expect(validateLaneName('Supplies', lanes)).toBeNull();
  });

  it('renames a lane, allowing a change of capitals to itself', () => {
    const r = renameLane(lanes, 'mkt', ' MARKETING ');
    expect(r).toEqual({ ok: true, lanes: [lanes[0], { id: 'mkt', name: 'MARKETING' }] });
    expect(renameLane(lanes, 'mkt', 'planning')).toEqual({
      ok: false,
      error: 'There is already a lane with that name.',
    });
  });

  it('refuses a lane past the most a board may have', () => {
    const full = Array.from({ length: LANES_MAX }, (_, i) => ({ id: `l${i}`, name: `L${i}` }));
    expect(laneAddBlocked(full.slice(1))).toBeNull();
    expect(laneAddBlocked(full)).toBe('A board can have at most 12 lanes.');
  });

  it('counts the open cards naming a lane, switched on or not', () => {
    const cards = [card({ laneId: 'mkt' }), card({ laneId: 'mkt', archived: true }), card({})];
    expect(cardsInLane(cards, 'mkt')).toBe(1);
  });

  it('removes a lane only once it is empty', () => {
    expect(laneDeleteBlocked('Marketing', 0)).toBeNull();
    expect(laneDeleteBlocked('Marketing', 1)).toBe(
      '“Marketing” still has 1 card. Move them to another lane, or archive them, first.',
    );
    expect(laneDeleteBlocked('Marketing', 3)).toMatch(/still has 3 cards/);
  });
});

describe('lanesSwitchPatch', () => {
  it('sets the finished column to the last column the first time lanes go on', () => {
    expect(lanesSwitchPatch({ columns }, true)).toEqual({ lanesOn: true, doneColumnId: 'done' });
  });

  it('keeps a finished column already chosen', () => {
    expect(lanesSwitchPatch({ columns, doneColumnId: 'doing' }, true)).toEqual({ lanesOn: true });
  });

  it('turns them off and keeps everything else', () => {
    expect(lanesSwitchPatch(board, false)).toEqual({ lanesOn: false });
  });

  it('writes no finished column on a board with no columns', () => {
    expect(lanesSwitchPatch({ columns: [] }, true)).toEqual({ lanesOn: true });
  });
});
