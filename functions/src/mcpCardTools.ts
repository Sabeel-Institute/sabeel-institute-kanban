import { isDeepStrictEqual } from 'node:util';
import {
  collection, deleteField, doc, getDoc, getDocsFromServer, query, runTransaction, where,
  type Firestore, type Transaction,
} from 'firebase/firestore';
import { z } from 'zod';
import {
  canBeSubtaskOf, CARD_DESCRIPTION_MAX, CARD_TITLE_MAX, commentMentions, compareRank, isRealDate,
  labelIdsAfterBoardChange, lanesLive, moveRefusalFor, newCardDoc, newCommentDoc, parentAfterMove,
  rankBetween, subtaskAddRefusal, withCleanExtras,
  type CardDoc, type Label,
} from '@sabeel/shared';
import { attachmentInputs, withAttachments } from './mcpAttachmentTools';
import { cardLink, check, docId, itemNamed, named, word, writeResult, type McpActor, type WriteBoard, type WriteTools } from './mcpWrite';

type Card = CardDoc & { id: string };
const ids = docId.array().min(1).max(20);
const list = word.array().max(30);
const priority = z.enum(['none', 'low', 'medium', 'high', 'urgent']);
const dueDate = z.string().refine(isRealDate, 'Use a real date in YYYY-MM-DD format');
const cardDetails = {
  description: z.string().max(CARD_DESCRIPTION_MAX).optional().describe('Markdown'),
  priority: priority.optional(),
  due_date: dueDate.nullable().optional().describe('YYYY-MM-DD, or null to clear'),
  assignees: list.optional().describe('Board member names, handles or ids. [] clears assignees.'),
  attachments: attachmentInputs.optional(),
};
const fields = z.object(cardDetails);
type CardDetails = z.infer<typeof fields>;

function cardRef(fs: Firestore, id: string) {
  return doc(fs, 'cards', id);
}

async function readCard(fs: Firestore, id: string, tx?: Transaction): Promise<Card> {
  const ref = cardRef(fs, id);
  const snap = await (tx ? tx.get(ref) : getDoc(ref));
  if (!snap.exists()) throw new Error(`No card "${id}". Use the id from query_cards.`);
  return { ...snap.data() as CardDoc, id };
}

async function readBoard(fs: Firestore, id: string, tx?: Transaction): Promise<WriteBoard> {
  const ref = doc(fs, 'boards', id);
  const snap = await (tx ? tx.get(ref) : getDoc(ref));
  if (!snap.exists()) throw new Error('That board is gone.');
  return { ...(withCleanExtras(snap.data()) as unknown as WriteBoard), id };
}

async function boardCards(fs: Firestore, boardId: string): Promise<Card[]> {
  const snapshots = await getDocsFromServer(query(collection(fs, 'cards'), where('boardId', '==', boardId)));
  return snapshots.docs.map((snap) => ({ ...snap.data() as CardDoc, id: snap.id }));
}

async function labelList(fs: Firestore): Promise<Label[]> {
  return (await getDocsFromServer(collection(fs, 'labels'))).docs.map((snap) => ({ ...snap.data() as Label, id: snap.id }));
}

function memberIds(board: WriteBoard, me: McpActor, people: string[]): string[] {
  const members = board.memberUids ?? [];
  const profile = (uid: string) => board.memberProfiles?.[uid];
  return [...new Set(people.map((person) => named(members, person.replace(/^@/, '') === 'me' ? me.uid : person.replace(/^@/, ''),
    'board member', (uid) => uid, (uid) => profile(uid)?.displayName ?? uid,
    (uid) => [profile(uid)?.email?.split('@')[0] ?? ''])))];
}

function findLabels(labels: Label[], boardId: string, names: string[]): string[] {
  const available = labels.filter((label) => !label.boardId || label.boardId === boardId);
  return [...new Set(names.map((name) => itemNamed(available, name, 'label').id))];
}

function detailPatch(f: CardDetails, board: WriteBoard, me: McpActor) {
  return {
    ...(f.description !== undefined ? { description: f.description.trim() } : {}),
    ...(f.priority !== undefined ? { priority: f.priority } : {}),
    ...(f.due_date !== undefined ? { dueDate: f.due_date ?? undefined } : {}),
    ...(f.assignees !== undefined ? { assigneeUids: memberIds(board, me, f.assignees) } : {}),
  };
}

