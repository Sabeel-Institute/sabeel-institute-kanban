// ClickUp CSV → Sabeel Kanban importer.
//
// Reuses the tested mapping logic in @sabeel/shared (status→column, priority,
// due date, idempotent sourceId) and writes boards/cards/comments with the
// Admin SDK. A card's doc id is its ClickUp task id, so re-running UPDATES the
// card rather than duplicating it — and it merges, so anything the team has
// since put on that card survives: assignees, labels, subscribers, and the
// counters the triggers own (`commentCount`, `attachmentCount`,
// `lastActivityAt`). A replacing write would silently take all of those away.
//
// COMMENTS ARE NOT IDEMPOTENT. They are added with generated ids, so a second
// run posts every comment again. Re-running against a board that already has
// them is a duplication, not a refresh.
//
// Decisions locked with Faisal for this dataset:
//   - 3 boards, one per ClickUp List: Ideas / Action Items / Fundraiser.
//   - Completed tasks → the Done column (not archived).
//   - Assignees → recorded as TEXT in the description (no account mapping yet).
//   - Attachments → filenames NOTED in the description; files not stored.
//   - Subtasks → their own cards (keeps each one's status/due/comments), with a
//     "Subtask of:" line; the parent lists them.
//   - Comments → real comments, authored by the importer, each body prefixed
//     with the original author + date (no @mention resolution).
//
// Usage:
//   # DRY RUN (default): parses + prints the plan, writes NOTHING, needs no project.
//   node scripts/import-clickup.mjs
//
//   # APPLY to the emulators:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports firestore) FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports auth) \
//   GCLOUD_PROJECT=demo-sabeel-kanban node scripts/import-clickup.mjs --apply
//
//   # APPLY to production (needs gcloud ADC / GOOGLE_APPLICATION_CREDENTIALS):
//   GCLOUD_PROJECT=<prod-project-id> node scripts/import-clickup.mjs --apply
//
// Writing is OPT-IN: without --apply this is a preview. --apply also requires
// GCLOUD_PROJECT to be set explicitly, so it can never fall back to whatever
// project gcloud ADC happens to point at.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  newBoard,
  initialRanks,
  matchStatus,
  mapPriority,
  mapDueDate,
  sourceIdFor,
  DEFAULT_COLUMNS,
} from '@sabeel/shared';

// Dry-run is the DEFAULT. Writing to Firestore requires an explicit --apply, so a
// bare `node scripts/import-clickup.mjs` can never mutate data by accident.
const DRY = !process.argv.includes('--apply');
const CSV = resolve(process.cwd(), process.env.CLICKUP_CSV ?? 'migration/clickup-export.csv');
const ADMIN_EMAIL = process.env.IMPORT_ADMIN_EMAIL ?? 'faisal@oursabeel.com';

// ---- RFC4180 CSV parser (fields may hold commas, newlines, doubled quotes) --
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])));
}

const jsonOr = (s, fallback) => {
  const t = (s ?? '').trim();
  if (!t || t === 'null') return fallback;
  try { return JSON.parse(t); } catch { return fallback; }
};
// Assignees come as "[Name, email, Name]" — NOT valid JSON (names unquoted).
const peopleList = (s) => {
  let t = (s ?? '').trim();
  if (t.startsWith('[') && t.endsWith(']')) t = t.slice(1, -1);
  return t.split(',').map((x) => x.trim()).filter(Boolean);
};

const decodeAttName = (t) => { try { return decodeURIComponent(t); } catch { return t; } };
const BOILERPLATE = 'A brief description of the task detailing';
function cleanContent(s) {
  // ClickUp is inconsistent: some Task Content fields hold LITERAL "\n" (a
  // backslash and an n), others hold real newlines. Normalise the literal ones.
  // (Comments don't need this — they arrive as JSON and decode to real newlines.)
  const t = (s ?? '').replace(/\\r\\n|\\n/g, '\n').trim();
  return t.includes(BOILERPLATE) ? '' : t;
}

function boardNameFor(row) {
  const list = row['List Name'].trim();
  if (list && list.toLowerCase() !== 'list') return list; // Ideas, Action Items
  return row['Space Name'].replace(/^SI\s+/i, '').trim() || 'Imported'; // "SI Fundraiser" → Fundraiser
}

// ---- Build the model --------------------------------------------------------
const rows = parseCsv(readFileSync(CSV, 'utf8'));
const byId = new Map(rows.map((r) => [r['Task ID'], r]));

function buildDescription(r) {
  const parts = [];
  const body = cleanContent(r['Task Content']);
  if (body) parts.push(body);

  const meta = [];
  const parent = r['Parent ID'] && r['Parent ID'] !== 'null' ? byId.get(r['Parent ID']) : null;
  if (parent) meta.push(`Subtask of: ${parent['Task Name']}`);

  const kids = rows.filter((x) => x['Parent ID'] === r['Task ID']);
  if (kids.length) {
    meta.push('Subtasks:');
    for (const k of kids) meta.push(`  - ${k['Task Name']} (${k['Status']})`);
  }

  const assignees = peopleList(r['Assignees']);
  if (assignees.length) meta.push(`Assigned in ClickUp: ${assignees.join(', ')}`);

  const checklists = jsonOr(r['Checklists'], {});
  for (const [name, items] of Object.entries(checklists)) {
    if (Array.isArray(items) && items.length) {
      meta.push(`${name}:`);
      for (const it of items) meta.push(`  - ${it}`);
    }
  }

  const atts = jsonOr(r['Attachments'], []);
  if (atts.length) {
    meta.push('Attachments (were in ClickUp, not stored here):');
    for (const a of atts) meta.push(`  - ${decodeAttName(a.title)}`);
  }

  if (meta.length) parts.push('— From ClickUp —\n' + meta.join('\n'));
  return parts.join('\n\n');
}

