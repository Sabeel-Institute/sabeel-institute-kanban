import { isDeepStrictEqual } from 'node:util';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { addDoc, collection, doc, type Firestore } from 'firebase/firestore';
import { z } from 'zod';
import {
  addField, BOARD_COLORS, canEditBoardLabels, canManageBoard, columnsPatch, LABEL_COLORS,
  laneAddBlocked, lanesSwitchPatch, localId, newBoard, newLabel, renameColumn, renameField, renameLane,
  validateBoardName, validateColumnName, validateDetailValue, validateLabelName, validateLaneName, withCleanExtras,
  type BoardDoc, type BoardField, type Label,
} from '@sabeel/shared';
import { cloneBoardFor } from './boards';
import { agentEdit } from './agentActivity';
import { boardLink, check, itemNamed, named, ordered, word, writeResult, type McpActor, type WriteTools } from './mcpWrite';

const rename = z.object({ from: word, to: word }).strict();
const order = word.array().min(1);
const shape = z.object({
  add: word.array().max(30).optional(),
  rename: rename.array().max(30).optional(),
  order: order.describe('All names or ids, in their desired order').optional(),
});
const detailFields = z.object({
  add: z.object({
    name: word.optional(),
    type: z.enum(['text', 'number', 'date', 'link', 'start', 'end']),
  }).strict().array().max(20).optional(),
  rename: rename.array().max(20).optional(),
  order: order.optional(),
}).strict();
const labels = z.object({
  add: z.object({ name: word, color: z.enum(LABEL_COLORS).optional() }).strict().array().max(30).optional(),
  edit: z.object({ label: word, name: word.optional(), color: z.enum(LABEL_COLORS).optional() }).strict().array().max(30).optional(),
}).strict();
const boardChanges = {
  name: word.optional(),
  template: z.boolean().optional(),
  color: z.enum(BOARD_COLORS).nullable().optional()
    .describe('The stripe on the board in the Boards list, nowhere else. Null takes it off.'),
  columns: shape.strict().optional(),
  lanes: shape.extend({ enabled: z.boolean().optional(), finished_column: word.optional() }).strict().optional(),
  detail_fields: detailFields.optional(),
  details: z.record(word, z.string().nullable()).describe('Keys are field names or ids. Null clears a value.').optional(),
  members: z.object({
    add: word.array().max(30).optional(),
    make_owner: word.array().max(30).optional(),
  }).strict().optional(),
  labels: labels.optional(),
};
const changeSchema = z.object(boardChanges).strict();
type Changes = z.infer<typeof changeSchema>;

function changeBoardSettings(board: BoardDoc, f: Changes): Partial<BoardDoc> {
  const patch: Partial<BoardDoc> = {};
  if (f.name !== undefined) {
    check(validateBoardName(f.name));
    patch.name = f.name;
  }
  if (f.template !== undefined) patch.template = f.template;
  // Null takes the colour off, which is deleting the field; off already is nothing to write.
  if (f.color) patch.color = f.color;
  else if (f.color === null && board.color) patch.color = FieldValue.delete() as never;

  if (f.columns) {
    let columns = [...board.columns];
    for (const name of f.columns.add ?? []) {
      check(validateColumnName(name, columns));
      columns.push({ id: localId('col'), name });
    }
    for (const edit of f.columns.rename ?? []) {
      const next = renameColumn(columns, itemNamed(columns, edit.from, 'column').id, edit.to);
      if (!next.ok) throw new Error(next.error);
      columns = next.columns;
    }
    Object.assign(patch, columnsPatch(board, ordered(columns, f.columns.order, 'column')));
  }

  if (f.lanes) {
    let lanes = [...(board.lanes ?? [])];
    for (const name of f.lanes.add ?? []) {
      check(laneAddBlocked(lanes));
      check(validateLaneName(name, lanes));
      lanes.push({ id: localId('lane'), name });
    }
    for (const edit of f.lanes.rename ?? []) {
      const next = renameLane(lanes, itemNamed(lanes, edit.from, 'lane').id, edit.to);
      if (!next.ok) throw new Error(next.error);
      lanes = next.lanes;
    }
    patch.lanes = ordered(lanes, f.lanes.order, 'lane');
    if (f.lanes.enabled !== undefined) Object.assign(patch, lanesSwitchPatch({ ...board, ...patch }, f.lanes.enabled));
    if (f.lanes.finished_column) {
      patch.doneColumnId = itemNamed(patch.columns ?? board.columns, f.lanes.finished_column, 'column').id;
    }
  }

  let fields: BoardField[] = [...(board.fields ?? [])];
  if (f.detail_fields) {
    for (const field of f.detail_fields.add ?? []) {
      const next = addField(fields, field.type, field.name ?? '');
      if (!next.ok) throw new Error(next.error);
      fields = next.fields;
    }
    for (const edit of f.detail_fields.rename ?? []) {
      const next = renameField(fields, itemNamed(fields, edit.from, 'detail field').id, edit.to);
      if (!next.ok) throw new Error(next.error);
      fields = next.fields;
    }
    fields = ordered(fields, f.detail_fields.order, 'detail field');
    patch.fields = fields;
  }
  if (f.details) {
    const values = { ...board.details };
    const seen = new Set<string>();
    for (const [fieldName, value] of Object.entries(f.details)) {
      const field = itemNamed(fields, fieldName, 'detail field');
      if (seen.has(field.id)) throw new Error(`Give one value for "${field.name}".`);
      seen.add(field.id);
      const result = validateDetailValue(field.type, value ?? '');
      if (!result.ok) throw new Error(`${field.name}: ${result.error}`);
      if (result.value === null) delete values[field.id];
      else values[field.id] = result.value;
    }
    patch.details = values;
  }
  return patch;
}

