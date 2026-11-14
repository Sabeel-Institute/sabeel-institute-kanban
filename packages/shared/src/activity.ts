import type { ActivityType, CardDoc } from './types';

/**
 * Diffing a card write into activity entries. Pure, so it can be tested
 * exhaustively without an emulator; the trigger performs the effects.
 */

export interface ActivityEntry {
  type: ActivityType;
  from?: string;
  to?: string;
}

/** A card as the trigger sees it — every field optional, since old docs vary. */
export type CardSnapshot = Partial<CardDoc>;

function sameSet(a: readonly string[] = [], b: readonly string[] = []): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

/**
 * What changed, as loggable events.
 *
 * The important omission is `rank`. A reorder within a column is a rank-only
 * write, and logging those would make a busy board's history 100% noise that
 * nobody reads — which would then hide the changes that matter. A COLUMN change
 * is logged, because "who moved this to Done?" is the question the history
 * exists to answer.
 *
 * `updatedAt`/`updatedBy` are likewise ignored: they change on every write by
 * definition and carry no information of their own.
 */
export function diffCard(
  before: CardSnapshot | null,
  after: CardSnapshot | null,
): ActivityEntry[] {
  // Deletion leaves nothing to attach history to — the subcollection goes with it.
  if (!after) return [];
  if (!before) return [{ type: 'created' }];

  const out: ActivityEntry[] = [];

  if (before.columnId !== after.columnId) {
    out.push({ type: 'moved', from: before.columnId, to: after.columnId });
  }

  if (Boolean(before.archived) !== Boolean(after.archived)) {
    out.push({
      type: 'archived',
      from: String(Boolean(before.archived)),
      to: String(Boolean(after.archived)),
    });
  }

  // Assignment is reported per person, so "Sara was assigned" reads as an event
  // rather than as a diff of two lists.
  const beforeAssignees = before.assigneeUids ?? [];
  const afterAssignees = after.assigneeUids ?? [];
  for (const uid of afterAssignees) {
    if (!beforeAssignees.includes(uid)) out.push({ type: 'assigned', to: uid });
  }
  for (const uid of beforeAssignees) {
    if (!afterAssignees.includes(uid)) out.push({ type: 'unassigned', to: uid });
  }

  if (before.dueDate !== after.dueDate) {
    out.push({ type: 'due', from: before.dueDate, to: after.dueDate });
  }

  if (before.priority !== after.priority) {
    out.push({ type: 'priority', from: before.priority, to: after.priority });
  }

  if (!sameSet(before.labelIds, after.labelIds)) {
    out.push({ type: 'labels' });
  }

  // A subtask link. Logged because it changes what a card MEANS, not just how
  // it looks — unlike `rank`, which is deliberately ignored as noise.
  if (before.parentId !== after.parentId) {
    out.push({ type: 'subtaskOf', from: before.parentId, to: after.parentId });
  }

  // Title and description collapse into one "edited" event: three entries for a
  // single save would pad the timeline without telling anyone more.
  if (before.title !== after.title || before.description !== after.description) {
    out.push({
      type: 'edited',
      from: before.title !== after.title ? before.title : undefined,
      to: before.title !== after.title ? after.title : undefined,
    });
  }

  return out;
}

/**
 * Every type this build knows how to describe.
 *
 * Derived from the same union the switch below is exhaustive over, so it cannot
 * drift. It exists because a client running an OLDER bundle can receive a type
 * added since — `describeActivity` would fall off the end of its switch and
 * return undefined, printing an actor's name followed by nothing. Web is
 * low-risk (Hosting sends no-cache) but an Android user on a previous APK is
 * not, and there is no version of that story where a blank line is acceptable.
 */
const KNOWN_ACTIVITY_TYPES: Record<ActivityType, true> = {
  created: true,
  moved: true,
  assigned: true,
  unassigned: true,
  due: true,
  priority: true,
  labels: true,
  edited: true,
  archived: true,
  subtaskOf: true,
  subtask: true,
  attached: true,
  detached: true,
};

/**
 * Whether this build can describe `value`.
 *
 * Deliberately NOT a `default:` arm inside `describeActivity` — that would
 * destroy the exhaustiveness check, which is the thing that makes adding a type
 * a compile error until it is given words.
 */
export function isKnownActivityType(value: unknown): value is ActivityType {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(KNOWN_ACTIVITY_TYPES, value)
  );
}

/**
 * The actor of a change nobody can be named for. Not a uid, so every name
 * lookup reads it as "Someone", nobody is mistaken for its author, and Stats
 * never counts it as a person.
 */
export const UNKNOWN_ACTOR = 'unknown';

/**
 * `updatedBy` on a card write the server makes that KEEPS ITS OWN BOOKS: the
 * card triggers stay out of it — no history from `onCardWritten`, so nobody is
 * told, no Stats, and no change to the board's `activeCardCount` from
 * `onCardBoardCount` — and whatever of those the write needs, its writer has
 * written. Two writers use it:
 *
 *  - `scripts/scope-labels.mjs`, moving a card onto its board's copy of a
 *    label, same name and colour: nothing a person sees changed, so it needs
 *    none of them.
 *  - `cloneBoard`, whose hundreds of cards would otherwise land as hundreds of
 *    increments on one board's count and one day's Stats in the same second
 *    (`boardClone`): it writes the count and each card's "created" line with
 *    the cards, and Stats once.
 *
 * Rules pin a client's `updatedBy` to its own uid, so only the server can
 * write this, and a person's next edit to the card stamps it away again.
 */
export const SYSTEM_ACTOR = 'system';

/** Human-readable line for the timeline. `nameFor` resolves uids. */
export function describeActivity(
  entry: { type: ActivityType; from?: string; to?: string },
  nameFor: (uid: string) => string,
  columnNameFor: (columnId: string) => string,
  /** Resolves a card id to its title. Subtask entries store the OTHER card's
   *  id rather than its title, so a rename never leaves stale history — the
   *  same reason `moved` stores a column id. */
  cardTitleFor: (cardId: string) => string = () => 'another card',
): string {
  switch (entry.type) {
    case 'created':
      return 'created this card';
    case 'moved':
      return `moved it to ${columnNameFor(entry.to ?? '')}`;
    case 'assigned':
      return `assigned ${nameFor(entry.to ?? '')}`;
    case 'unassigned':
      return `unassigned ${nameFor(entry.to ?? '')}`;
    case 'due':
      return entry.to ? `set the due date to ${entry.to}` : 'cleared the due date';
    case 'priority':
      return `set priority to ${entry.to ?? 'none'}`;
    case 'labels':
      return 'changed the labels';
    case 'edited':
      return entry.to ? `renamed it to “${entry.to}”` : 'edited the description';
    case 'archived':
      return entry.to === 'true' ? 'archived it' : 'restored it';
    case 'subtaskOf':
      return entry.to
        ? `made this a subtask of ${cardTitleFor(entry.to)}`
        : `removed this from ${cardTitleFor(entry.from ?? '')}`;
    case 'subtask':
      return entry.to
        ? `added ${cardTitleFor(entry.to)} as a subtask`
        : `removed ${cardTitleFor(entry.from ?? '')} as a subtask`;
    // Attachment entries carry the file NAME rather than an id: there is
    // nothing left to resolve it against once the file is gone, which is
    // exactly when the line matters.
    case 'attached':
      return `attached ${entry.to ?? 'a file'}`;
    case 'detached':
      return `removed ${entry.from ?? 'a file'}`;
  }
}
