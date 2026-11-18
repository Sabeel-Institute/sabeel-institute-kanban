import { describe, it, expect } from 'vitest';
import {
  describeActivity,
  diffCard,
  isKnownActivityType,
  type CardSnapshot,
} from '../src/activity';
import type { ActivityType } from '../src/types';

const base: CardSnapshot = {
  title: 'Fix signup',
  description: '',
  columnId: 'todo',
  rank: 'V',
  assigneeUids: [],
  priority: 'none',
  labelIds: [],
  archived: false,
};

describe('diffCard', () => {
  it('reports creation', () => {
    expect(diffCard(null, base)).toEqual([{ type: 'created' }]);
  });

  it('reports nothing for deletion — the history goes with the card', () => {
    expect(diffCard(base, null)).toEqual([]);
  });

  it('reports nothing when nothing meaningful changed', () => {
    expect(diffCard(base, { ...base })).toEqual([]);
  });

  it('IGNORES a rank-only change', () => {
    // The load-bearing omission: reordering within a column is a rank-only
    // write, and logging those would drown the timeline in noise nobody reads.
    expect(diffCard(base, { ...base, rank: 'W' })).toEqual([]);
  });

  it('ignores updatedAt/updatedBy churn', () => {
    expect(
      diffCard(base, { ...base, updatedAt: 999, updatedBy: 'someone' }),
    ).toEqual([]);
  });

  it('reports a column move', () => {
    expect(diffCard(base, { ...base, columnId: 'done' })).toEqual([
      { type: 'moved', from: 'todo', to: 'done' },
    ]);
  });

  it('reports a move even when the rank also changed', () => {
    // Which is always: moving a card rewrites both fields.
    expect(diffCard(base, { ...base, columnId: 'done', rank: 'Z' })).toEqual([
      { type: 'moved', from: 'todo', to: 'done' },
    ]);
  });

  it('reports assignment per person, not as a list diff', () => {
    expect(diffCard(base, { ...base, assigneeUids: ['u1', 'u2'] })).toEqual([
      { type: 'assigned', to: 'u1' },
      { type: 'assigned', to: 'u2' },
    ]);
  });

  it('reports unassignment', () => {
    expect(
      diffCard({ ...base, assigneeUids: ['u1'] }, { ...base, assigneeUids: [] }),
    ).toEqual([{ type: 'unassigned', to: 'u1' }]);
  });

  it('reports a swap as one assign and one unassign', () => {
    expect(
      diffCard({ ...base, assigneeUids: ['u1'] }, { ...base, assigneeUids: ['u2'] }),
    ).toEqual([
      { type: 'assigned', to: 'u2' },
      { type: 'unassigned', to: 'u1' },
    ]);
  });

  it('ignores assignee reordering', () => {
    expect(
      diffCard({ ...base, assigneeUids: ['u1', 'u2'] }, { ...base, assigneeUids: ['u2', 'u1'] }),
    ).toEqual([]);
  });

  it('reports due date set, changed and cleared', () => {
    expect(diffCard(base, { ...base, dueDate: '2026-07-20' })).toEqual([
      { type: 'due', from: undefined, to: '2026-07-20' },
    ]);
    expect(
      diffCard({ ...base, dueDate: '2026-07-20' }, { ...base, dueDate: undefined }),
    ).toEqual([{ type: 'due', from: '2026-07-20', to: undefined }]);
  });

  it('reports priority changes', () => {
    expect(diffCard(base, { ...base, priority: 'urgent' })).toEqual([
      { type: 'priority', from: 'none', to: 'urgent' },
    ]);
  });

  it('reports label changes but ignores reordering', () => {
    expect(diffCard(base, { ...base, labelIds: ['l1'] })).toEqual([{ type: 'labels' }]);
    expect(
      diffCard({ ...base, labelIds: ['l1', 'l2'] }, { ...base, labelIds: ['l2', 'l1'] }),
    ).toEqual([]);
  });

  it('collapses a title and description save into ONE edited entry', () => {
    const out = diffCard(base, { ...base, title: 'New', description: 'text' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'edited', from: 'Fix signup', to: 'New' });
  });

  it('reports a description-only edit without pretending it was a rename', () => {
    const out = diffCard(base, { ...base, description: 'text' });
    expect(out).toEqual([{ type: 'edited', from: undefined, to: undefined }]);
  });

  it('reports archive and restore', () => {
    expect(diffCard(base, { ...base, archived: true })).toEqual([
      { type: 'archived', from: 'false', to: 'true' },
    ]);
    expect(diffCard({ ...base, archived: true }, base)).toEqual([
      { type: 'archived', from: 'true', to: 'false' },
    ]);
  });

  it('reports several changes from one save', () => {
    const out = diffCard(base, {
      ...base,
      columnId: 'done',
      priority: 'high',
      assigneeUids: ['u1'],
    });
    expect(out.map((e) => e.type).sort()).toEqual(['assigned', 'moved', 'priority']);
  });
});

