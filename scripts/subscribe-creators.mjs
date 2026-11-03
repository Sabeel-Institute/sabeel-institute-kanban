#!/usr/bin/env node
/**
 * Bring existing data in line with following cards, once.
 *
 *     node scripts/subscribe-creators.mjs            # dry run against production
 *     node scripts/subscribe-creators.mjs --apply    # write
 *     CHECK_PROJECT="$(npx sabeel-ci ports --project)" \
 *       FIRESTORE_EMULATOR_HOST="127.0.0.1:$(npx sabeel-ci ports firestore)" \
 *       node scripts/subscribe-creators.mjs [--apply]   # against the emulator
 *
 * Two things, both idempotent, so a second run finds nothing to do:
 *
 * 1. Every card's creator becomes a subscriber, as a new card's creator is
 *    (docs/PRODUCT_BRIEF.md § Notifications), archived cards included, where
 *    the subscription stays dormant until a restore. Skipped: cards imported
 *    from ClickUp (they carry a `sourceId`), whose recorded creator is whoever
 *    ran the import; and cards whose creator is no longer on the board, since
 *    a subscription is a grant of read. The write touches `subscriberUids`
 *    alone, like `removeBoardMember`'s: no `updatedBy`, so no history entry,
 *    no notice, and no move in Search's newest-first order.
 *
 * 2. Notification settings move to the current events. The two comment
 *    events became `comment`, which stays off only for someone who had turned
 *    BOTH off; `myCardMoved` is gone, folded into `cardChanged`, which is new
 *    and on. The old keys are deleted, so nothing reads them by mistake.
 *
 * Prints counts and card ids only, never titles or names.
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== '--apply');
if (unknown.length > 0) {
  console.error(`usage: subscribe-creators.mjs [--apply]  (unknown: ${unknown.join(' ')})`);
  process.exit(2);
}
const apply = args.includes('--apply');
// Production is `.firebaserc`'s default project, the one `firebase deploy` uses.
const PROJECT_ID = process.env.CHECK_PROJECT ?? 'sabeel-institute-kanban';
const target = process.env.FIRESTORE_EMULATOR_HOST ? 'EMULATOR' : 'PRODUCTION';
console.log(`${apply ? 'Writing to' : 'Dry run against'} ${PROJECT_ID} (${target})\n`);

initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

// ---- 1. Creators subscribe -------------------------------------------------

const members = new Map();
async function memberUidsOf(boardId) {
  if (!members.has(boardId)) {
    const board = await db.doc(`boards/${boardId}`).get();
    members.set(boardId, new Set(board.data()?.memberUids ?? []));
  }
  return members.get(boardId);
}

const skipped = { imported: 0, noCreator: 0, leftBoard: 0, already: 0 };
const toSubscribe = [];
for (const card of (await db.collection('cards').get()).docs) {
  const d = card.data();
  if (d.sourceId !== undefined) skipped.imported += 1;
  else if (!d.createdBy) skipped.noCreator += 1;
  else if ((d.subscriberUids ?? []).includes(d.createdBy)) skipped.already += 1;
  else if (!(await memberUidsOf(d.boardId)).has(d.createdBy)) skipped.leftBoard += 1;
  else toSubscribe.push({ ref: card.ref, uid: d.createdBy });
}

const BATCH = 400;
async function commitAll(writes) {
  for (let i = 0; i < writes.length; i += BATCH) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + BATCH)) write(batch);
    await batch.commit();
  }
}

console.log(`Creators to subscribe: ${toSubscribe.length}`);
console.log(
  `  skipped: ${skipped.imported} imported from ClickUp, ${skipped.leftBoard} creator ` +
    `off the board, ${skipped.noCreator} with no creator, ${skipped.already} already subscribed`,
);
for (const { ref } of toSubscribe) console.log(`  ${ref.path}`);
if (apply) {
  await commitAll(
    toSubscribe.map(({ ref, uid }) => (b) =>
      b.update(ref, { subscriberUids: FieldValue.arrayUnion(uid) }),
    ),
  );
}

// ---- 2. Settings move to the current events --------------------------------

const OLD_KEYS = ['commentOnMyCard', 'commentOnSubscribed', 'myCardMoved'];
const prefWrites = [];
let commentOff = 0;
for (const user of (await db.collection('users').get()).docs) {
  const prefs = user.data().notifyPrefs ?? {};
  const old = OLD_KEYS.filter((k) => k in prefs);
  if (old.length === 0) continue;
  const patch = Object.fromEntries(old.map((k) => [`notifyPrefs.${k}`, FieldValue.delete()]));
  if (
    prefs.comment === undefined &&
    prefs.commentOnMyCard === false &&
    prefs.commentOnSubscribed === false
  ) {
    patch['notifyPrefs.comment'] = false;
    commentOff += 1;
  }
  prefWrites.push({ ref: user.ref, patch });
}

console.log(
  `\nSettings to move: ${prefWrites.length} account(s); comments stay off for ${commentOff}`,
);
if (apply) await commitAll(prefWrites.map(({ ref, patch }) => (b) => b.update(ref, patch)));

console.log(apply ? '\nWritten.' : '\nNothing written. Run again with --apply to write.');
process.exit(0);
