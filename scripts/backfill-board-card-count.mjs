// Backfill `activeCardCount` on every board from the cards that already exist —
// boards created before the onCardBoardCount trigger existed have no count until
// this runs. Idempotent: recomputes the true count each run, so it is safe to
// re-run. Reads/writes via the Admin SDK.
//
//   # emulators
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports firestore) GCLOUD_PROJECT=demo-sabeel-kanban \
//     node scripts/backfill-board-card-count.mjs
//   # production (gcloud ADC)
//   GCLOUD_PROJECT=<prod-project-id> node scripts/backfill-board-card-count.mjs
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error(
    'Refusing to run without GCLOUD_PROJECT. Use demo-sabeel-kanban for the ' +
      'emulators, or the real project id for production.',
  );
  process.exit(1);
}
const usingEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
console.log(
  `Backfilling activeCardCount on ${projectId}` +
    `${usingEmulators ? ' (EMULATORS)' : ' (PRODUCTION)'}\n`,
);

initializeApp({ projectId });
const db = getFirestore();

// Count non-archived cards per board.
const counts = new Map();
const cards = await db.collection('cards').get();
cards.forEach((d) => {
  const c = d.data();
  if (!c.archived) counts.set(c.boardId, (counts.get(c.boardId) ?? 0) + 1);
});

let updated = 0;
const boards = await db.collection('boards').get();
for (const b of boards.docs) {
  const want = counts.get(b.id) ?? 0;
  const have = b.data().activeCardCount;
  console.log(`  ${b.data().name} (${b.id}): ${want}${have === want ? ' (unchanged)' : ''}`);
  if (have !== want) {
    await b.ref.update({ activeCardCount: want });
    updated++;
  }
}
console.log(`\nDone. ${boards.size} boards, updated ${updated}.`);
process.exit(0);