describe('describeActivity', () => {
  const name = (uid: string) => ({ u1: 'Sara' })[uid] ?? 'someone';
  const col = (id: string) => ({ done: 'Done' })[id] ?? 'a column';

  it('reads as a sentence for every type', () => {
    expect(describeActivity({ type: 'created' }, name, col)).toBe('created this card');
    expect(describeActivity({ type: 'moved', to: 'done' }, name, col)).toBe(
      'moved it to Done',
    );
    expect(describeActivity({ type: 'assigned', to: 'u1' }, name, col)).toBe(
      'assigned Sara',
    );
    expect(describeActivity({ type: 'unassigned', to: 'u1' }, name, col)).toBe(
      'unassigned Sara',
    );
    expect(describeActivity({ type: 'due', to: '2026-07-20' }, name, col)).toBe(
      'set the due date to 2026-07-20',
    );
    expect(describeActivity({ type: 'due' }, name, col)).toBe('cleared the due date');
    expect(describeActivity({ type: 'priority', to: 'high' }, name, col)).toBe(
      'set priority to high',
    );
    expect(describeActivity({ type: 'labels' }, name, col)).toBe('changed the labels');
    expect(describeActivity({ type: 'edited', to: 'New' }, name, col)).toBe(
      'renamed it to “New”',
    );
    expect(describeActivity({ type: 'edited' }, name, col)).toBe(
      'edited the description',
    );
    expect(describeActivity({ type: 'archived', to: 'true' }, name, col)).toBe(
      'archived it',
    );
    expect(describeActivity({ type: 'archived', to: 'false' }, name, col)).toBe(
      'restored it',
    );
  });
});

describe('subtask links in the history', () => {
  it('logs becoming a subtask, carrying the parent id', () => {
    const out = diffCard({ parentId: undefined }, { parentId: 'p1' });
    expect(out).toContainEqual({ type: 'subtaskOf', from: undefined, to: 'p1' });
  });

  it('logs being unlinked, carrying the old parent id', () => {
    const out = diffCard({ parentId: 'p1' }, { parentId: undefined });
    expect(out).toContainEqual({ type: 'subtaskOf', from: 'p1', to: undefined });
  });

  it('logs a re-parent as one entry with both ends', () => {
    const out = diffCard({ parentId: 'p1' }, { parentId: 'p2' });
    expect(out).toContainEqual({ type: 'subtaskOf', from: 'p1', to: 'p2' });
  });

  it('says nothing when the link is unchanged', () => {
    expect(diffCard({ parentId: 'p1' }, { parentId: 'p1' })).toEqual([]);
  });

  it('describes both sides of the link in plain words', () => {
    const titles = (id: string) => (id === 'p1' ? 'Book the venue' : 'Make flyer');
    // On the child.
    expect(
      describeActivity({ type: 'subtaskOf', to: 'p1' }, () => 'x', () => 'y', titles),
    ).toBe('made this a subtask of Book the venue');
    expect(
      describeActivity({ type: 'subtaskOf', from: 'p1' }, () => 'x', () => 'y', titles),
    ).toBe('removed this from Book the venue');
    // On the parent — the mirrored entry, so the action shows up where it was
    // taken rather than only on the card that technically changed.
    expect(
      describeActivity({ type: 'subtask', to: 'c1' }, () => 'x', () => 'y', titles),
    ).toBe('added Make flyer as a subtask');
    expect(
      describeActivity({ type: 'subtask', from: 'c1' }, () => 'x', () => 'y', titles),
    ).toBe('removed Make flyer as a subtask');
  });

  it('falls back gracefully when the other card cannot be resolved', () => {
    // Deleted, archived, or on a board you cannot see.
    expect(
      describeActivity({ type: 'subtaskOf', to: 'gone' }, () => 'x', () => 'y'),
    ).toBe('made this a subtask of another card');
  });
});

