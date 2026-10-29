import { describe, expect, it } from 'vitest';
import {
  boardChangeActor,
  describeBoardActivity,
  diffBoard,
  isKnownBoardActivityType,
  type BoardSnapshot,
} from '../src';

const board = (over: BoardSnapshot = {}): BoardSnapshot => ({
  name: 'Fundraising',
  archived: false,
  columns: [
    { id: 'a', name: 'To Do' },
    { id: 'b', name: 'Doing' },
    { id: 'c', name: 'Done' },
  ],
  memberUids: ['sara', 'omar'],
  memberProfiles: {
    sara: { displayName: 'Sara', email: 'sara@x' },
    omar: { displayName: 'Omar', email: 'omar@x' },
  },
  boardOwnerUids: ['sara'],
  activeCardCount: 3,
  createdAt: 1,
  createdBy: 'sara',
  ...over,
});

describe('diffBoard', () => {
  it('records a new board as created, and nothing for a deleted one', () => {
    expect(diffBoard(null, board())).toEqual([{ type: 'created' }]);
    expect(diffBoard(board(), null)).toEqual([]);
  });

  it('ignores the card count, the profile copy and the stamp', () => {
    const b = board();
    expect(
      diffBoard(b, {
        ...b,
        activeCardCount: 9,
        memberProfiles: { ...b.memberProfiles, sara: { displayName: 'Sara K', email: 'sara@x' } },
        updatedAt: 5,
        updatedBy: 'sara',
      }),
    ).toEqual([]);
  });

  it('records a rename with both names', () => {
    expect(diffBoard(board(), board({ name: 'Fundraising 2027' }))).toEqual([
      { type: 'renamed', from: 'Fundraising', to: 'Fundraising 2027' },
    ]);
  });

  it('records archiving and restoring, treating a missing flag as not archived', () => {
    expect(diffBoard(board(), board({ archived: true }))).toEqual([{ type: 'archived' }]);
    expect(diffBoard(board({ archived: true }), board())).toEqual([{ type: 'restored' }]);
    expect(diffBoard(board({ archived: undefined }), board({ archived: false }))).toEqual([]);
  });

  it('records each person added or taken off, by name', () => {
    const amina = { amina: { displayName: 'Amina', email: 'amina@x' } };
    const before = board();
    const after = board({
      memberUids: ['sara', 'amina'],
      memberProfiles: { sara: before.memberProfiles!.sara, ...amina },
    });
    expect(diffBoard(before, after)).toEqual([
      { type: 'memberAdded', subjectUid: 'amina', subjectName: 'Amina' },
      { type: 'memberRemoved', subjectUid: 'omar', subjectName: 'Omar' },
    ]);
  });

  it('records ownership given and taken away', () => {
    expect(diffBoard(board(), board({ boardOwnerUids: ['sara', 'omar'] }))).toEqual([
      { type: 'ownerAdded', subjectUid: 'omar', subjectName: 'Omar' },
    ]);
    expect(diffBoard(board({ boardOwnerUids: ['sara', 'omar'] }), board())).toEqual([
      { type: 'ownerRemoved', subjectUid: 'omar', subjectName: 'Omar' },
    ]);
  });

  // removeBoardMember takes ownership away in the same write. One event, not two.
  it('does not list lost ownership separately when the person left the board', () => {
    const before = board({ boardOwnerUids: ['sara', 'omar'] });
    const after = board({
      memberUids: ['sara'],
      memberProfiles: { sara: before.memberProfiles!.sara },
      boardOwnerUids: ['sara'],
    });
    expect(diffBoard(before, after)).toEqual([
      { type: 'memberRemoved', subjectUid: 'omar', subjectName: 'Omar' },
    ]);
  });

  it('leaves a name it cannot find unset rather than guessing', () => {
    expect(diffBoard(board(), board({ memberUids: ['sara', 'omar', 'zed'] }))).toEqual([
      { type: 'memberAdded', subjectUid: 'zed', subjectName: undefined },
    ]);
  });

  it('records a column added, removed or renamed, matched by id', () => {
    const cols = board().columns!;
    expect(diffBoard(board(), board({ columns: [...cols, { id: 'd', name: 'Review' }] }))).toEqual([
      { type: 'columnAdded', to: 'Review' },
    ]);
    expect(diffBoard(board(), board({ columns: cols.filter((c) => c.id !== 'b') }))).toEqual([
      { type: 'columnRemoved', from: 'Doing' },
    ]);
    expect(
      diffBoard(board(), board({ columns: cols.map((c) => (c.id === 'b' ? { ...c, name: 'In progress' } : c)) })),
    ).toEqual([{ type: 'columnRenamed', from: 'Doing', to: 'In progress' }]);
  });

  it('records a reorder, but not for an add or a removal on its own', () => {
    const [a, b, c] = board().columns!;
    expect(diffBoard(board(), board({ columns: [b, a, c] }))).toEqual([{ type: 'columnsReordered' }]);
    expect(diffBoard(board(), board({ columns: [a, c] }))).toEqual([{ type: 'columnRemoved', from: 'Doing' }]);
    expect(diffBoard(board(), board({ columns: [{ id: 'z', name: 'First' }, a, b, c] }))).toEqual([
      { type: 'columnAdded', to: 'First' },
    ]);
    expect(diffBoard(board(), board({ columns: [c, a, { id: 'z', name: 'New' }] }))).toEqual([
      { type: 'columnAdded', to: 'New' },
      { type: 'columnRemoved', from: 'Doing' },
      { type: 'columnsReordered' },
    ]);
  });
});