const boardFieldNames: Record<string, string> = {
  columnIds: 'columns', lanesOn: 'lanes', doneColumnId: 'lanes', fields: 'detail_fields',
  memberUids: 'members', memberProfiles: 'members', boardOwnerUids: 'members',
};

/* Membership can only be written by the backend. Keep the mixed edit in one
 * transaction and apply the same board/label predicates as the app's rules. */
async function updateBoard(id: string, me: McpActor, f: Changes & { archived?: boolean }) {
  const db = getFirestore();
  const ref = db.doc(`boards/${id}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('That board is gone.');
    const board = withCleanExtras(snap.data()!) as unknown as BoardDoc;
    const { labels: requestedLabels, members, archived, ...settings } = f;
    const changesSettings = Object.values(settings).some((value) => value !== undefined) || members !== undefined || archived !== undefined;
    if (changesSettings && !canManageBoard(me, board)) throw new Error('Only a board owner or an admin can change board settings or membership.');
    if (requestedLabels && !canEditBoardLabels(me, board)) throw new Error('Only a board member or an admin can change its labels.');
    const now = Date.now();
    const patch = changeBoardSettings(board, settings);
    if (archived !== undefined && archived !== board.archived) patch.archived = archived;

    if (members) {
      const existingMembers = board.memberUids ?? [];
      const memberIds = new Set(existingMembers);
      const addedMembers: string[] = [];
      const ownerIds = new Set(board.boardOwnerUids);
      const profiles = { ...board.memberProfiles };
      if (members.add?.length) {
        const people = (await tx.get(db.collection('users').where('status', '==', 'active'))).docs;
        for (const person of members.add) {
          const d = named(people, person, 'eligible person', (p) => p.id, (p) => p.data().displayName ?? '');
          if (memberIds.has(d.id)) continue;
          memberIds.add(d.id);
          addedMembers.push(d.id);
          // A stale owner entry must never become effective just by rejoining.
          ownerIds.delete(d.id);
          profiles[d.id] = { displayName: d.data().displayName ?? '', email: d.data().email ?? '' };
        }
      }
      for (const person of members.make_owner ?? []) {
        const p = named([...memberIds], person.replace(/^@/, ''), 'board member', (uid) => uid,
          (uid) => profiles[uid]?.displayName ?? uid, (uid) => [profiles[uid]?.email?.split('@')[0] ?? '']);
        ownerIds.add(p);
      }
      if (addedMembers.length) {
        patch.memberUids = [...existingMembers, ...addedMembers];
        patch.memberProfiles = profiles;
      }
      if (!isDeepStrictEqual([...ownerIds], board.boardOwnerUids ?? [])) patch.boardOwnerUids = [...ownerIds];
    }

    const labelWrites: { id: string; value: Partial<Label>; create: boolean }[] = [];
    if (requestedLabels) {
      const available = (await tx.get(db.collection('labels'))).docs
        .map((d) => ({ ...d.data(), id: d.id }) as Label)
        .filter((label) => label.boardId === undefined || label.boardId === id);
      for (const edit of requestedLabels.edit ?? []) {
        const target = itemNamed(available, edit.label, 'label');
        if (target.boardId !== id) throw new Error(`"${target.name}" is an institute label. Select a board label.`);
        const name = edit.name ?? target.name;
        check(validateLabelName(name, available, target.id));
        const color = edit.color ?? target.color;
        if (name === target.name && color === target.color) continue;
        Object.assign(target, { name, color });
        labelWrites.push({ id: target.id, value: { name, color }, create: false });
      }
      for (const label of requestedLabels.add ?? []) {
        check(validateLabelName(label.name, available));
        const value = newLabel({ name: label.name, color: label.color ?? LABEL_COLORS[0], boardId: id, now, createdBy: me.uid });
        const labelId = db.collection('labels').doc().id;
        available.push({ ...value, id: labelId });
        labelWrites.push({ id: labelId, value, create: true });
      }
    }

    for (const key of Object.keys(patch) as (keyof BoardDoc)[]) {
      if (isDeepStrictEqual(patch[key], board[key])) delete patch[key];
    }
    if (Object.keys(patch).length) tx.update(ref, { ...patch, ...agentEdit(me.uid, now, board) });
    for (const write of labelWrites) {
      const labelRef = db.doc(`labels/${write.id}`);
      if (write.create) tx.create(labelRef, write.value);
      else tx.update(labelRef, write.value);
    }
    const changed = new Set(Object.keys(patch).map((key) => boardFieldNames[key] ?? key));
    if (labelWrites.length) changed.add('labels');
    return { id, name: patch.name ?? board.name, url: boardLink(id), changed: [...changed] };
  });
}

export function registerBoardWrites({ server, run, me, board }: WriteTools) {
  server.registerTool('create_board', {
    description: 'Create a blank board with the app’s default columns. Use clone_board when the person wants to start from an existing board or template. Returns the new board’s id and link.',
    inputSchema: { name: word },
  }, ({ name }) => run(async (fs: Firestore) => {
    check(validateBoardName(name));
    const now = Date.now();
    const data = newBoard({
      name, createdBy: me.uid, createdByProfile: { displayName: me.name, email: me.email }, now,
    });
    const saved = await addDoc(collection(fs, 'boards'), { ...data, agentAt: now });
    return writeResult({ id: saved.id, name, url: boardLink(saved.id) });
  }));

  server.registerTool('clone_board', {
    description: [
      'Start a new board from an active board or template. Available to organizers and admins.',
      'The signed-in person is the only initial board member and owner. Institute admins can see every board.',
      'Copies columns, lanes, board detail fields with blank values, and unarchived cards and their subtasks. Card assignees and due dates start empty.',
      'Subscriptions default to off. Use update_board with the new board id to fill detail values or add members when requested.',
    ].join(' '),
    inputSchema: {
      board: word.describe('Source board or template name or id'), name: word.describe('Name for the new board'),
      subscribe: z.boolean().optional().describe('Subscribe yourself to every cloned card. Default false.'),
      clone_id: z.string().regex(/^[A-Za-z0-9]{20}$/).optional().describe('Reuse a previously supplied id if retrying a clone. Usually omit.'),
    },
  }, (f) => run(async (fs) => {
    const source = await board(fs, f.board);
    const result = await cloneBoardFor(me, {
      boardId: source.id, name: f.name, cloneId: f.clone_id ?? doc(collection(fs, 'boards')).id,
      subscribe: f.subscribe, via: 'agent',
    });
    return writeResult({ id: result.boardId, name: result.name, url: boardLink(result.boardId) });
  }));

  server.registerTool('update_board', {
    description: 'Change any supplied board settings in one call. Omit the rest. Example: {"board":"Course","details":{"Start date":"2026-12-01","End date":null},"members":{"add":["Priya Patel"]}}.',
    inputSchema: changeSchema.extend({ board: word }).strict(),
  }, ({ board: key, ...f }) => run(async (fs) => writeResult(await updateBoard((await board(fs, key)).id, me, f))));

  server.registerTool('list_addable_people', {
    description: 'Find people eligible to be added to this board, by display name. Give the returned id to update_board members.add when needed.',
    inputSchema: { board: word, name: word.optional() },
  }, (f) => run(async (fs) => {
    const target = await board(fs, f.board);
    if (!canManageBoard(me, target)) throw new Error('Only a board owner or an admin can add members.');
    const people = (await getFirestore().collection('users').where('status', '==', 'active').get()).docs
      .map((d) => ({ id: d.id, name: (d.data().displayName as string) ?? '' }))
      .filter((p) => !target.memberUids?.includes(p.id) && (!f.name || p.name.toLowerCase().includes(f.name.toLowerCase())))
      .sort((a, b) => a.name.localeCompare(b.name));
    return writeResult({ board: target.name, total: people.length, people: people.slice(0, 50) });
  }));

  server.registerTool('set_board_archived', {
    description: 'Archive a board with archived:true or restore it with archived:false.',
    inputSchema: { board: word, archived: z.boolean() },
  }, (f) => run(async (fs) => writeResult({ ...await updateBoard((await board(fs, f.board)).id, me, { archived: f.archived }), archived: f.archived })));
}