function laneAt(board: WriteBoard, lane: string | null | undefined, required: boolean): string | undefined {
  if (!lanesLive(board)) {
    if (lane) throw new Error('Lanes are off on this board.');
    return undefined;
  }
  if (lane == null) {
    if (lane === undefined && required) {
      throw new Error(`Choose a lane: ${(board.lanes ?? []).map((l) => l.name).join(', ')}. Send lane:null for No lane.`);
    }
    return undefined;
  }
  return itemNamed(board.lanes ?? [], lane, 'lane').id;
}

function openBoard(board: WriteBoard) {
  if (board.archived) throw new Error(`Restore "${board.name}" before adding or moving cards there.`);
}

function lastRank(cards: Card[], columnId: string) {
  return cards.filter((c) => !c.archived && c.columnId === columnId).sort(compareRank).at(-1)?.rank ?? null;
}

function cardAnswer(card: Pick<Card, 'id' | 'title' | 'columnId' | 'laneId'>, board: WriteBoard) {
  const column = board.columns.find((item) => item.id === card.columnId)?.name;
  const lane = board.lanes?.find((item) => item.id === card.laneId)?.name;
  return { id: card.id, title: card.title, url: cardLink(card.id), board: board.name, column, lane };
}

const cardFieldNames: Record<string, string> = {
  dueDate: 'due_date', assigneeUids: 'assignees', labelIds: 'labels', parentId: 'parent_id',
};

async function checkParent(fs: Firestore, tx: Transaction, card: Card, parent: Card, cards: Card[], board: WriteBoard) {
  if (parent.boardId !== board.id) throw new Error('Choose a parent card on the same board.');
  if (card.parentId === parent.id) return;
  const known = new Set(cards.map((item) => item.id));
  const current = new Map([[card.id, card], [parent.id, parent]]);
  // Every live ancestor participates in the transaction so independent edits
  // on different links cannot both commit and close a cycle.
  let ancestor = parent.parentId;
  while (ancestor && known.has(ancestor) && !current.has(ancestor)) {
    const next = await readCard(fs, ancestor, tx);
    if (next.boardId !== board.id) break;
    current.set(next.id, next);
    ancestor = next.parentId;
  }
  check(canBeSubtaskOf([...current.values()], card.id, parent.id));
  check(subtaskAddRefusal({ board, parent, child: card }));
}

async function currentRelationships(fs: Firestore, tx: Transaction, selected: Card[], cards: Card[]): Promise<Card[]> {
  const live = new Map(selected.map((card) => [card.id, card]));
  const parents = new Set(selected.map((card) => card.parentId));
  const related = cards.filter((card) => !live.has(card.id) && (parents.has(card.id) || live.has(card.parentId ?? '')));
  for (const card of await Promise.all(related.map((card) => readCard(fs, card.id, tx)))) live.set(card.id, card);
  const boardId = selected[0].boardId;
  return [...live.values()].filter((card) => card.boardId === boardId);
}

function guardMove(board: WriteBoard, columnId: string, selected: Card[], cards: Card[]) {
  check(moveRefusalFor({ board, toColumnId: columnId, moving: selected, cards, parentOf: (id) => cards.find((c) => c.id === id) }));
}

const destination = {
  card_ids: ids,
  board: word.optional().describe('Destination board. Omit to stay on the source board.'),
  column: word,
  lane: word.nullable().optional().describe('Omit to keep the lane on the same board, or use null for No lane.'),
  before_card_id: docId.optional().describe('Insert before this card. Omit to place at the bottom.'),
  preview: z.boolean().optional().describe('Report destination and dropped labels or assignees without writing.'),
};
const destinationSchema = z.object(destination).strict();
type Destination = z.infer<typeof destinationSchema>;

