import type { BoardActivityDoc, BoardActivityType, BoardDoc } from './types';

/**
 * A board's own history: what happened to the board, as opposed to its cards.
 * Pure, like `diffCard`, so the trigger that writes it and the script that
 * recovered the history before it are one diff, tested here exhaustively.
 */

/** A board as a trigger or a backup sees it: every field optional, since old docs vary. */
export type BoardSnapshot = Partial<BoardDoc>;

/** One change, before anyone is attached to it. */
export type BoardChange = Pick<
  BoardActivityDoc,
  'type' | 'subjectUid' | 'subjectName' | 'from' | 'to' | 'field'
>;

function missingFrom(a: readonly string[] = [], b: readonly string[] = []): string[] {
  const inB = new Set(b);
  return a.filter((x) => !inB.has(x));
}

function profileName(uid: string, ...boards: (BoardSnapshot | null)[]): string | undefined {
  for (const b of boards) {
    const name = b?.memberProfiles?.[uid]?.displayName;
    if (name) return name;
  }
  return undefined;
}

/**
 * What changed about the board, as history entries.
 *
 * Ignored on purpose: `activeCardCount` (a trigger's tally of the cards, not a
 * change to the board), `memberProfiles` alone (the server's copy of a name),
 * `description` (nothing in the app edits it) and the `updatedAt`/`updatedBy`
 * stamp, which says WHO, not what.
 *
 * Taking someone off the board also takes away their ownership, in the same
 * write. That is one event — "Sara removed Omar" — so the ownership half is
 * not listed separately.
 */
export function diffBoard(
  before: BoardSnapshot | null,
  after: BoardSnapshot | null,
): BoardChange[] {
  // Boards are never deleted, and a deleted one would leave nothing to hang
  // its history on: the entries are under the board.
  if (!after) return [];
  if (!before) return [{ type: 'created' }];

  const out: BoardChange[] = [];

  if (before.name !== after.name) {
    out.push({ type: 'renamed', from: before.name, to: after.name });
  }

  if (Boolean(before.archived) !== Boolean(after.archived)) {
    out.push({ type: after.archived ? 'archived' : 'restored' });
  }

  const joined = missingFrom(after.memberUids, before.memberUids);
  const left = missingFrom(before.memberUids, after.memberUids);
  for (const uid of joined) {
    out.push({ type: 'memberAdded', subjectUid: uid, subjectName: profileName(uid, after) });
  }
  for (const uid of left) {
    out.push({ type: 'memberRemoved', subjectUid: uid, subjectName: profileName(uid, before) });
  }

  for (const uid of missingFrom(after.boardOwnerUids, before.boardOwnerUids)) {
    out.push({ type: 'ownerAdded', subjectUid: uid, subjectName: profileName(uid, after, before) });
  }
  for (const uid of missingFrom(before.boardOwnerUids, after.boardOwnerUids)) {
    if (left.includes(uid)) continue;
    out.push({ type: 'ownerRemoved', subjectUid: uid, subjectName: profileName(uid, after, before) });
  }

  // Columns are matched by id, so a rename is a rename and not a removal plus
  // an addition. Names are stored on the entry because a deleted column's
  // name exists nowhere else.
  const was = new Map((before.columns ?? []).map((c) => [c.id, c.name]));
  const now = new Map((after.columns ?? []).map((c) => [c.id, c.name]));
  for (const [id, name] of now) {
    if (!was.has(id)) out.push({ type: 'columnAdded', to: name });
  }
  for (const [id, name] of was) {
    if (!now.has(id)) out.push({ type: 'columnRemoved', from: name });
  }
  for (const [id, name] of now) {
    const old = was.get(id);
    if (old !== undefined && old !== name) out.push({ type: 'columnRenamed', from: old, to: name });
  }
  // A reorder is the columns both versions share, in a different order.
  // Adding or removing one changes no other column's place relative to the
  // rest, so neither counts as a reorder by itself.
  const kept = (before.columns ?? []).map((c) => c.id).filter((id) => now.has(id));
  const keptNow = (after.columns ?? []).map((c) => c.id).filter((id) => was.has(id));
  if (kept.some((id, i) => keptNow[i] !== id)) out.push({ type: 'columnsReordered' });

  const turnedOn = !before.lanesOn && Boolean(after.lanesOn);
  if (Boolean(before.lanesOn) !== Boolean(after.lanesOn)) {
    out.push({ type: after.lanesOn ? 'lanesOn' : 'lanesOff' });
  }

  // Lanes are matched by id, exactly as columns are.
  const wasLane = new Map((before.lanes ?? []).map((l) => [l.id, l.name]));
  const nowLane = new Map((after.lanes ?? []).map((l) => [l.id, l.name]));
  for (const [id, name] of nowLane) {
    if (!wasLane.has(id)) out.push({ type: 'laneAdded', to: name });
  }
  for (const [id, name] of wasLane) {
    if (!nowLane.has(id)) out.push({ type: 'laneRemoved', from: name });
  }
  for (const [id, name] of nowLane) {
    const old = wasLane.get(id);
    if (old !== undefined && old !== name) out.push({ type: 'laneRenamed', from: old, to: name });
  }
  const keptLanes = (before.lanes ?? []).map((l) => l.id).filter((id) => nowLane.has(id));
  const keptLanesNow = (after.lanes ?? []).map((l) => l.id).filter((id) => wasLane.has(id));
  if (keptLanes.some((id, i) => keptLanesNow[i] !== id)) out.push({ type: 'lanesReordered' });

  // The finished column, by name, since the column may later be removed. Its
  // first setting rides on turning lanes on and says nothing more than that.
  if (
    after.doneColumnId !== undefined &&
    before.doneColumnId !== after.doneColumnId &&
    !(turnedOn && before.doneColumnId === undefined)
  ) {
    out.push({ type: 'finishedColumn', to: now.get(after.doneColumnId) });
  }

  // Details: fields by id, as columns and lanes are, so a rename is a rename.
  const wasField = new Map((before.fields ?? []).map((f) => [f.id, f.name]));
  const nowField = new Map((after.fields ?? []).map((f) => [f.id, f.name]));
  for (const [id, name] of nowField) {
    if (!wasField.has(id)) out.push({ type: 'fieldAdded', to: name });
  }
  for (const [id, name] of wasField) {
    if (!nowField.has(id)) out.push({ type: 'fieldRemoved', from: name });
  }
  for (const [id, name] of nowField) {
    const old = wasField.get(id);
    if (old !== undefined && old !== name) out.push({ type: 'fieldRenamed', from: old, to: name });
  }
  const keptFields = (before.fields ?? []).map((f) => f.id).filter((id) => nowField.has(id));
  const keptFieldsNow = (after.fields ?? []).map((f) => f.id).filter((id) => wasField.has(id));
  if (keptFields.some((id, i) => keptFieldsNow[i] !== id)) out.push({ type: 'fieldsReordered' });

  // A value, one entry per field whose value changed, named by the field as it
  // is now. A removed field's value goes with it, which "removed the field"
  // already says.
  for (const [id, name] of nowField) {
    const was = before.details?.[id];
    const value = after.details?.[id];
    if (was !== value) {
      out.push({ type: 'detailChanged', field: name, ...(value !== undefined ? { to: value } : {}) });
    }
  }

  return out;
}

