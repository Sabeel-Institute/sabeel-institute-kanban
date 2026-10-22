// Remove `boardOwnerUids` from every board. The inverse of
// scripts/backfill-board-owners.mjs.
//
// THIS IS THE ONLY UNDO THAT EXISTS, and it is why it was written before the
// backfill ever ran. A Firestore restore cannot help: an import merges by
// document id, so it recreates what was DELETED but does not remove what was
// wrongly ADDED (docs/DEPLOY.md § Restoring). A field addition is therefore
// outside the backup's reach entirely.
//
// Only useful while the OLD rules are live — the ones that do not list
// `boardOwnerUids` in the board key lists. Once the authority rules are
// deployed, removing the field makes every board administrable by nobody but an
// admin, which is a worse state than the one you are trying to leave. If you
// have already flipped authority, roll the RULES back first, then run this.
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports firestore) GCLOUD_PROJECT=$(npx sabeel-ci ports --project) \
//     node scripts/unbackfill-board-owners.mjs
//   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/unbackfill-board-owners.mjs --apply
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

const projectId = process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error(
    'Refusing to run without GCLOUD_PROJECT. Use $(npx sabeel-ci ports --project) ' +
      'for the emulators, or the real project id for production.',
  );
  process.exit(1);
}
const usingEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
console.log(
  `Removing boardOwnerUids on ${projectId}` +
    `${usingEmulators ? ' (EMULATORS)' : ' (PRODUCTION)'}` +
    `${APPLY ? '' : '  — DRY RUN, nothing will be written'}` +
    `${ONLY ? `  — ONLY boards/${ONLY}` : ''}\n`,
);

initializeApp({ projectId });
const db = getFirestore();

const snap = ONLY
  ? { docs: [await db.doc(`boards/${ONLY}`).get()] }
  : await db.collection('boards').get();
if (ONLY && !snap.docs[0].exists) {
  console.error(`No such board: boards/${ONLY}`);
  process.exit(1);
}

const carrying = snap.docs.filter((d) => d.data()?.boardOwnerUids !== undefined);
for (const d of carrying) {
  console.log(
    `  boards/${d.id}  "${d.data()?.name ?? ''}"  drops [${(d.data()?.boardOwnerUids ?? []).join(', ')}]`,
  );
}

if (!APPLY) {
  console.log(
    `\n${carrying.length} of ${snap.docs.length} board(s) carry the field.` +
      '\nDRY RUN — nothing was written. Re-run with --apply.',
  );
  process.exit(0);
}

let written = 0;
for (const d of carrying) {
  await db.doc(`boards/${d.id}`).update({ boardOwnerUids: FieldValue.delete() });
  written += 1;
}

console.log(`\nRemoved the field from ${written} board(s).`);
process.exit(0);
