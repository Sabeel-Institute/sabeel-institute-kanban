import { describe, expect, it } from 'vitest';
import { cardTileName } from './cardTileName';

describe('cardTileName', () => {
  it('is the title alone for a card with no subtask link', () => {
    expect(cardTileName({ title: 'Book the venue' })).toBe('Book the venue');
    expect(cardTileName({ title: 'Book the venue' }, { subtaskCount: 0 })).toBe('Book the venue');
  });

  it('names the main task of a subtask, or says subtask when it is not loaded', () => {
    expect(cardTileName({ title: 'Set the budget', parentId: 'p' }, { parentTitle: 'Plan the open house' })).toBe(
      'Set the budget, subtask of Plan the open house',
    );
    expect(cardTileName({ title: 'Set the budget', parentId: 'p' })).toBe('Set the budget, subtask');
  });

  it('counts a main task’s subtasks, and says both for a card that is each', () => {
    expect(cardTileName({ title: 'Plan the open house' }, { subtaskCount: 1 })).toBe('Plan the open house, 1 subtask');
    expect(cardTileName({ title: 'Plan the open house' }, { subtaskCount: 4 })).toBe('Plan the open house, 4 subtasks');
    expect(cardTileName({ title: 'Venue', parentId: 'p' }, { parentTitle: 'Plan', subtaskCount: 2 })).toBe(
      'Venue, subtask of Plan, 2 subtasks',
    );
  });
});