function commentDate(c, fallback) {
  const t = Date.parse((c.date ?? '').replace(/\s+[A-Z]{2,4}$/, '')); // drop trailing TZ abbr
  return Number.isNaN(t) ? fallback : t;
}

// Group rows into boards → columns
const boards = new Map();
for (const r of rows) {
  const bn = boardNameFor(r);
  if (!boards.has(bn)) boards.set(bn, []);
  boards.get(bn).push(r);
}

// ---- Plan summary -----------------------------------------------------------
const columnNames = [...DEFAULT_COLUMNS];
console.log(`Parsed ${rows.length} tasks → ${boards.size} boards\n`);
const plan = [];
for (const [bn, brows] of boards) {
  const cols = {};
  for (const r of brows) {
    const col = matchStatus(r['Status'], columnNames).column ?? 'To Do';
    (cols[col] ??= []).push(r);
  }
  const counts = columnNames.map((c) => `${c}:${(cols[c] ?? []).length}`).join('  ');
  const comments = brows.reduce((n, r) => n + jsonOr(r['Comments'], []).length, 0);
  console.log(`  ${bn.padEnd(16)} ${brows.length} cards  [${counts}]  ${comments} comments`);
  plan.push({ bn, brows, cols });
}

if (DRY) {
  console.log('\n--- DRY RUN: sample cards ---');
  for (const { bn, brows } of plan) {
    const r = brows[0];
    console.log(`\n[${bn}] "${r['Task Name']}"  status=${r['Status']} prio=${mapPriority(r['Priority'])} due=${mapDueDate(r['Due Date'])}`);
    const d = buildDescription(r);
    console.log(d ? d.split('\n').map((l) => '   ' + l).join('\n') : '   (no description)');
  }
  console.log('\n(dry run — nothing written). Re-run with --apply to write.');
  process.exit(0);
}

// ---- Write ------------------------------------------------------------------
// Require the project id explicitly rather than letting the Admin SDK fall back
// to gcloud ADC (which points at PRODUCTION on a dev machine), and announce the
// target loudly before writing. Mirrors scripts/grant-admin.mjs.
const projectId = process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error(
    'Refusing to --apply without GCLOUD_PROJECT set. Use demo-sabeel-kanban for ' +
      'the emulators, or the real project id for production.',
  );
  process.exit(1);
}
const usingEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
console.log(
  `\nAPPLYING import to project ${projectId}` +
    `${usingEmulators ? ' (EMULATORS)' : ' (PRODUCTION)'}\n`,
);

initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

const admin = await auth.getUserByEmail(ADMIN_EMAIL);
const adminUid = admin.uid;
const adminProfile = { displayName: admin.displayName ?? 'Faisal', email: ADMIN_EMAIL };
const now = Date.now();

let nCards = 0, nComments = 0;
for (const { bn, brows, cols } of plan) {
  // Board (deterministic id so re-runs update)
  const boardId = `clickup-${bn.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const board = newBoard({
    name: bn,
    description: `Imported from ClickUp (${brows[0]['Space Name']}).`,
    createdBy: adminUid,
    createdByProfile: adminProfile,
    now,
  });
  await db.doc(`boards/${boardId}`).set(board);

  const colId = Object.fromEntries(board.columns.map((c) => [c.name, c.id]));

  for (const colName of columnNames) {
    const group = (cols[colName] ?? []).sort(
      (a, b) => Number(a['Date Created']) - Number(b['Date Created']),
    );
    const ranks = initialRanks(group.length);
    for (let i = 0; i < group.length; i++) {
      const r = group[i];
      const createdAt = Number(r['Date Created']) || now;
      const comments = jsonOr(r['Comments'], []);
      const cardId = r['Task ID'];
      const card = {
        boardId,
        title: r['Task Name'].trim() || '(untitled)',
        description: buildDescription(r),
        columnId: colId[colName],
        rank: ranks[i],
        assigneeUids: [],
        priority: mapPriority(r['Priority']),
        labelIds: [],
        archived: false,
        // NOT `commentCount` — `onCommentWritten` owns it, and it increments per
        // comment added below. Writing the total here as well counts every
        // imported comment twice.
        createdAt,
        createdBy: adminUid,
        updatedAt: createdAt,
        updatedBy: adminUid,
        sourceId: sourceIdFor(cardId),
      };
      const due = mapDueDate(r['Due Date']);
      if (due) card.dueDate = due;
      // MERGE, so a re-run updates the imported fields and leaves everything the
      // importer does not own where it is — see the note at the top of the file.
      await db.doc(`cards/${cardId}`).set(card, { merge: true });
      nCards++;

      // Comments as real comments, oldest first, attributed in the body.
      const ordered = [...comments].reverse();
      for (const c of ordered) {
        const author = c.by ?? 'unknown';
        const when = commentDate(c, createdAt);
        await db.collection(`cards/${cardId}/comments`).add({
          authorUid: adminUid,
          body: `[${author} · ${c.date ?? ''}]\n${(c.text ?? '').trim()}`,
          mentionUids: [],
          createdAt: when,
        });
        nComments++;
      }
    }
  }
  console.log(`  wrote board "${bn}" (${boardId})`);
}
console.log(`\nDone: ${boards.size} boards, ${nCards} cards, ${nComments} comments.`);
