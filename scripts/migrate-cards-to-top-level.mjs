// One-time migration: cards from the per-board subcollection
// (`boards/{boardId}/cards/{cardId}`) to a TOP-LEVEL collection (`cards/{cardId}`)
// with a `boardId` field. Comments and activity subcollections come along.
//
// Phased and idempotent — same doc ids throughout, so a re-run overwrites rather
// than duplicates:
//   copy    (default) : write cards/* (+ comments, activity) from the old paths.
//   verify            : assert every card's subcollection counts + boardId match.
//   purge (--purge)   : re-verify, then delete the old boards/*/cards/*.
//
// DEPLOY ORDER MATTERS (see the plan / docs): run `copy` while the Cloud
// Functions still trigger on `boards/*/cards/*`. Writing to the NEW top-level
// paths then fires NOTHING, so commentCount is preserved exactly and no phantom
// activity or historical notifications are produced. Only after the re-pathed
// functions are deployed should anything write to `cards/*` for real.
//
// Usage (emulator):
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports firestore) GCLOUD_PROJECT=demo-sabeel-kanban \
//   node scripts/migrate-cards-to-top-level.mjs [--dry|--verify-only|--purge]
// Usage (prod): GOOGLE_CLOUD_PROJECT=sabeel-institute-kanban node scripts/... (gcloud ADC)
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY = process.argv.includes('--dry');
const VERIFY_ONLY = process.argv.includes('--verify-only');
const PURGE = process.argv.includes('--purge');

// Require the target project explicitly and announce it, so a copy/purge can
// never silently run against whatever project gcloud ADC points at (production
// on a dev machine). Mirrors scripts/grant-admin.mjs.
const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error(
    'Set GCLOUD_PROJECT (demo-sabeel-kanban for the emulators, or the real ' +
      'project id for production) before running this migration.',
  );
  process.exit(1);
}
const usingEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
console.log(
  `Migration against project ${projectId}` +
    `${usingEmulators ? ' (EMULATORS)' : ' (PRODUCTION)'}` +
    `${DRY ? ' — DRY RUN' : ''}\n`,
);

initializeApp({ projectId });
const db = getFirestore();

const SUBS = ['comments', 'activity'];

async function forEachOldCard(fn) {
  const boards = await db.collection('boards').get();
  for (const board of boards.docs) {
    const cards = await board.ref.collection('cards').get();
    for (const card of cards.docs) await fn(board.id, card);
  }
}

async function copy() {
  let nCards = 0;
  const subCounts = {};
  await forEachOldCard(async (boardId, card) => {
    const target = db.doc(`cards/${card.id}`);
    if (!DRY) await target.set({ ...card.data(), boardId }, { merge: false });
    nCards++;
    for (const sub of SUBS) {
      const src = await card.ref.collection(sub).get();
      subCounts[sub] = (subCounts[sub] ?? 0) + src.size;
      for (const d of src.docs) {
        if (!DRY) await target.collection(sub).doc(d.id).set(d.data(), { merge: false });
      }
    }
  });
  console.log(
    `${DRY ? '[dry] would copy' : 'copied'} ${nCards} cards` +
      SUBS.map((s) => `, ${subCounts[s] ?? 0} ${s}`).join(''),
  );
}

async function verify() {
  let ok = 0;
  const problems = [];
  await forEachOldCard(async (boardId, card) => {
    const top = await db.doc(`cards/${card.id}`).get();
    if (!top.exists) return problems.push(`${card.id}: missing at cards/${card.id}`);
    if (top.data().boardId !== boardId)
      problems.push(`${card.id}: boardId ${top.data().boardId} != ${boardId}`);
    for (const sub of SUBS) {
      const a = (await card.ref.collection(sub).get()).size;
      const b = (await top.ref.collection(sub).get()).size;
      if (a !== b) problems.push(`${card.id}/${sub}: ${a} old vs ${b} new`);
    }
    if (top.data().boardId === boardId) ok++;
  });
  console.log(`verify: ${ok} cards OK, ${problems.length} problem(s)`);
  for (const p of problems) console.log('  ✗ ' + p);
  return problems.length === 0;
}

async function purge() {
  if (!(await verify())) {
    console.error('Refusing to purge: verification failed.');
    process.exit(1);
  }
  let n = 0;
  await forEachOldCard(async (_boardId, card) => {
    for (const sub of SUBS) {
      const docs = await card.ref.collection(sub).get();
      for (const d of docs.docs) if (!DRY) await d.ref.delete();
    }
    if (!DRY) await card.ref.delete();
    n++;
  });
  console.log(`${DRY ? '[dry] would purge' : 'purged'} ${n} old subcollection cards`);
}

if (PURGE) {
  await purge();
} else if (VERIFY_ONLY) {
  process.exit((await verify()) ? 0 : 1);
} else {
  await copy();
  const passed = await verify();
  if (!passed) process.exit(1);
  console.log('Copy + verify complete. Deploy the re-pathed functions + client, then re-run with --purge.');
}