async function transferCards(fs: Firestore, me: McpActor, board: WriteTools['board'], f: Destination, copy: boolean) {
  const first = await readCard(fs, f.card_ids[0]);
  const target = f.board ? await board(fs, f.board) : await readBoard(fs, first.boardId);
  const cross = first.boardId !== target.id;
  const [sourceCards, targetCards, labels] = await Promise.all([
    boardCards(fs, first.boardId),
    cross ? boardCards(fs, target.id) : Promise.resolve(null),
    cross ? labelList(fs) : Promise.resolve([]),
  ]);
  return runTransaction(fs, async (tx) => {
    const selected = await Promise.all([...new Set(f.card_ids)].map((id) => readCard(fs, id, tx)));
    if (selected.some((c) => c.boardId !== first.boardId || c.archived)) throw new Error('Choose open cards from one source board.');
    const dest = await readBoard(fs, target.id, tx);
    openBoard(dest);
    const column = itemNamed(dest.columns, f.column, 'column');
    const requestedLane = laneAt(dest, f.lane, false);
    selected.sort(compareRank);
    const moving = new Set(selected.map((c) => c.id));
    const siblings = (targetCards ?? sourceCards)
      .filter((c) => !c.archived && c.columnId === column.id && (copy || !moving.has(c.id)))
      .sort(compareRank);
    const at = f.before_card_id ? siblings.findIndex((c) => c.id === f.before_card_id) : siblings.length;
    if (at < 0) throw new Error('The placement card must be an open card in the destination column and outside the selection being moved.');
    if (!copy && !cross) guardMove(dest, column.id, selected, await currentRelationships(fs, tx, selected, sourceCards));
    const members = dest.memberUids ?? [];
    const now = Date.now();
    const next = siblings[at]?.rank ?? null;
    // Equal ranks are legal after concurrent app writes. Put the selection
    // before the tied group, without modifying anybody else's cards.
    const before = siblings.slice(0, at).reverse().find((card) => card.rank !== next);
    const after = siblings[at];
    for (const anchor of [before, after]) {
      if (!anchor) continue;
      const current = await readCard(fs, anchor.id, tx);
      if (current.boardId !== dest.id || current.columnId !== column.id || current.archived || current.rank !== anchor.rank) {
        throw new Error('The destination order changed. Retry the move or copy.');
      }
    }
    let prev = before?.rank ?? null;
    const results = selected.map((card) => {
      const rank = rankBetween(prev, next);
      prev = rank;
      const lane = f.lane === undefined && !cross ? card.laneId : requestedLane;
      const keepMembers = (uids: string[]) => uids.filter((uid) => members.includes(uid));
      const labelIds = cross ? labelIdsAfterBoardChange(card.labelIds, labels, dest.id) : card.labelIds;
      const assigneeUids = cross ? keepMembers(card.assigneeUids) : card.assigneeUids;
      const common = { boardId: dest.id, columnId: column.id, rank, labelIds, assigneeUids, updatedAt: now, updatedBy: me.uid };
      const ref = copy && !f.preview ? doc(collection(fs, 'cards')) : cardRef(fs, card.id);
      if (copy && !f.preview) {
        tx.set(ref, {
          ...newCardDoc({ boardId: dest.id, columnId: column.id, title: card.title, uid: me.uid, lastRank: null, subscribe: members.includes(me.uid), laneId: lane, now }),
          ...common,
          description: card.description,
          priority: card.priority,
          ...(card.dueDate ? { dueDate: card.dueDate } : {}),
        });
      } else if (!f.preview) {
        tx.update(ref, {
          ...common,
          laneId: lane ?? deleteField(),
          ...(cross ? {
            parentId: parentAfterMove(card, moving) ?? deleteField(),
            subscriberUids: keepMembers(card.subscriberUids ?? []),
          } : {}),
        });
      }
      return {
        ...cardAnswer({ id: ref.id, title: card.title, columnId: column.id, laneId: lane }, dest),
        ...(cross ? {
          dropped_labels: card.labelIds.filter((id) => !labelIds.includes(id)).map((id) => labels.find((label) => label.id === id)?.name ?? id),
          unassigned: card.assigneeUids.filter((uid) => !assigneeUids.includes(uid)),
        } : {}),
      };
    });
    return { cards: results, ...(f.preview ? { preview: true } : {}) };
  });
}

function commentPeople(board: WriteBoard) {
  return Object.entries(board.memberProfiles ?? {}).map(([uid, p]) => ({ uid, email: p.email ?? '', displayName: p.displayName ?? '' }));
}

