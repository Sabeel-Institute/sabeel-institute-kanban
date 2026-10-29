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
  'type' | 'subjectUid' | 'subjectName' | 'from' | 'to'
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
};

export function isKnownBoardActivityType(value: unknown): value is BoardActivityType {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(KNOWN_BOARD_ACTIVITY_TYPES, value)
  );
}

type Describable = Pick<
  BoardActivityDoc,
  'type' | 'actorUid' | 'actorName' | 'subjectUid' | 'subjectName' | 'from' | 'to'
>;

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
  }
}
