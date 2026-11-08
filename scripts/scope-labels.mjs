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
//   on several        the chosen board keeps it (named, or the one with the most
//                     cards; a tie is refused), and every other board that uses
//                     it gets its own copy (`<labelId>_<boardId>`), which its
//                     cards are moved onto. Each moved card logs "changed the
//                     labels" against --actor, and its followers hear about it.
//
// Dry run unless --apply, which needs --actor. Every entry is checked before
// anything is written, and the run stops on the first problem, including a board
// that already has its own label of the same name. Re-running is safe and
// finishes the job: a label already given to a board is taken up again, a copy
// that exists is left as it is, and any card still holding the label away from
// its board is moved.
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
  const named = labelSnap.docs.filter((l) => l.data().name === entry.label);
  if (named.length === 0) fail(`${where}: no label has exactly this name.`);
  const institute = named.filter((l) => !l.data().boardId);
  // A copy this script made is `<original id>_<its board>`.
  const isCopy = (l) => named.some((o) => o.id !== l.id && l.id === `${o.id}_${l.data().boardId}`);
  let label;
  let resumed = false;
  if (institute.length > 1) {
    fail(`${where}: ${institute.length} institute labels have this name. Delete or rename one first.`);
  } else if (institute.length === 1) {
    label = institute[0];
  } else {
    // Already a board's: a finished run, or one that stopped part-way. It is
    // taken up again, so a re-run finishes the job and moves any card that
    // picked the label up on another board since.
    const originals = named.filter((l) => !isCopy(l));
    if (originals.length !== 1) {
      fail(`${where}: no institute label has this name, and ${originals.length} boards have one of their own. Nothing to decide between.`);
    }
    label = originals[0];
    resumed = true;
  }
  const cards = (await db.collection('cards').where('labelIds', 'array-contains', label.id).get()).docs;
  const byBoard = new Map();
  for (const c of cards) {
    const b = c.data().boardId;
    byBoard.set(b, [...(byBoard.get(b) ?? []), c]);
  }
  let keep;
  if (resumed) {
    keep = label.data().boardId;
    if (entry.board !== undefined && boardByName(entry.board, `Plan entry ${i + 1}`) !== keep) {
      fail(`${where}: already given to ${boardName.get(keep) ?? keep}, not "${entry.board}".`);
    }
  } else if (entry.board !== undefined) {
    keep = boardByName(entry.board, `Plan entry ${i + 1}`);
  } else if (byBoard.size === 0) {
    fail(`${where} is on no card. Name the board that keeps it.`);
  } else {
    const ranked = [...byBoard.entries()].sort((x, y) => y[1].length - x[1].length);
    if (ranked.length > 1 && ranked[0][1].length === ranked[1][1].length) {
      fail(
        `${where}: ${boardName.get(ranked[0][0])} and ${boardName.get(ranked[1][0])} use it on as many cards. Name the board that keeps it.`,
      );
    }
    keep = ranked[0][0];
  }
  const targets = [...byBoard.keys()].filter((b) => b !== keep);
  // A board that already has its own label of this name, in any capitals,
  // would end up with two that cannot be told apart.
  for (const b of [keep, ...targets]) {
    const clash = labelSnap.docs.find(
      (l) =>
        l.data().boardId === b &&
        l.id !== label.id &&
        l.id !== `${label.id}_${b}` &&
        String(l.data().name).toLowerCase() === entry.label.toLowerCase(),
    );
    if (clash) {
      fail(`${where}: ${boardName.get(b) ?? b} already has its own "${clash.data().name}". Delete or rename one first.`);
    }
  }
  steps.push({ label, keep, resumed, byBoard, targets });
}

// The DISTINCT cards that move: a card carrying two planned labels is one card,
// one history entry and one notice.
const movingCards = new Set(
  steps.flatMap((s) => s.targets.flatMap((b) => s.byBoard.get(b).map((c) => c.ref.path))),
);

let actorUid = null;
if (apply) {
  if (!actorEmail) fail('--apply needs --actor: moved cards name that admin in their history.');
  const users = await db.collection('users').where('email', '==', actorEmail).get();
  if (users.size !== 1) fail(`--actor ${actorEmail} matches ${users.size} user(s); it needs exactly one.`);
  if (users.docs[0].data().role !== 'admin') fail(`--actor ${actorEmail} is not an admin.`);
  actorUid = users.docs[0].id;
}