export function registerCardWrites({ server, run, me, board }: WriteTools, base: string) {
  server.registerTool('add_card', {
    description: 'Create a card with any known details in one call. On a board with lanes, choose a lane or send null for No lane. Use parent_id to create a subtask.',
    inputSchema: fields.extend({
      board: word, title: word.max(CARD_TITLE_MAX), column: word, lane: word.nullable().optional(),
      labels: list.optional(), parent_id: docId.optional(),
      subscribe: z.boolean().optional().describe('Subscribe yourself to the new card. Default true for board members.'),
    }).strict(),
  }, ({ board: key, ...f }) => run(async (fs) => {
    const target = await board(fs, key);
    const labels = f.labels ? await labelList(fs) : [];
    const cards = await boardCards(fs, target.id);
    const saved = await runTransaction(fs, async (tx) => {
      const dest = await readBoard(fs, target.id, tx);
      openBoard(dest);
      const column = itemNamed(dest.columns, f.column, 'column');
      const lane = laneAt(dest, f.lane, true);
      const parent = f.parent_id ? await readCard(fs, f.parent_id, tx) : undefined;
      if (parent) {
        if (parent.boardId !== dest.id) throw new Error('Choose a parent card on the same board.');
        check(subtaskAddRefusal({ board: dest, parent }));
      }
      const member = dest.memberUids?.includes(me.uid) ?? false;
      if (f.subscribe && !member) throw new Error('Only a board member can subscribe to a card.');
      const now = Date.now();
      const ref = doc(collection(fs, 'cards'));
      const { dueDate: _dueDate, ...details } = detailPatch(f, dest, me);
      tx.set(ref, {
        ...newCardDoc({ boardId: dest.id, columnId: column.id, title: f.title, uid: me.uid, lastRank: lastRank(cards, column.id), subscribe: f.subscribe ?? member, laneId: lane, now }),
        ...details,
        ...(f.due_date ? { dueDate: f.due_date } : {}),
        ...(f.labels ? { labelIds: findLabels(labels, dest.id, f.labels) } : {}),
        ...(parent ? { parentId: parent.id } : {}),
      });
      return { ...cardAnswer({ id: ref.id, title: f.title, columnId: column.id, laneId: lane }, dest), added: ref.id };
    });
    return writeResult(await withAttachments(base, me, saved, f.attachments));
  }));

  server.registerTool('update_card', {
    description: 'Edit one or more fields on a card. Example: {"card_id":"…","due_date":"2026-12-03"}. Omit unchanged fields. Use card_ids for the same edit on several cards from one board.',
    inputSchema: fields.extend({
      card_id: docId.optional().describe('One card id. Use either card_id or card_ids.'),
      card_ids: ids.optional().describe('Several card ids from the same board. Use for bulk edits.'),
      title: word.max(CARD_TITLE_MAX).optional(),
      labels: z.object({ add: list.optional(), remove: list.optional() }).strict().optional(),
      parent_id: docId.nullable().optional(),
    }).strict(),
  }, (f) => run(async (fs) => {
    if (Boolean(f.card_id) === Boolean(f.card_ids)) throw new Error('Supply either card_id or card_ids.');
    const selected = f.card_id ? [f.card_id] : [...new Set(f.card_ids!)];
    if (selected.length > 1 && (f.attachments || f.parent_id !== undefined)) {
      throw new Error('Set a parent or add attachments on one card at a time.');
    }
    const initial = await readCard(fs, selected[0]);
    const [labels, cards] = await Promise.all([
      f.labels ? labelList(fs) : Promise.resolve([]),
      f.parent_id ? boardCards(fs, initial.boardId) : Promise.resolve([]),
    ]);
    const saved = await runTransaction(fs, async (tx) => {
      const current = await Promise.all(selected.map((id) => readCard(fs, id, tx)));
      if (current.some((card) => card.boardId !== initial.boardId)) throw new Error('Choose cards from one board.');
      const target = await readBoard(fs, initial.boardId, tx);
      const parent = f.parent_id ? await readCard(fs, f.parent_id, tx) : undefined;
      const adding = findLabels(labels, target.id, f.labels?.add ?? []);
      const removing = findLabels(labels, target.id, f.labels?.remove ?? []);
      if (adding.some((id) => removing.includes(id))) throw new Error('A label cannot be added and removed in the same edit.');
      const details = detailPatch(f, target, me);
      if (parent) await checkParent(fs, tx, current[0], parent, cards, target);
      return current.map((card) => {
        const patch: Record<string, unknown> = { ...details };
        if (f.title !== undefined) patch.title = f.title;
        if (f.labels) patch.labelIds = [...new Set([...card.labelIds, ...adding])].filter((id) => !removing.includes(id));
        if (f.parent_id !== undefined) {
          patch.parentId = f.parent_id ?? undefined;
        }
        const entries = Object.entries(patch).filter(([key, value]) => !isDeepStrictEqual(card[key as keyof Card], value));
        const changed = entries.map(([key]) => key);
        if (changed.length) {
          const updates = Object.fromEntries(entries.map(([key, value]) => [key, value === undefined ? deleteField() : value]));
          tx.update(cardRef(fs, card.id), { ...updates, updatedAt: Date.now(), updatedBy: me.uid });
        }
        return { ...cardAnswer({ ...card, title: f.title ?? card.title }, target), changed: changed.map((key) => cardFieldNames[key] ?? key) };
      });
    });
    if (saved.length > 1) return writeResult({ cards: saved });
    return writeResult(await withAttachments(base, me, saved[0], f.attachments));
  }));

  server.registerTool('move_cards', {
    description: 'Move one or more open cards into a column on this board or another. A cross-board move keeps the card id, history, comments and attachments. Access follows the destination board. Use preview:true to see which labels and assignees would be dropped.',
    inputSchema: destinationSchema,
  }, (f) => run(async (fs) => writeResult(await transferCards(fs, me, board, f, false))));

  server.registerTool('copy_cards', {
    description: 'Make new cards in a column on this board or another. Copies carry the title, description, priority and due date. Files, comments, history and parent links stay with the originals. Across boards, copies keep institute labels and assignees who belong to the destination board.',
    inputSchema: destinationSchema,
  }, (f) => run(async (fs) => writeResult(await transferCards(fs, me, board, f, true))));

  server.registerTool('set_cards_archived', {
    description: 'Archive or restore one or more cards from one board. Send archived:true to archive and archived:false to restore.',
    inputSchema: { card_ids: ids, archived: z.boolean() },
  }, (f) => run(async (fs) => {
    const initial = await readCard(fs, f.card_ids[0]);
    const all = await boardCards(fs, initial.boardId);
    const result = await runTransaction(fs, async (tx) => {
      const cards = await Promise.all([...new Set(f.card_ids)].map((id) => readCard(fs, id, tx)));
      if (cards.some((c) => c.boardId !== initial.boardId)) throw new Error('Choose cards from one board.');
      const target = await readBoard(fs, initial.boardId, tx);
      if (!f.archived) openBoard(target);
      const fallback = target.columns[0];
      if (!fallback) throw new Error('Add a column to this board before changing its cards.');
      const placements = cards.map((card) => ({ card, column: target.columns.find((c) => c.id === card.columnId) ?? fallback }));
      if (!f.archived) {
        const current = await currentRelationships(fs, tx, cards, all);
        const restored = new Map(current.map((card) => [card.id, card]));
        for (const { card, column } of placements) {
          restored.set(card.id, { ...card, archived: false, columnId: column.id });
        }
        const afterRestore = [...restored.values()];
        for (const { card, column } of placements) {
          if (card.archived) guardMove(target, column.id, [card], afterRestore);
        }
      }
      const now = Date.now();
      let movedRank: string | null = null;
      return placements.map(({ card, column }) => {
        if ((card.archived === true) !== f.archived) {
          const patch: Record<string, unknown> = { archived: f.archived, archivedAt: f.archived ? now : deleteField(), updatedAt: now, updatedBy: me.uid };
          if (!f.archived && column.id !== card.columnId) {
            movedRank = rankBetween(movedRank ?? lastRank(all, column.id), null);
            Object.assign(patch, { columnId: column.id, rank: movedRank });
          }
          tx.update(cardRef(fs, card.id), patch);
        }
        return cardAnswer({ ...card, columnId: column.id }, target);
      });
    });
    return writeResult({ cards: result, archived: f.archived });
  }));

  server.registerTool('comment', {
    description: 'Post a comment, or edit your own comment by passing comment_id. Markdown and @mentions work as in the app.',
    inputSchema: { card_id: docId, text: word.max(5000), comment_id: docId.optional() },
  }, (f) => run(async (fs) => {
    const path = collection(fs, 'cards', f.card_id, 'comments');
    const ref = f.comment_id ? doc(path, f.comment_id) : doc(path);
    const now = Date.now();
    const card = await runTransaction(fs, async (tx) => {
      const current = await readCard(fs, f.card_id, tx);
      const target = await readBoard(fs, current.boardId, tx);
      const candidates = commentPeople(target);
      if (f.comment_id) {
        const existing = await tx.get(ref);
        if (!existing.exists() || existing.data().authorUid !== me.uid) throw new Error('You can only edit your own comments.');
        if (existing.data().body !== f.text) {
          tx.update(ref, { body: f.text, mentionUids: commentMentions(me.uid, f.text, candidates), editedAt: now });
        }
      } else {
        tx.set(ref, newCommentDoc({ authorUid: me.uid, body: f.text, candidates, now }));
      }
      return current;
    });
    return writeResult({ commented: ref.id, on: card.title, url: cardLink(card.id), edited: !!f.comment_id });
  }));
}