describe('attachment history', () => {
  const say = (entry: { type: ActivityType; from?: string; to?: string }) =>
    describeActivity(entry, () => 'Sara', () => 'Done');

  it('names the file, since nothing can resolve it once it is gone', () => {
    expect(say({ type: 'attached', to: 'budget.pdf' })).toBe('attached budget.pdf');
    expect(say({ type: 'detached', from: 'budget.pdf' })).toBe('removed budget.pdf');
  });

  it('still says something if the name is missing', () => {
    expect(say({ type: 'attached' })).toBe('attached a file');
    expect(say({ type: 'detached' })).toBe('removed a file');
  });
});

describe('lane history', () => {
  const lanes = (id: string) => ({ plan: 'Planning', mkt: 'Marketing' })[id];
  const say = (entry: { type: ActivityType; from?: string; to?: string }) =>
    describeActivity(entry, () => 'Sara', () => 'Done', undefined, lanes);
  const card = { boardId: 'b1', columnId: 'todo', laneId: 'plan' };

  it('records a lane change on the board, as a column move is', () => {
    expect(diffCard(card, { ...card, laneId: 'mkt' })).toEqual([
      { type: 'lane', from: 'plan', to: 'mkt' },
    ]);
    expect(diffCard({ ...card, laneId: undefined }, card)).toEqual([
      { type: 'lane', from: undefined, to: 'plan' },
    ]);
  });

  it('records the column and the lane when both move in one write', () => {
    expect(diffCard(card, { ...card, columnId: 'done', laneId: 'mkt' }).map((e) => e.type)).toEqual(
      ['moved', 'lane'],
    );
  });

  it('records nothing for the lane on a move to another board, which clears it', () => {
    expect(
      diffCard(card, { ...card, boardId: 'b2', columnId: 'c9', laneId: undefined }),
    ).toEqual([{ type: 'moved', from: 'todo', to: 'c9' }]);
  });

  it('names the lane', () => {
    expect(say({ type: 'lane', from: 'plan', to: 'mkt' })).toBe('moved it to the Marketing lane');
  });

  it('still reads for a lane since removed, or a lane cleared', () => {
    expect(say({ type: 'lane', to: 'gone' })).toBe('moved it to another lane');
    expect(say({ type: 'lane', from: 'plan' })).toBe('took it out of its lane');
  });

  it('is known to this build', () => {
    expect(isKnownActivityType('lane')).toBe(true);
  });
});

describe('isKnownActivityType', () => {
  it('accepts every type this build describes', () => {
    for (const t of ['created', 'moved', 'attached', 'detached'] as const) {
      expect(isKnownActivityType(t)).toBe(true);
    }
  });

  it('rejects a type from a newer release, and inherited object keys', () => {
    // An Android user on a previous APK genuinely receives these.
    expect(isKnownActivityType('somethingAddedLater')).toBe(false);
    expect(isKnownActivityType('toString')).toBe(false);
    expect(isKnownActivityType(undefined)).toBe(false);
  });
});
