// Turn chosen institute labels into board labels.
//
// Every label starts as an institute label: one with no `boardId` is on every
// board. The plan names the ones that should belong to boards instead. It holds
// real label names, so it lives OUTSIDE the repo, which is public:
//
//   ["Exact label name", "Another label"]
//
// Names are matched exactly, case included.
//
// Each named label is replaced, on every board whose cards carry it (archived
// cards and boards included), by a label of that board's own with the same name
// and colour, id `<labelId>_<boardId>`. Its cards move onto that board's copy,
// then the institute label is deleted. A named label on no card is deleted.
// Every other label stays an institute label.
//
// RUN IT ONLY INSIDE THE MAINTENANCE WINDOW (docs/DEPLOY.md), after the deny-all
// rules and this release's functions are deployed. It reads, then writes, and
// assumes nothing else writes labels or cards meanwhile. Its card writes are
// stamped SYSTEM_ACTOR, for which this release's card trigger records no
// history, so nobody is told about a change they cannot see.
//
// Dry run unless --apply. It writes copies, then cards, then deletes the
// institute labels, so a run that stops part-way leaves every card holding
// labels that exist, and running it again finishes the job; the deletions are
// one batch. A name with no institute label left and board labels of that name
// is reported as done. A deleted label that was on no card leaves nothing
// behind, so naming it again is refused like a mistyped name.
//
//   # emulators
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports firestore) \
//     GCLOUD_PROJECT=$(npx sabeel-ci ports --project) \
//     node scripts/scope-labels.mjs ~/plan.json
//   # production (gcloud ADC), after reading the dry run
//   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/scope-labels.mjs ~/plan.json --apply
import { existsSync, readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SYSTEM_ACTOR } from '@sabeel/shared';

const USAGE = 'Usage: node scripts/scope-labels.mjs <plan.json> [--apply]';

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---- Arguments ---------------------------------------------------------------
const args = process.argv.slice(2);
let planPath = null;
let apply = false;
for (const a of args) {
  if (a === '--apply') apply = true;
  else if (a.startsWith('--')) fail(`Unknown option ${a}.\n${USAGE}`);
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
if (!Array.isArray(plan) || plan.length === 0) fail('The plan must be a non-empty JSON array of label names.');
plan.forEach((name, i) => {
  if (typeof name !== 'string' || name.trim() === '') fail(`Plan entry ${i + 1} is not a label name.`);
});
// Label names are unique regardless of capitals, so two entries that differ
// only in capitals name one label.
const folded = plan.map((n) => n.toLowerCase());
const repeated = plan.find((n, i) => folded.indexOf(n.toLowerCase()) !== i);
if (repeated !== undefined) fail(`"${repeated}" is in the plan twice.`);

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

// ---- Read, check every entry, then decide -------------------------------------
const [labelSnap, boardSnap] = await Promise.all([
  db.collection('labels').get(),
  db.collection('boards').get(),
]);
const boardName = new Map(boardSnap.docs.map((b) => [b.id, b.data().name ?? b.id]));
const nameOf = (boardId) => boardName.get(boardId) ?? `board ${boardId}`;

const steps = [];
const done = [];
for (const name of plan) {
  const exact = labelSnap.docs.filter((l) => l.data().name === name);
  const institute = exact.filter((l) => !l.data().boardId);
  if (institute.length > 1) {
    fail(`"${name}": ${institute.length} institute labels have this name. Delete or rename one first.`);
  }
  if (institute.length === 0) {
    if (exact.length > 0) {
      done.push(name);
      continue;
    }
    const near = labelSnap.docs
      .map((l) => l.data().name)
      .filter((n) => String(n).toLowerCase() === name.toLowerCase());
    fail(
      `"${name}": no label has exactly this name.` +
        (near.length ? ` Did you mean ${near.map((n) => `"${n}"`).join(' or ')}?` : ''),
    );
  }
  const label = institute[0];
  const cards = (await db.collection('cards').where('labelIds', 'array-contains', label.id).get()).docs;
  const boards = new Map();
  for (const c of cards) {
    const b = c.data().boardId;
    boards.set(b, (boards.get(b) ?? 0) + 1);
  }
  steps.push({ label, cards, boards });
}

// One write per card, however many planned labels it carries.
const rewrites = new Map();
for (const s of steps) for (const c of s.cards) rewrites.set(c.ref.path, c);
const planned = new Set(steps.map((s) => s.label.id));
const copies = steps.reduce((n, s) => n + s.boards.size, 0);

// ---- Report -----------------------------------------------------------------
for (const s of steps) {
  const name = s.label.data().name;
  if (s.cards.length === 0) {
    console.log(`"${name}": on no card. The label is deleted.`);
    continue;
  }
  console.log(`"${name}": ${s.cards.length} card(s) on ${s.boards.size} board(s)`);
  const byName = [...s.boards].sort((x, y) => nameOf(x[0]).localeCompare(nameOf(y[0])));
  for (const [b, n] of byName) console.log(`    ${nameOf(b)}: ${n} card(s)`);
}
for (const name of done) console.log(`"${name}": done already. No institute label is left with this name.`);
console.log(
  `\n${steps.length} label(s) to make board labels, ${done.length} done already: ` +
    `${copies} board label(s) to create, ${rewrites.size} card(s) to rewrite.`,
);
if (!apply) {
  console.log('Dry run: nothing written. Add --apply to do it, inside the maintenance window.');
  process.exit(0);
}

// ---- Write ------------------------------------------------------------------
async function inBatches(items, write) {
  for (let i = 0; i < items.length; i += 400) {
    const batch = db.batch();
    for (const item of items.slice(i, i + 400)) write(batch, item);
    await batch.commit();
  }
}

// 1. Each board's copy, before any card points at it.
await inBatches(
  steps.flatMap((s) => [...s.boards.keys()].map((boardId) => ({ label: s.label, boardId }))),
  (batch, { label, boardId }) =>
    batch.set(db.doc(`labels/${label.id}_${boardId}`), { ...label.data(), boardId }),
);

// 2. The cards, onto their own board's copies.
await inBatches([...rewrites.values()], (batch, c) => {
  const { boardId, labelIds } = c.data();
  const next = labelIds.map((id) => (planned.has(id) ? `${id}_${boardId}` : id));
  batch.update(c.ref, { labelIds: next, updatedBy: SYSTEM_ACTOR });
});

// 3. The institute labels, which no card holds now.
await inBatches(steps, (batch, s) => batch.delete(s.label.ref));

console.log(
  `\nApplied: ${copies} board label(s) created, ${rewrites.size} card(s) rewritten, ` +
    `${steps.length} institute label(s) deleted.`,
);