describe('boardChangeActor', () => {
  it('names the creator of a new board', () => {
    expect(boardChangeActor(null, board())).toBe('sara');
  });

  it('names the stamp only when the change moved it', () => {
    const before = board({ updatedAt: 1, updatedBy: 'sara' });
    expect(boardChangeActor(before, { ...before, name: 'X', updatedAt: 2, updatedBy: 'omar' })).toBe('omar');
    // The same person stamping twice is still a new stamp.
    expect(boardChangeActor(before, { ...before, name: 'X', updatedAt: 2 })).toBe('sara');
  });

  // An app older than the history leaves the stamp alone: the uid on it is
  // whoever changed the board BEFORE, and must not be credited with this.
  it('names nobody when the stamp did not move', () => {
    const before = board({ updatedAt: 1, updatedBy: 'sara' });
    expect(boardChangeActor(before, { ...before, name: 'X' })).toBeUndefined();
    expect(boardChangeActor(board(), board({ name: 'X' }))).toBeUndefined();
    expect(boardChangeActor(board(), null)).toBeUndefined();
  });
});

describe('describeBoardActivity', () => {
  const by = { actorUid: 'sara', actorName: 'Sara' };

  it('names whoever did it', () => {
    expect(describeBoardActivity({ type: 'created', ...by })).toBe('Sara created the board');
    expect(describeBoardActivity({ type: 'renamed', ...by, from: 'A', to: 'B' })).toBe(
      'Sara renamed the board to “B”',
    );
    expect(describeBoardActivity({ type: 'archived', ...by })).toBe('Sara archived the board');
    expect(describeBoardActivity({ type: 'restored', ...by })).toBe('Sara restored the board');
    expect(describeBoardActivity({ type: 'memberAdded', ...by, subjectUid: 'omar', subjectName: 'Omar' })).toBe(
      'Sara added Omar',
    );
    expect(describeBoardActivity({ type: 'memberRemoved', ...by, subjectUid: 'omar', subjectName: 'Omar' })).toBe(
      'Sara removed Omar',
    );
    expect(describeBoardActivity({ type: 'ownerAdded', ...by, subjectUid: 'omar', subjectName: 'Omar' })).toBe(
      'Sara made Omar an owner',
    );
    expect(describeBoardActivity({ type: 'ownerRemoved', ...by, subjectUid: 'omar', subjectName: 'Omar' })).toBe(
      'Sara removed Omar as an owner',
    );
    expect(describeBoardActivity({ type: 'columnAdded', ...by, to: 'Review' })).toBe(
      'Sara added the column “Review”',
    );
    expect(describeBoardActivity({ type: 'columnRemoved', ...by, from: 'Review' })).toBe(
      'Sara removed the column “Review”',
    );
    expect(describeBoardActivity({ type: 'columnRenamed', ...by, from: 'Doing', to: 'Now' })).toBe(
      'Sara renamed the column “Doing” to “Now”',
    );
    expect(describeBoardActivity({ type: 'columnsReordered', ...by })).toBe('Sara reordered the columns');
  });

  it('says joined, left and stepped down when people act on themselves', () => {
    const self = { ...by, subjectUid: 'sara', subjectName: 'Sara' };
    expect(describeBoardActivity({ type: 'memberAdded', ...self })).toBe('Sara joined the board');
    expect(describeBoardActivity({ type: 'memberRemoved', ...self })).toBe('Sara left the board');
    expect(describeBoardActivity({ type: 'ownerRemoved', ...self })).toBe('Sara stepped down as an owner');
  });

  // Nobody recorded is not "Someone": that would claim a person the record lacks.
  it('reads in the passive when nobody was recorded', () => {
    expect(describeBoardActivity({ type: 'archived' })).toBe('The board was archived');
    expect(describeBoardActivity({ type: 'memberAdded', subjectUid: 'omar', subjectName: 'Omar' })).toBe(
      'Omar was added to the board',
    );
    expect(describeBoardActivity({ type: 'columnRenamed', from: 'Doing', to: 'Now' })).toBe(
      'The column “Doing” was renamed to “Now”',
    );
    expect(describeBoardActivity({ type: 'columnsReordered' })).toBe('The columns were reordered');
  });

  it('falls back to Someone for a recorded person with no name', () => {
    expect(describeBoardActivity({ type: 'archived', actorUid: 'x' })).toBe('Someone archived the board');
    expect(describeBoardActivity({ type: 'memberAdded', ...by, subjectUid: 'x' })).toBe('Sara added someone');
  });

  it('knows its own types and nothing else', () => {
    expect(isKnownBoardActivityType('columnRenamed')).toBe(true);
    expect(isKnownBoardActivityType('labelsChanged')).toBe(false);
    expect(isKnownBoardActivityType('toString')).toBe(false);
    expect(isKnownBoardActivityType(undefined)).toBe(false);
  });
});
