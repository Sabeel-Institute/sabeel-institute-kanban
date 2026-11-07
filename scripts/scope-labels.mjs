// Turn chosen institute labels into board labels.
//
// Every label starts as an institute label: one with no `boardId` is on every
// board. This moves the ones a board should keep to itself onto that board,
// from a plan file that names them. The plan holds real label and board names,
// so it lives OUTSIDE the repo, which is public:
//
//   [
//     { "label": "Exact label name", "board": "Exact board name" },
//     { "label": "Another label" }
//   ]
//
// Names are matched exactly, case included. "board" names the board that keeps
// the label. Leave it out to keep it on the board with the most cards carrying
// it; a label on no card needs one.
//
// For each label:
//   on one board      the label gets that board's id. No card changes.
//   on several        the chosen board keeps it, and every other board that uses
//                     it gets its own copy (`<labelId>_<boardId>`), which its
//                     cards are moved onto. Each moved card logs "changed the
//                     labels" against --actor, and its followers hear about it.
//
// Dry run unless --apply. Every entry is checked before anything is written, and
// the run stops on the first problem. Re-running is safe: copies have fixed ids,
// moved cards no longer carry the old id, and a name that is on boards only is
// reported and skipped.
//
//   # emulators
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports firestore) \
//     GCLOUD_PROJECT=$(npx sabeel-ci ports --project) \
//     node scripts/scope-labels.mjs ~/plan.json --actor faisal@oursabeel.com
//   # production (gcloud ADC), after reading the dry run
//   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/scope-labels.mjs ~/plan.json \
//     --actor <admin email> --apply
import { existsSync, readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const USAGE =
  'Usage: node scripts/scope-labels.mjs <plan.json> [--actor <admin email>] [--apply]';

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---- Arguments ---------------------------------------------------------------
const args = process.argv.slice(2);
let planPath = null;
let actorEmail = null;
let apply = false;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--apply') apply = true;
  else if (a === '--actor') {
    actorEmail = args[i + 1];
    i += 1;
    if (!actorEmail || actorEmail.startsWith('--')) fail(`--actor needs an email.\n${USAGE}`);
  } else if (a.startsWith('--')) fail(`Unknown option ${a}.\n${USAGE}`);
  else if (planPath === null) planPath = a;
  else fail(`One plan file only.\n${USAGE}`);
}
if (planPath === null) fail(USAGE);
if (!existsSync(planPath)) fail(`No plan file at ${planPath}.`);

let plan;
try {
  plan = JSON.parse(readFileSync(planPath, 'utf8'));
} catch (e) {
  fail(`${planPath} is not JSON: ${e.message}`);
}
if (!Array.isArray(plan) || plan.length === 0) fail('The plan must be a non-empty JSON array.');
plan.forEach((entry, i) => {
  const where = `Plan entry ${i + 1}`;
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fail(`${where} is not an object.`);
  const extra = Object.keys(entry).filter((k) => k !== 'label' && k !== 'board');
  if (extra.length) fail(`${where} has unknown keys: ${extra.join(', ')}. Only "label" and "board".`);
  if (typeof entry.label !== 'string' || entry.label.length === 0) fail(`${where} needs a "label" name.`);
  if ('board' in entry && (typeof entry.board !== 'string' || entry.board.length === 0)) {
    fail(`${where}: "board" must be a board name.`);
  }
});
const names = plan.map((e) => e.label);
const repeated = names.find((n, i) => names.indexOf(n) !== i);
if (repeated) fail(`"${repeated}" is in the plan twice.`);

const projectId = process.env.GCLOUD_PROJECT;
if (!projectId) {
  fail(
    'Refusing to run without GCLOUD_PROJECT. Use $(npx sabeel-ci ports --project) ' +
      'for the emulators, or the real project id for production.',
  );
}
console.log(
  `${apply ? 'APPLYING' : 'Dry run'} on ${projectId}` +
    `${process.env.FIRESTORE_EMULATOR_HOST ? ' (EMULATORS)' : ' (PRODUCTION)'}\n`,
);

initializeApp({ projectId });
const db = getFirestore();

// ---- Read everything once, then decide ----------------------------------------
const [labelSnap, boardSnap] = await Promise.all([
  db.collection('labels').get(),
  db.collection('boards').get(),
]);
const boardName = new Map(boardSnap.docs.map((b) => [b.id, b.data().name ?? b.id]));

