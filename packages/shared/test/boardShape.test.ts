import { describe, expect, it } from 'vitest';
import { boardExtras, cleanDetails, cleanFields, cleanLanes, overviewBoards, laneSignature } from '../src';

describe('cleaning what a board holds', () => {
  it('keeps well-formed lanes and drops the rest', () => {
    expect(cleanLanes([null, 'x', { id: 'a' }, { id: 'b', name: 'Planning', extra: 1 }, 7])).toEqual([
      { id: 'b', name: 'Planning' },
    ]);
    expect(cleanLanes({ id: 'a', name: 'x' })).toEqual([]);
  });

  it('keeps fields of a known type', () => {
    expect(
      cleanFields([{ id: 'f', name: 'Fee', type: 'number' }, { id: 'g', name: 'X', type: 'file' }, null]),
    ).toEqual([{ id: 'f', name: 'Fee', type: 'number' }]);
  });

  it('keeps string values only', () => {
    expect(cleanDetails({ a: '1200', b: { x: 1 }, c: 5, d: null })).toEqual({ a: '1200' });
    expect(cleanDetails('nope')).toEqual({});
  });

  it('lets a board with a malformed lane through every overview reader without a throw', () => {
    const data = { columns: [{ id: 'c' }], lanesOn: true, lanes: [null, { id: 'l', name: 'Planning' }], archived: false };
    const board = { ...data, ...boardExtras(data) };
    expect(overviewBoards([board])).toHaveLength(1);
    expect(laneSignature(board.lanes)).toBe('planning');
  });
});
