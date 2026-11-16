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

describe('diffBoard on lanes', () => {
  const lanes = [
    { id: 'p', name: 'Planning' },
    { id: 'm', name: 'Marketing' },
    { id: 's', name: 'Supplies' },
  ];
  const withLanes = (over: BoardSnapshot = {}) =>
    board({ lanesOn: true, lanes, doneColumnId: 'c', ...over });

  it('records lanes turned on, without a second line for the finished column set with it', () => {
    expect(diffBoard(board(), board({ lanesOn: true, doneColumnId: 'c' }))).toEqual([
      { type: 'lanesOn' },
    ]);
  });

  it('records lanes turned off, and nothing for the lanes it keeps', () => {
    expect(diffBoard(withLanes(), withLanes({ lanesOn: false }))).toEqual([{ type: 'lanesOff' }]);
  });

  it('records a lane added, removed or renamed, matched by id', () => {
    expect(
      diffBoard(withLanes(), withLanes({ lanes: [...lanes, { id: 'w', name: 'Wrap-up' }] })),
    ).toEqual([{ type: 'laneAdded', to: 'Wrap-up' }]);
    expect(diffBoard(withLanes(), withLanes({ lanes: lanes.filter((l) => l.id !== 'm') }))).toEqual([
      { type: 'laneRemoved', from: 'Marketing' },
    ]);
    expect(
      diffBoard(
        withLanes(),
        withLanes({ lanes: lanes.map((l) => (l.id === 'm' ? { ...l, name: 'Outreach' } : l)) }),
      ),
    ).toEqual([{ type: 'laneRenamed', from: 'Marketing', to: 'Outreach' }]);
  });

  it('records a reorder, but not for an add or a removal on its own', () => {
    const [p, m, s] = lanes;
    expect(diffBoard(withLanes(), withLanes({ lanes: [m, p, s] }))).toEqual([
      { type: 'lanesReordered' },
    ]);
    expect(diffBoard(withLanes(), withLanes({ lanes: [p, s] }))).toEqual([
      { type: 'laneRemoved', from: 'Marketing' },
    ]);
  });

  it('records the first lane added to a board that never had any', () => {
    expect(
      diffBoard(board({ lanesOn: true }), board({ lanesOn: true, lanes: [lanes[0]] })),
    ).toEqual([{ type: 'laneAdded', to: 'Planning' }]);
  });

  it('records the finished column by name when it is chosen', () => {
    expect(diffBoard(withLanes(), withLanes({ doneColumnId: 'b' }))).toEqual([
      { type: 'finishedColumn', to: 'Doing' },
    ]);
  });

  it('records a finished column first set while lanes are on, not one set by turning them on', () => {
    expect(
      diffBoard(withLanes({ lanesOn: false, doneColumnId: undefined }), withLanes()),
    ).toEqual([{ type: 'lanesOn' }]);
    expect(diffBoard(withLanes({ doneColumnId: undefined }), withLanes())).toEqual([
      { type: 'finishedColumn', to: 'Done' },
    ]);
  });

  it('records only the change made on a board without lanes, nothing of lanes', () => {
    // A real change, so a diff that reported lanes on any write would show.
    expect(diffBoard(board(), board({ name: 'Fundraising 2027' }))).toEqual([
      { type: 'renamed', from: 'Fundraising', to: 'Fundraising 2027' },
    ]);
  });
});

