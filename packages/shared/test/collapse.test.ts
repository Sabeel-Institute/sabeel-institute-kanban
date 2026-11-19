import { describe, expect, it } from 'vitest';
import { collapsedPrefs, laneKey, NO_LANE_KEY } from '../src/collapse';

describe('collapsedPrefs', () => {
  it('reads nothing collapsed from a document without the fields', () => {
    expect(collapsedPrefs(undefined)).toEqual({ sections: [], lanes: {} });
    expect(collapsedPrefs({})).toEqual({ sections: [], lanes: {} });
  });

  it('keeps known sections and each board’s lane keys', () => {
    expect(
      collapsedPrefs({
        collapsedBoardSections: ['recent', 'starred'],
        collapsedLanes: { b1: ['ln-a', NO_LANE_KEY], b2: [] },
      }),
    ).toEqual({
      sections: ['starred', 'recent'],
      lanes: { b1: ['ln-a', NO_LANE_KEY], b2: [] },
    });
  });

  it('drops shapes the app never writes, reading them as not collapsed', () => {
    expect(
      collapsedPrefs({
        collapsedBoardSections: ['starred', 'by hand', 7],
        collapsedLanes: { b1: 'ln-a', b2: ['ln-b', 3, null], b3: { x: 1 } },
      }),
    ).toEqual({ sections: ['starred'], lanes: { b2: ['ln-b'] } });
    expect(collapsedPrefs({ collapsedBoardSections: 'starred', collapsedLanes: ['b1'] })).toEqual({
      sections: [],
      lanes: {},
    });
  });
});

describe('laneKey', () => {
  it('is the lane id, or the No lane key no lane id can equal', () => {
    expect(laneKey('ln-x')).toBe('ln-x');
    expect(laneKey(null)).toBe(NO_LANE_KEY);
    expect(NO_LANE_KEY).not.toMatch(/^ln/);
  });
});