/**
 * Who made the change from `before` to `after`, as far as the board says.
 *
 * A new board names its creator, which the create rule holds to the writer. A
 * change names `updatedBy` only when it moved `updatedAt` too: rules accept a
 * new stamp only from the person it names, and let an older app build leave
 * the stamp alone. An untouched stamp therefore belongs to an EARLIER change,
 * and naming it would credit somebody with something they did not do.
 */
export function boardChangeActor(
  before: BoardSnapshot | null,
  after: BoardSnapshot | null,
): string | undefined {
  if (!after) return undefined;
  if (!before) return after.createdBy;
  if (after.updatedAt !== undefined && after.updatedAt !== before.updatedAt) {
    return after.updatedBy;
  }
  return undefined;
}

/**
 * Every type this build knows how to describe, for the reason
 * `isKnownActivityType` gives: an older build meets newer entries.
 */
const KNOWN_BOARD_ACTIVITY_TYPES: Record<BoardActivityType, true> = {
  created: true,
  renamed: true,
  archived: true,
  restored: true,
  memberAdded: true,
  memberRemoved: true,
  ownerAdded: true,
  ownerRemoved: true,
  columnAdded: true,
  columnRemoved: true,
  columnRenamed: true,
  columnsReordered: true,
  lanesOn: true,
  lanesOff: true,
  laneAdded: true,
  laneRemoved: true,
  laneRenamed: true,
  lanesReordered: true,
  finishedColumn: true,
  fieldAdded: true,
  fieldRemoved: true,
  fieldRenamed: true,
  fieldsReordered: true,
  detailChanged: true,
};

export function isKnownBoardActivityType(value: unknown): value is BoardActivityType {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(KNOWN_BOARD_ACTIVITY_TYPES, value)
  );
}

type Describable = Pick<
  BoardActivityDoc,
  'type' | 'actorUid' | 'actorName' | 'subjectUid' | 'subjectName' | 'from' | 'to' | 'field'
