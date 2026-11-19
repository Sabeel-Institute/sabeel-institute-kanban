#!/usr/bin/env node
/**
 * Store the name of whoever did it on comments and card history written
 * before names were stored (functions/src/names.ts).
 *
 *     node scripts/backfill-names.mjs --dry-run   # count, write nothing
 *     node scripts/backfill-names.mjs             # against production
 *     CHECK_PROJECT="$(npx sabeel-ci ports --project)" \
 *       FIRESTORE_EMULATOR_HOST="127.0.0.1:$(npx sabeel-ci ports firestore)" \
 *       node scripts/backfill-names.mjs           # against the emulator
 *
 * Fills `authorName` on every comment and `actorName` on every line of a
 * card's history that lacks one, from the person's user document as it is
 * now. A uid with no name on record (the system's, an unknown actor, an
 * account since deleted) is left as it is: readers fall back as before.
 * Board history already stores its names and is not touched.
 *
 * Safe to run while colleagues work, and again: it only adds a field that is
 * missing. Adding a name to a comment is an edit, which the comment triggers
 * pass over (nothing is counted or announced); a history line is announced
 * only when it is created, so filling one in tells nobody.
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
if (args.some((a) => a !== '--dry-run')) {
  console.error(`usage: backfill-names.mjs [--dry-run]  (got "${args.join(' ')}")`);
  process.exit(2);
}
// Production is `.firebaserc`'s default project, the one `firebase deploy` uses.
const PROJECT_ID = process.env.CHECK_PROJECT
  ?? JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8')).projects.default;
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

const names = new Map();
async function nameOf(uid) {
  if (!uid) return undefined;
  if (!names.has(uid)) {
    const name = (await db.doc(`users/${uid}`).get()).data()?.displayName;
    names.set(uid, typeof name === 'string' && name.length > 0 ? name : undefined);
  }
  return names.get(uid);
}

/** Fill `field` from the uid in `byField` on each doc lacking it; returns what was (or would be) written. */
async function fill(docs, byField, field) {
  const writer = db.bulkWriter();
  let filled = 0;
  let unnamed = 0;
  for (const d of docs) {
    const data = d.data();
    if (typeof data[field] === 'string') continue;
    const name = await nameOf(data[byField]);
    if (!name) {
      unnamed += 1;
      continue;
    }
    filled += 1;
    if (!dryRun) writer.update(d.ref, { [field]: name });
  }
  await writer.close();
  return { filled, unnamed };
}

// Comments live only under cards; `activity` is under cards AND boards, and
// only the cards' is filled here.
const comments = (await db.collectionGroup('comments').get()).docs;
const cardLines = (await db.collectionGroup('activity').get()).docs.filter(
  (d) => d.ref.parent.parent?.parent.id === 'cards',
);
const c = await fill(comments, 'authorUid', 'authorName');
const a = await fill(cardLines, 'actorUid', 'actorName');
const verb = dryRun ? 'would name' : 'named';
console.log(`${PROJECT_ID}: ${verb} ${c.filled} of ${comments.length} comments and ${a.filled} of ${cardLines.length} card history lines`);
console.log(`  left as they were, no name on record: ${c.unnamed} comments, ${a.unnamed} lines`);
process.exit(0);
