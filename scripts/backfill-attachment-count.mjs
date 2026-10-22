// Backfill `attachmentCount` on every card from the attachments that already
// exist — cards that gained files before the board badge existed carry no count,
// so their tiles show nothing until someone happens to add or remove a file.
//
// Counts READY attachments only, matching what the callables maintain: a
// half-finished upload is not a file anyone can open, and the nightly sweep will
// remove it. Idempotent: it recomputes the true count each run and only writes
// where the stored value is wrong, so it is safe to re-run and cheap to repeat.
//
//   # emulators
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports firestore) GCLOUD_PROJECT=demo-sabeel-kanban \
//     node scripts/backfill-attachment-count.mjs
//   # production (gcloud ADC)
//   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/backfill-attachment-count.mjs
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
  `Backfilling attachmentCount on ${projectId}` +
    `${usingEmulators ? ' (EMULATORS)' : ' (PRODUCTION)'}\n`,
);

initializeApp({ projectId });
const db = getFirestore();

// One collection-group read for every attachment, rather than a subcollection
// query per card: there are far fewer attachments than cards, and this way the
// cost does not grow with the number of cards that have no files at all.
const attachments = await db.collectionGroup('attachments').get();

const readyPerCard = new Map();
for (const doc of attachments.docs) {
  if (doc.data().status !== 'ready') continue;
  const cardId = doc.ref.parent.parent?.id;
  if (!cardId) continue;
  readyPerCard.set(cardId, (readyPerCard.get(cardId) ?? 0) + 1);
}

let written = 0;
let alreadyRight = 0;
for (const [cardId, count] of readyPerCard) {
  const ref = db.doc(`cards/${cardId}`);
  const snap = await ref.get();
  // A card deleted while this ran is not an error: its attachments went with it.
  if (!snap.exists) continue;
  if ((snap.data().attachmentCount ?? 0) === count) {
    alreadyRight += 1;
    continue;
  }
  await ref.update({ attachmentCount: count });
  written += 1;
  console.log(`  cards/${cardId} -> ${count}`);
}

console.log(
  `\n${attachments.size} attachment doc(s); ${readyPerCard.size} card(s) hold ` +
    `ready files. Updated ${written}, already correct ${alreadyRight}.`,
);
process.exit(0);