>;

/** A value as a history line quotes it: whole when short, cut with an ellipsis when not. */
const DETAIL_SHOWN = 80;
function shortValue(value: string): string {
  return value.length > DETAIL_SHOWN ? `${value.slice(0, DETAIL_SHOWN - 1)}…` : value;
}

/**
 * The entry as a sentence. With nobody recorded it reads in the passive —
 * "The board was archived" — never "Someone archived it", which would claim
 * a person the record does not have.
 */
export function describeBoardActivity(e: Describable): string {
  const known = e.actorUid !== undefined;
  const actor = e.actorName || 'Someone';
  const subject = e.subjectName || 'someone';
  const Subject = e.subjectName || 'Someone';
  const self = known && e.actorUid === e.subjectUid;
  const quoted = (s: string | undefined) => `“${s ?? ''}”`;
  switch (e.type) {
    case 'created':
      return known ? `${actor} created the board` : 'The board was created';
    case 'renamed':
      return known
        ? `${actor} renamed the board to ${quoted(e.to)}`
        : `The board was renamed to ${quoted(e.to)}`;
    case 'archived':
      return known ? `${actor} archived the board` : 'The board was archived';
    case 'restored':
      return known ? `${actor} restored the board` : 'The board was restored';
    case 'memberAdded':
      if (self) return `${actor} joined the board`;
      return known ? `${actor} added ${subject}` : `${Subject} was added to the board`;
    case 'memberRemoved':
      if (self) return `${actor} left the board`;
      return known ? `${actor} removed ${subject}` : `${Subject} was taken off the board`;
    case 'ownerAdded':
      if (self) return `${actor} made themselves an owner`;
      return known ? `${actor} made ${subject} an owner` : `${Subject} was made an owner`;
    case 'ownerRemoved':
      if (self) return `${actor} stepped down as an owner`;
      return known
        ? `${actor} removed ${subject} as an owner`
        : `${Subject} stopped being an owner`;
    case 'columnAdded':
      return known
        ? `${actor} added the column ${quoted(e.to)}`
        : `The column ${quoted(e.to)} was added`;
    case 'columnRemoved':
      return known
        ? `${actor} removed the column ${quoted(e.from)}`
        : `The column ${quoted(e.from)} was removed`;
    case 'columnRenamed':
      return known
        ? `${actor} renamed the column ${quoted(e.from)} to ${quoted(e.to)}`
        : `The column ${quoted(e.from)} was renamed to ${quoted(e.to)}`;
    case 'columnsReordered':
      return known ? `${actor} reordered the columns` : 'The columns were reordered';
    case 'lanesOn':
      return known ? `${actor} turned lanes on` : 'Lanes were turned on';
    case 'lanesOff':
      return known ? `${actor} turned lanes off` : 'Lanes were turned off';
    case 'laneAdded':
      return known
        ? `${actor} added the lane ${quoted(e.to)}`
        : `The lane ${quoted(e.to)} was added`;
    case 'laneRemoved':
      return known
        ? `${actor} removed the lane ${quoted(e.from)}`
        : `The lane ${quoted(e.from)} was removed`;
    case 'laneRenamed':
      return known
        ? `${actor} renamed the lane ${quoted(e.from)} to ${quoted(e.to)}`
        : `The lane ${quoted(e.from)} was renamed to ${quoted(e.to)}`;
    case 'lanesReordered':
      return known ? `${actor} reordered the lanes` : 'The lanes were reordered';
    case 'finishedColumn':
      return known
        ? `${actor} set the finished column to ${quoted(e.to)}`
        : `The finished column was set to ${quoted(e.to)}`;
    case 'fieldAdded':
      return known
        ? `${actor} added the field ${quoted(e.to)}`
        : `The field ${quoted(e.to)} was added`;
    case 'fieldRemoved':
      return known
        ? `${actor} removed the field ${quoted(e.from)}`
        : `The field ${quoted(e.from)} was removed`;
    case 'fieldRenamed':
      return known
        ? `${actor} renamed the field ${quoted(e.from)} to ${quoted(e.to)}`
        : `The field ${quoted(e.from)} was renamed to ${quoted(e.to)}`;
    case 'fieldsReordered':
      return known ? `${actor} reordered the details` : 'The details were reordered';
    case 'detailChanged':
      if (e.to === undefined) {
        return known ? `${actor} cleared ${quoted(e.field)}` : `${quoted(e.field)} was cleared`;
      }
      return known
        ? `${actor} set ${quoted(e.field)} to ${quoted(shortValue(e.to))}`
        : `${quoted(e.field)} was set to ${quoted(shortValue(e.to))}`;
  }
}
