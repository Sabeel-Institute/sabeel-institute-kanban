import { localId, newBoard } from './boards';
import type { BoardColumn, BoardDoc, CardDoc } from './types';

/**
 * Copying a board: a new board laid out like the source, holding a fresh copy
 * of each of its open cards (Faisal, 2026-11-13, for program templates).
 *
 * A copy is a NEW board, so whoever copies is its only member and owner, as
 * when they press New board. A card keeps what a template means — its title,
 * its description, its place, the subtasks under it and the institute's labels
 * — and starts without what belongs to one run of the work: no due date, no
 * assignees, no priority, no comments, no history, no attachments. The source
 * board's own labels stay behind, as on a cross-board copy of a card.
 *
 * Pure, so the rules of a copy are unit-tested here and the `copyBoard`
 * callable only reads, checks and writes.
 */

/**
 * The most open cards one copy takes. The callable writes the board and every
 * card in ONE batch, so a copy either exists whole or not at all; this keeps
 * that batch inside Firestore's limit with room to spare. A template is a few
 * dozen cards.
 */
export const COPY_BOARD_MAX_CARDS = 450;

/** What a copy reads of each source card. */
export interface CopySourceCard {
  id: string;
  title: string;
  description: string;
  columnId: string;
  rank: string;
  labelIds: readonly string[];
  archived: boolean;
  parentId?: string;
}

export interface BoardCopy {
  board: BoardDoc;
  /** Each new card with the id it is written under, which `parentId` links use. */
  cards: { id: string; data: CardDoc }[];
}

export function boardCopy(params: {
  source: { description: string; columns: readonly BoardColumn[] };
  cards: readonly CopySourceCard[];
  /** Every label, so only the institute's are kept: a board's own has no `boardId` match on the copy. */
  labels: readonly { id: string; boardId?: string }[];
  /** The new board's document id, which every copied card names. */
  boardId: string;
  name: string;
  copier: string;
  copierProfile: { displayName: string; email: string };
  now: number;
  /** A fresh card document id. */
  newCardId: () => string;
}): BoardCopy {
  const { copier, now } = params;
  // Fresh column ids: a column belongs to one board, and nothing should be
  // able to mistake the copy's column for the template's.
  const columnIdFor = new Map(params.source.columns.map((c) => [c.id, localId('col')]));
  const columns = params.source.columns.map((c) => ({ id: columnIdFor.get(c.id)!, name: c.name }));
  const board: BoardDoc = {
    ...newBoard({
      name: params.name,
      createdBy: copier,
      createdByProfile: params.copierProfile,
      now,
    }),
    description: params.source.description,
    columns,
    columnIds: columns.map((c) => c.id),
  };

  const open = params.cards.filter((c) => !c.archived);
  const cardIdFor = new Map(open.map((c) => [c.id, params.newCardId()]));
  // Only a label that exists and has no board is the institute's. A deleted
  // label's id, and the template's own, stay behind.
  const institute = new Set(params.labels.filter((l) => !l.boardId).map((l) => l.id));
  const firstColumn = columns[0]?.id;

  const cards = open.map((c) => {
    // A card whose column has gone is not a state the app makes; it lands in
    // the first column rather than being dropped from the copy.
    const columnId = columnIdFor.get(c.columnId) ?? firstColumn;
    if (!columnId) throw new Error('The board has no columns to copy cards into.');
    // A subtask stays one when its parent is copied too; under an archived
    // parent, which is not, it becomes an ordinary card.
    const parentId = c.parentId ? cardIdFor.get(c.parentId) : undefined;
    const data: CardDoc = {
      boardId: params.boardId,
      title: c.title,
      description: c.description,
      columnId,
      rank: c.rank,
      assigneeUids: [],
      // The copier, as on any card they create: they are its only member.
      subscriberUids: [copier],
      priority: 'none',
      labelIds: c.labelIds.filter((id) => institute.has(id)),
      archived: false,
      commentCount: 0,
      attachmentCount: 0,
      createdAt: now,
      createdBy: copier,
      updatedAt: now,
      updatedBy: copier,
      ...(parentId ? { parentId } : {}),
    };
    return { id: cardIdFor.get(c.id)!, data };
  });
  return { board, cards };
}
