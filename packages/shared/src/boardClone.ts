import { SYSTEM_ACTOR } from './activity';
import { localId, newBoard } from './boards';
import type { BoardColumn, BoardDoc, CardDoc } from './types';

/**
 * Cloning a board: a new board laid out like the source, holding a fresh copy
 * of each of its open cards (Faisal, 2026-11-13, for program templates).
 *
 * A clone is a NEW board, so whoever clones is its only member and owner, as
 * when they press New board. A card keeps what a template means — its title,
 * its description, its place, the subtasks under it and the institute's labels
 * — and starts without what belongs to one run of the work: no due date, no
 * assignees, no priority, no comments, no attachments, and a history of one
 * line, its creation. The source board's own labels stay behind, as on a
 * cross-board copy of a card.
 *
 * THE CLONE KEEPS ITS OWN BOOKS. Left to the card triggers, every cloned card
 * would add one to the new board's `activeCardCount`, write its own "created"
 * line and its own Stats increment: hundreds of writes landing on the same
 * few documents in the same second, which Firestore answers with contention
 * failures the triggers cannot recover from. The clone knows every one of those
 * figures exactly, so it writes them itself — the count and the history with
 * the cards, Stats once after — and stamps the cards `SYSTEM_ACTOR`, which
 * keeps the two counting triggers, `onCardWritten` and `onCardBoardCount`, out
 * of them. The others still run: `onCardNotify` finds nobody newly assigned,
 * since a clone assigns nobody, and each "created" line joins a pending notice
 * that the sweep reads and sends nothing for, as a new column has no watchers.
 *
 * Pure, so the rules of a clone are unit-tested here and the `cloneBoard`
 * callable only reads, checks and writes.
 */

/**
 * The most open cards one clone takes. The callable writes the board, each card
 * and each card's "created" line in ONE transaction, so a clone exists whole or
 * not at all; that is 1 + 2n writes, inside Firestore's 500 with room to spare.
 * A template is a few dozen cards.
 */
export const CLONE_BOARD_MAX_CARDS = 240;

/**
 * The most a clone may write, in bytes. Firestore refuses a commit over 10 MiB,
 * and that counts BYTES: a description may hold 20,000 characters, and Arabic,
 * curly quotes and dashes are two or three bytes each, so the card cap alone
 * does not keep a clone under it.
 */
export const CLONE_BOARD_MAX_BYTES = 8 * 1024 * 1024;

/** What a clone reads of each source card. */
export interface CloneSourceCard {
  id: string;
  title: string;
  description: string;
  columnId: string;
  rank: string;
  labelIds: readonly string[];
  archived: boolean;
  parentId?: string;
}

/** A card's first history line, as `onCardWritten` would have written it. */
export interface CloneCreatedEntry {
  type: 'created';
  actorUid: string;
  at: number;
}

export interface BoardClone {
  /** The new board, its `activeCardCount` already the number of cards. */
  board: BoardDoc;
  /** Each new card with the id it is written under, which `parentId` links use. */
  cards: { id: string; data: CardDoc; created: CloneCreatedEntry }[];
}

export function boardClone(params: {
  source: { description: string; columns: readonly BoardColumn[] };
  cards: readonly CloneSourceCard[];
  /** Every label, so only the institute's are kept: a board's own has no `boardId` match on the clone. */
  labels: readonly { id: string; boardId?: string }[];
  /** The new board's document id, which every cloned card names. */
  boardId: string;
  name: string;
  cloner: string;
  copierProfile: { displayName: string; email: string };
  now: number;
  /** A fresh card document id. */
  newCardId: () => string;
}): BoardClone {
  const { cloner, now } = params;
  // Fresh column ids: a column belongs to one board, and nothing should be
  // able to mistake the clone's column for the template's.
  const columnIdFor = new Map(params.source.columns.map((c) => [c.id, localId('col')]));
  const columns = params.source.columns.map((c) => ({ id: columnIdFor.get(c.id)!, name: c.name }));

  const open = params.cards.filter((c) => !c.archived);
  const cardIdFor = new Map(open.map((c) => [c.id, params.newCardId()]));
  // Only a label that exists and has no board is the institute's. A deleted
  // label's id, and the template's own, stay behind.
  const institute = new Set(params.labels.filter((l) => !l.boardId).map((l) => l.id));
  const firstColumn = columns[0]?.id;

  const cards = open.map((c) => {
    // A card whose column has gone is not a state the app makes; it lands in
    // the first column rather than being dropped from the clone.
    const columnId = columnIdFor.get(c.columnId) ?? firstColumn;
    if (!columnId) throw new Error('The board has no columns to clone cards into.');
    // A subtask stays one when its parent is cloned too; under an archived
    // parent, which is not, it becomes an ordinary card.
    const parentId = c.parentId ? cardIdFor.get(c.parentId) : undefined;
    const data: CardDoc = {
      boardId: params.boardId,
      title: c.title,
      description: c.description,
      columnId,
      rank: c.rank,
      assigneeUids: [],
      // The cloner, as on any card they create: they are its only member.
      subscriberUids: [cloner],
      priority: 'none',
      labelIds: c.labelIds.filter((id) => institute.has(id)),
      archived: false,
      commentCount: 0,
      attachmentCount: 0,
      createdAt: now,
      createdBy: cloner,
      updatedAt: now,
      // The clone keeps its own books (above). The cloner is named where a
      // person reads it: `createdBy`, and the history line below.
      updatedBy: SYSTEM_ACTOR,
      ...(parentId ? { parentId } : {}),
    };
    const created: CloneCreatedEntry = { type: 'created', actorUid: cloner, at: now };
    return { id: cardIdFor.get(c.id)!, data, created };
  });

  const board: BoardDoc = {
    ...newBoard({
      name: params.name,
      createdBy: cloner,
      createdByProfile: params.copierProfile,
      now,
    }),
    description: params.source.description,
    columns,
    columnIds: columns.map((c) => c.id),
    activeCardCount: cards.length,
  };
  return { board, cards };
}

/**
 * Roughly how many bytes a clone writes, for `CLONE_BOARD_MAX_BYTES`: every
 * string in UTF-8, plus a generous allowance per document for field names and
 * the rest. An over-estimate by design — refusing a clone that would just have
 * fitted is a message, and one that does not fit is a failed write.
 */
export function boardCloneBytes(clone: BoardClone): number {
  const bytes = (value: unknown) => utf8Length(JSON.stringify(value));
  const PER_DOCUMENT = 512;
  return (
    bytes(clone.board) +
    PER_DOCUMENT +
    clone.cards.reduce((sum, c) => sum + bytes(c.data) + bytes(c.created) + 2 * PER_DOCUMENT, 0)
  );
}

/** How many bytes `text` takes in UTF-8, the encoding Firestore sizes strings in. */
export function utf8Length(text: string): number {
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    n += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return n;
}