// ---- Report -----------------------------------------------------------------
for (const s of steps) {
  const onKeep = s.byBoard.get(s.keep)?.length ?? 0;
  console.log(
    `"${s.label.data().name}" → ${boardName.get(s.keep) ?? s.keep}` +
      `${s.resumed ? ' (already given; finishing)' : ''} (${onKeep} card(s) keep it as is)`,
  );
  for (const b of s.targets) {
    console.log(`    copy for ${boardName.get(b) ?? b}: ${s.byBoard.get(b).length} card(s) move to it`);
  }
}
console.log(`\n${steps.length} label(s), ${movingCards.size} card(s) to move.`);
if (!apply) {
  console.log('Dry run: nothing written. Add --apply to do it.');
  process.exit(0);
}

// ---- Write ------------------------------------------------------------------
// Copies, then each original's board, then a SWEEP that moves cards by what
// they hold when it reaches them, not by what the read above saw. So a card
// labelled or moved by a colleague while this runs still ends with the right
// label, and a re-run, which takes each label up again, finishes anything a
// stopped run left.

/** Make a copy only if there is none: one a member has since renamed stays renamed. */
async function ensureCopy(original, boardId) {
  const ref = db.doc(`labels/${original.id}_${boardId}`);
  const { name, color, createdAt = 0, createdBy = '' } = original.data();
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists) tx.set(ref, { boardId, name, color, createdAt, createdBy });
  });
}

for (const s of steps) for (const b of s.targets) await ensureCopy(s.label, b);
for (const s of steps) {
  if (s.label.data().boardId !== s.keep) await s.label.ref.update({ boardId: s.keep });
}

const keepOf = new Map(steps.map((s) => [s.label.id, s]));
let moved = 0;
for (let pass = 1; pass <= 5; pass += 1) {
  // Every card that holds a planned label away from its keeping board, once,
  // however many planned labels it holds.
  const due = new Map();
  for (const s of steps) {
    const holding = await db.collection('cards').where('labelIds', 'array-contains', s.label.id).get();
    for (const c of holding.docs) if (c.data().boardId !== s.keep) due.set(c.ref.path, c.ref);
  }
  if (due.size === 0) break;
  for (const ref of due.values()) {
    const board = (await ref.get()).data()?.boardId;
    if (!board) continue;
    for (const s of steps) if (board !== s.keep) await ensureCopy(s.label, board);
    const changed = await db.runTransaction(async (tx) => {
      const card = (await tx.get(ref)).data();
      if (!card) return false;
      const ids = card.labelIds ?? [];
      const next = [
        ...new Set(
          ids.map((id) => {
            const s = keepOf.get(id);
            return s && card.boardId !== s.keep ? `${id}_${card.boardId}` : id;
          }),
        ),
      ];
      if (next.length === ids.length && next.every((id, k) => id === ids[k])) return false;
      // A card that changed board since it was read may have no copy on its new
      // board yet: write nothing, and the next pass makes one and comes back.
      for (const id of next.filter((x) => !ids.includes(x))) {
        if (!(await tx.get(db.doc(`labels/${id}`))).exists) return false;
      }
      tx.update(ref, {
        labelIds: next,
        // The trigger names this person in the card's history, and in the
        // notice its followers get.
        updatedBy: actorUid,
        updatedAt: Date.now(),
      });
      return true;
    });
    if (changed) moved += 1;
  }
}

// What is left is a card on a board the label does not belong to. Say so.
let left = 0;
for (const s of steps) {
  const holding = await db.collection('cards').where('labelIds', 'array-contains', s.label.id).get();
  left += holding.docs.filter((c) => c.data().boardId !== s.keep).length;
}
for (const s of steps) console.log(`done: "${s.label.data().name}"`);
console.log(`\nApplied: ${moved} card(s) moved to a copy.`);
if (left > 0) {
  console.error(`${left} card(s) still carry a label away from its board. Run it again.`);
  process.exit(1);
}