function boardByName(name, where) {
  const hits = boardSnap.docs.filter((b) => b.data().name === name);
  if (hits.length === 0) fail(`${where}: no board is named "${name}".`);
  if (hits.length > 1) fail(`${where}: ${hits.length} boards are named "${name}". Rename one first.`);
  return hits[0].id;
}

const steps = [];
for (const [i, entry] of plan.entries()) {
  const where = `"${entry.label}"`;
  // Institute labels only: once applied, the label and its copies all carry
  // this name on their boards, and a second run must find nothing left to do.
  const named = labelSnap.docs.filter((l) => l.data().name === entry.label);
  const hits = named.filter((l) => !l.data().boardId);
  if (hits.length === 0 && named.length > 0) {
    const on = named.map((l) => boardName.get(l.data().boardId) ?? l.data().boardId).join(', ');
    console.log(`${where}: already on ${on}; skipped.`);
    continue;
  }
  if (hits.length === 0) fail(`${where}: no label has exactly this name.`);
  if (hits.length > 1) fail(`${where}: ${hits.length} institute labels have this name. Delete or rename one first.`);
  const label = hits[0];
  const cards = (await db.collection('cards').where('labelIds', 'array-contains', label.id).get()).docs;
  const byBoard = new Map();
  for (const c of cards) {
    const b = c.data().boardId;
    byBoard.set(b, [...(byBoard.get(b) ?? []), c]);
  }
  let keep;
  if (entry.board !== undefined) keep = boardByName(entry.board, `Plan entry ${i + 1}`);
  else if (byBoard.size === 0) fail(`${where} is on no card. Name the board that keeps it.`);
  else keep = [...byBoard.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  const copies = [...byBoard.entries()]
    .filter(([b]) => b !== keep)
    .map(([b, carrying]) => ({ boardId: b, copyId: `${label.id}_${b}`, cards: carrying }));
  steps.push({ label, keep, copies, onKeep: byBoard.get(keep)?.length ?? 0 });
}

let actorUid = null;
const moving = steps.reduce((n, s) => n + s.copies.reduce((m, c) => m + c.cards.length, 0), 0);
if (moving > 0) {
  if (!actorEmail) fail(`${moving} card(s) would move to a copy. Name the admin doing it with --actor.`);
  const users = await db.collection('users').where('email', '==', actorEmail).get();
  if (users.size !== 1) fail(`--actor ${actorEmail} matches ${users.size} user(s); it needs exactly one.`);
  if (users.docs[0].data().role !== 'admin') fail(`--actor ${actorEmail} is not an admin.`);
  actorUid = users.docs[0].id;
}

// ---- Report -----------------------------------------------------------------
for (const s of steps) {
  console.log(`"${s.label.data().name}" → ${boardName.get(s.keep) ?? s.keep} (${s.onKeep} card(s) keep it as is)`);
  for (const c of s.copies) {
    console.log(`    copy for ${boardName.get(c.boardId) ?? c.boardId}: ${c.cards.length} card(s) move to it`);
  }
}
console.log(`\n${steps.length} label(s) to scope, ${moving} card(s) to move.`);
if (!apply) {
  console.log('Dry run: nothing written. Add --apply to do it.');
  process.exit(0);
}

// ---- Write ------------------------------------------------------------------
// Copies first, then the cards onto them, and the original's boardId LAST. A
// failure part-way leaves the original an institute label, still shown on every
// board and on every card that carries it, and a re-run finishes the job.
const BATCH_LIMIT = 400;
for (const s of steps) {
  const { name, color, createdAt = 0, createdBy = '' } = s.label.data();
  for (const c of s.copies) {
    await db.doc(`labels/${c.copyId}`).set({ boardId: c.boardId, name, color, createdAt, createdBy });
    for (let i = 0; i < c.cards.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const card of c.cards.slice(i, i + BATCH_LIMIT)) {
        const ids = card.data().labelIds ?? [];
        batch.update(card.ref, {
          labelIds: [...new Set(ids.map((id) => (id === s.label.id ? c.copyId : id)))],
          // The trigger names this person in the card's history, and in the
          // notice its followers get.
          updatedBy: actorUid,
          updatedAt: Date.now(),
        });
      }
      await batch.commit();
    }
  }
  await s.label.ref.update({ boardId: s.keep });
  console.log(`done: "${name}"`);
}
console.log('\nApplied.');