describe('diffBoard on details', () => {
  const fields = [
    { id: 'f1', name: 'Teachers', type: 'text' as const },
    { id: 'f2', name: 'Start date', type: 'start' as const },
    { id: 'f3', name: 'Zoom link', type: 'link' as const },
  ];
  const withFields = (over: BoardSnapshot = {}) =>
    board({ fields, details: { f1: 'Sara', f2: '2027-06-01' }, ...over });

  it('records a field added, removed or renamed, matched by id', () => {
    expect(
      diffBoard(withFields(), withFields({ fields: [...fields, { id: 'f4', name: 'Fee', type: 'number' }] })),
    ).toEqual([{ type: 'fieldAdded', to: 'Fee' }]);
    expect(
      diffBoard(withFields(), withFields({ fields: fields.filter((f) => f.id !== 'f3') })),
    ).toEqual([{ type: 'fieldRemoved', from: 'Zoom link' }]);
    expect(
      diffBoard(
        withFields(),
        withFields({ fields: fields.map((f) => (f.id === 'f1' ? { ...f, name: 'Teacher' } : f)) }),
      ),
    ).toEqual([{ type: 'fieldRenamed', from: 'Teachers', to: 'Teacher' }]);
  });

  it('records a reorder, but not for an add or a removal on its own', () => {
    const [a, b, c] = fields;
    expect(diffBoard(withFields(), withFields({ fields: [c, a, b] }))).toEqual([
      { type: 'fieldsReordered' },
    ]);
  });

  it('records each value set, changed or cleared, by the field’s name', () => {
    expect(
      diffBoard(withFields(), withFields({ details: { f1: 'Omar', f2: '2027-06-01', f3: 'https://z.example' } })),
    ).toEqual([
      { type: 'detailChanged', field: 'Teachers', to: 'Omar' },
      { type: 'detailChanged', field: 'Zoom link', to: 'https://z.example' },
    ]);
    expect(diffBoard(withFields(), withFields({ details: { f2: '2027-06-01' } }))).toEqual([
      { type: 'detailChanged', field: 'Teachers' },
    ]);
  });

  it('records a field removed with its value as one line, not two', () => {
    expect(
      diffBoard(
        withFields(),
        withFields({ fields: fields.filter((f) => f.id !== 'f1'), details: { f2: '2027-06-01' } }),
      ),
    ).toEqual([{ type: 'fieldRemoved', from: 'Teachers' }]);
  });

  it('names a value by the field as renamed in the same write', () => {
    expect(
      diffBoard(
        withFields(),
        withFields({
          fields: fields.map((f) => (f.id === 'f1' ? { ...f, name: 'Teacher' } : f)),
          details: { f1: 'Omar', f2: '2027-06-01' },
        }),
      ),
    ).toEqual([
      { type: 'fieldRenamed', from: 'Teachers', to: 'Teacher' },
      { type: 'detailChanged', field: 'Teacher', to: 'Omar' },
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

  // A write that leaves the stamp alone (a server script; the rules refuse it
  // from a client): the uid on it is whoever changed the board BEFORE, and
  // must not be credited with this.
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

  it('words the lane entries', () => {
    const by = { actorUid: 'sara', actorName: 'Sara' };
    expect(describeBoardActivity({ type: 'lanesOn', ...by })).toBe('Sara turned lanes on');
    expect(describeBoardActivity({ type: 'lanesOff' })).toBe('Lanes were turned off');
    expect(describeBoardActivity({ type: 'laneAdded', to: 'Marketing', ...by })).toBe(
      'Sara added the lane “Marketing”',
    );
    expect(describeBoardActivity({ type: 'laneRemoved', from: 'Marketing', ...by })).toBe(
      'Sara removed the lane “Marketing”',
    );
    expect(
      describeBoardActivity({ type: 'laneRenamed', from: 'Marketing', to: 'Outreach', ...by }),
    ).toBe('Sara renamed the lane “Marketing” to “Outreach”');
    expect(describeBoardActivity({ type: 'lanesReordered', ...by })).toBe('Sara reordered the lanes');
    expect(describeBoardActivity({ type: 'finishedColumn', to: 'Done', ...by })).toBe(
      'Sara set the finished column to “Done”',
    );
    for (const t of ['lanesOn', 'laneAdded', 'finishedColumn']) {
      expect(isKnownBoardActivityType(t)).toBe(true);
    }
  });

  it('words the detail entries, cutting a long value short', () => {
    const by = { actorUid: 'sara', actorName: 'Sara' };
    expect(describeBoardActivity({ type: 'fieldAdded', to: 'Fee', ...by })).toBe(
      'Sara added the field “Fee”',
    );
    expect(describeBoardActivity({ type: 'fieldRemoved', from: 'Fee', ...by })).toBe(
      'Sara removed the field “Fee”',
    );
    expect(describeBoardActivity({ type: 'fieldsReordered', ...by })).toBe('Sara reordered the details');
    expect(describeBoardActivity({ type: 'detailChanged', field: 'Fee', to: '120', ...by })).toBe(
      'Sara set “Fee” to “120”',
    );
    expect(describeBoardActivity({ type: 'detailChanged', field: 'Fee', ...by })).toBe(
      'Sara cleared “Fee”',
    );
    const long = describeBoardActivity({ type: 'detailChanged', field: 'Notes', to: 'x'.repeat(300), ...by });
    expect(long.length).toBeLessThan(120);
    expect(long.endsWith('…”')).toBe(true);
    expect(isKnownBoardActivityType('detailChanged')).toBe(true);
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
