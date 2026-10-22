// Move per-board labels into the org-wide `labels` collection.
//
// THE KEY FACT, checked against production before this was written: no two
// boards use the same label name, and every embedded label id (`lbl_*`) is
// already unique across the whole database. So each existing id becomes the
// global document id — and **no card is touched at all**. A card's `labelIds`
// keep resolving, before and after, which is what makes this safe to run while
// people are using the app.
//
// TWO PARTS, deliberately separate:
//
//   part-a   Create labels/{existing id} from every board's `labels` array.
//            Run BEFORE deploying the new client. Invisible to the running app:
//            old clients still read `boards.labels`, which is untouched.
//
//   part-b   Delete the `labels` field from every board document. Run AFTER the
//            new client is live, by which point nothing reads it.
//
// Both are idempotent and print what they will do before doing it.
//
//   # emulators
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports firestore) GCLOUD_PROJECT=$(npx sabeel-ci ports --project) \
//     node scripts/migrate-global-labels.mjs part-a
//   # production (gcloud ADC)
//   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/migrate-global-labels.mjs part-a
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const part = process.argv[2];
if (part !== 'part-a' && part !== 'part-b') {
  console.error('Usage: node scripts/migrate-global-labels.mjs <part-a|part-b>');
  process.exit(1);
}

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
  `${part} on ${projectId}${usingEmulators ? ' (EMULATORS)' : ' (PRODUCTION)'}\n`,
);

initializeApp({ projectId });
const db = getFirestore();

const boards = await db.collection('boards').get();

if (part === 'part-a') {
  // Every embedded label, with the board it came from (for the log only — the
  // board plays no part in the resulting document).
  const found = [];
  for (const b of boards.docs) {
    for (const l of b.data().labels ?? []) {
      found.push({ id: l.id, name: l.name, color: l.color, board: b.data().name });
    }
  }

  // An id colliding would mean two boards' labels merging into one silently.
  // Proven absent in production, asserted anyway — this is the one assumption
  // the whole no-card-rewrite design rests on.
  const seen = new Map();
  for (const l of found) {
    if (seen.has(l.id)) {
      console.error(
        `ABORT: label id ${l.id} appears on both "${seen.get(l.id)}" and ` +
          `"${l.board}". Merging them would silently join two labels.`,
      );
      process.exit(1);
    }
    seen.set(l.id, l.board);
  }

  // The rules validate the WHOLE document on update, so a label copied in with a
  // name over the cap — or a colour that is not a hex — is one no admin can
  // ever rename or recolour afterwards. Production was clean when this first
  // ran; the check is here for the re-run that matters, after a restore from a
  // backup predating the migration. Abort rather than mint something unfixable.
  const LABEL_NAME_MAX = 40;
  const malformed = found.filter(
    (l) =>
      typeof l.name !== 'string' ||
      l.name.trim().length === 0 ||
      [...l.name].length > LABEL_NAME_MAX ||
      typeof l.color !== 'string' ||
      !/^#[0-9A-Fa-f]{6}$/.test(l.color),
  );
  if (malformed.length > 0) {
    console.error('ABORT: these labels would be uneditable once created:');
    for (const l of malformed) {
      console.error(`  ${JSON.stringify(l.name)} ${JSON.stringify(l.color)} on "${l.board}"`);
    }
    console.error('Fix them on their board first, then re-run.');
    process.exit(1);
  }

  console.log(`${found.length} label(s) across ${boards.size} board(s):`);
  for (const l of found) console.log(`  ${l.name}  ${l.color}  (${l.id}) — ${l.board}`);

  let created = 0;
  let already = 0;
  for (const l of found) {
    const ref = db.doc(`labels/${l.id}`);
    if ((await ref.get()).exists) {
      already += 1;
      continue;
    }
    await ref.set({
      name: l.name,
      color: l.color,
      createdAt: Date.now(),
      // These predate per-label authorship. Attributing them to a person would
      // be a fabrication; the empty string is what "nobody recorded" looks like
      // everywhere else in this codebase.
      createdBy: '',
    });
    created += 1;
  }
  console.log(`\nCreated ${created}, already present ${already}. No cards touched.`);
} else {
  const holding = boards.docs.filter((b) => b.data().labels !== undefined);
  console.log(`${holding.length} of ${boards.size} board(s) still carry a labels field.`);

  // Nothing is lost that part-a did not already copy — check rather than trust.
  const globals = await db.collection('labels').get();
  const known = new Set(globals.docs.map((d) => d.id));
  const missing = [];
  for (const b of holding) {
    for (const l of b.data().labels ?? []) {
      if (!known.has(l.id)) missing.push(`${l.name} (${l.id}) on "${b.data().name}"`);
    }
  }
  if (missing.length > 0) {
    console.error('ABORT: these labels are not in the global collection yet:');
    for (const m of missing) console.error(`  ${m}`);
    console.error('Run part-a first.');
    process.exit(1);
  }

  for (const b of holding) {
    await b.ref.update({ labels: FieldValue.delete() });
    console.log(`  cleared boards/${b.id} ("${b.data().name}")`);
  }
  console.log(`\nCleared ${holding.length} board(s).`);
}

process.exit(0);
