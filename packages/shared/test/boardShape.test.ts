import { describe, expect, it } from 'vitest';
import { cleanDetails, cleanFields, cleanLanes } from '../src';

describe('cleaning what a board holds', () => {
  it('keeps well-formed lanes and drops the rest', () => {
    expect(cleanLanes([null, 'x', { id: 'a' }, { id: 'c', name: '  ' }, { id: 'b', name: 'Planning', extra: 1 }, 7])).toEqual([
      { id: 'b', name: 'Planning', extra: 1 },
    ]);
    expect(cleanLanes({ id: 'a', name: 'x' })).toEqual([]);
  });

  it('keeps fields of a known type', () => {
    expect(
      cleanFields([{ id: 'f', name: 'Fee', type: 'number' }, { id: 'g', name: 'X', type: 'file' }, null]),
    ).toEqual([{ id: 'f', name: 'Fee', type: 'number' }]);
    // Kept as stored, so a property a later build adds survives a write.
    expect(cleanFields([{ id: 'f', name: 'Fee', type: 'number', hint: 'GBP' }])).toEqual([
      { id: 'f', name: 'Fee', type: 'number', hint: 'GBP' },
    ]);
  });

  it('keeps string values only', () => {
    expect(cleanDetails({ a: '1200', b: { x: 1 }, c: 5, d: null })).toEqual({ a: '1200' });
    expect(cleanDetails('nope')).toEqual({});
  });
});
