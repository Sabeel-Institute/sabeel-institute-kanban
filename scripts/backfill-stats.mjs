#!/usr/bin/env node
/**
 * Rebuild the usage counters at `stats/**` from the documents they were derived
 * from, and seed the stored-file totals.
 *
 * TWO JOBS, one script:
 *
 *  1. BACKFILL. Counting starts when the triggers ship, but the organisation has
 *     months of history already recorded in cards, comments, attachments and the
 *     activity log. Without this the chart is empty for weeks.
 *
 *  2. REPAIR. Firestore triggers are at-least-once, so a retry can double-count.
 *     That is tolerable precisely because this script exists: the source
 *     documents still exist, so any range can be rebuilt exactly. Re-running is
 *     safe and idempotent — buckets are computed in memory and written WHOLE,
 *     never incremented.
 *
 * WHAT IT CANNOT REBUILD: `bytesRemoved`. The activity log records that a file
 * was detached and its name, not its size. Removals are counted (`filesRemoved`)
 * but historic bytes removed stay zero. Going forward the trigger records both —
 * and because of that, a re-run PRESERVES any `bytesRemoved` already recorded
 * rather than resetting it. A repair tool that destroys the one series with no
 * other source is not a repair tool.
 *
 * SAFETY
 *  - `--dry-run` is the DEFAULT. Writing requires `--write`.
 *  - It only ever writes under `stats/**`. Cards, comments, boards and
 *    attachments are read and never touched.
 *  - It never overwrites TODAY (or later). The live triggers own the day in
 *    progress, so this can run against production with counting already on.
 *  - It refuses to write if its own reconstruction disagrees with a direct count
 *    of the source collections.
 *
 * Usage (needs gcloud ADC or GOOGLE_APPLICATION_CREDENTIALS):
 *   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/backfill-stats.mjs
 *   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/backfill-stats.mjs --write
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ORG_TIMEZONE, STATS_ALL_SCOPE, UNKNOWN_ACTOR } from '@sabeel/shared';
// The SAME day-key helper the live counters use. This script exists to repair
// drift in those counters, so a second implementation of the rule could only
// ever file the repair on different days than the thing it repairs — and it
// would look like it worked, because the numbers would move.
import { todayInOrgTz } from '../packages/shared/lib/due.js';

const projectId = process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error('set GCLOUD_PROJECT=<project-id>');
  process.exit(1);
}
const WRITE = process.argv.includes('--write');

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

const dayKeyFor = (ms) => todayInOrgTz(new Date(ms));

const TODAY = dayKeyFor(Date.now());

/** buckets[scope][month][dd] = { counters…, actors:Set } */
const buckets = new Map();

function dayBucket(scope, dayKey) {
  const month = dayKey.slice(0, 7);
  const dd = dayKey.slice(8, 10);
  if (!buckets.has(scope)) buckets.set(scope, new Map());
  const months = buckets.get(scope);
  if (!months.has(month)) months.set(month, new Map());
  const days = months.get(month);
  if (!days.has(dd)) days.set(dd, { actors: new Set() });
  return days.get(dd);
}

/** Record into the board's bucket AND the org-wide roll-up, as the trigger does. */
function add(boardId, ms, field, by, actorUid) {
  if (!boardId || !Number.isFinite(ms)) return;
  const dayKey = dayKeyFor(ms);
  // The live triggers own today. Rebuilding it here would race them and could
  // wipe counts recorded seconds earlier.
  if (dayKey >= TODAY) return;
  for (const scope of [boardId, STATS_ALL_SCOPE]) {
    const b = dayBucket(scope, dayKey);
    if (field) b[field] = (b[field] ?? 0) + by;
    if (actorUid && actorUid !== UNKNOWN_ACTOR) b.actors.add(actorUid);
  }
}

console.log(`Reading ${projectId}…  (today in ${ORG_TIMEZONE} is ${TODAY})`);

// ---- Cards -----------------------------------------------------------------
const cards = await db.collection('cards').get();
const boardOf = new Map();
let created = 0;
let archived = 0;
for (const d of cards.docs) {
  const c = d.data();
  boardOf.set(d.id, c.boardId);
  if (c.createdAt) {
    add(c.boardId, c.createdAt, 'cardsCreated', 1, c.createdBy);
    created++;
  }
  if (c.archived && c.archivedAt) {
    add(c.boardId, c.archivedAt, 'cardsArchived', 1, c.updatedBy);
    archived++;
  }
}

// ---- Comments --------------------------------------------------------------
const comments = await db.collectionGroup('comments').get();
let commentCount = 0;
for (const d of comments.docs) {
  const c = d.data();
  // cards/{cardId}/comments/{id}
  const cardId = d.ref.parent.parent?.id;
  const boardId = boardOf.get(cardId);
  if (!boardId) continue; // the card is gone; nothing to attribute it to
  add(boardId, c.createdAt, 'comments', 1, c.authorUid);
  commentCount++;
}

// ---- Attachments (additions, with sizes) -----------------------------------
const attachments = await db.collectionGroup('attachments').get();
let attachCount = 0;
let liveBytes = 0;
let liveFiles = 0;
for (const d of attachments.docs) {
  const a = d.data();
  const cardId = d.ref.parent.parent?.id;
  const boardId = boardOf.get(cardId);
  if (a.status === 'ready') {
    liveBytes += a.sizeBytes ?? 0;
    liveFiles++;
  }
  if (!boardId || a.status !== 'ready') continue;
  add(boardId, a.uploadedAt, 'filesAdded', 1, a.uploadedBy);
  if (a.sizeBytes) add(boardId, a.uploadedAt, 'bytesAdded', a.sizeBytes, null);
  attachCount++;
}

// ---- Activity (removals, and the broad "who was active") -------------------
const activity = await db.collectionGroup('activity').get();
let detached = 0;
for (const d of activity.docs) {
  const a = d.data();
  const cardId = d.ref.parent.parent?.id;
  const boardId = boardOf.get(cardId);
  if (!boardId) continue;
  if (a.type === 'detached') {
    // Size is NOT recoverable — the log keeps the file's name, not its bytes.
    add(boardId, a.at, 'filesRemoved', 1, a.actorUid);
    detached++;
  } else {
    // Any activity at all makes someone active that day, which is what makes
    // "active people" broader than the six charted metrics.
    add(boardId, a.at, null, 0, a.actorUid);
  }
}

// ---- Self-check ------------------------------------------------------------
const sum = (scope, field) => {
  let n = 0;
  for (const days of buckets.get(scope)?.values() ?? []) {
    for (const b of days.values()) n += b[field] ?? 0;
  }
  return n;
};

// Only history is rebuilt, so anything dated today is legitimately absent from
// the totals below — count those separately rather than calling it a mismatch.
const todayCards = cards.docs.filter((d) => d.data().createdAt && dayKeyFor(d.data().createdAt) >= TODAY).length;
const todayComments = comments.docs.filter((d) => d.data().createdAt && dayKeyFor(d.data().createdAt) >= TODAY).length;

const checks = [
  ['cards created', sum(STATS_ALL_SCOPE, 'cardsCreated'), created - todayCards],
  ['comments', sum(STATS_ALL_SCOPE, 'comments'), commentCount - todayComments],
];

console.log(`\nSources: ${cards.size} cards, ${comments.size} comments, ` +
  `${attachments.size} attachments, ${activity.size} activity entries`);
console.log(`Reconstructed: ${created} created, ${archived} archived, ${attachCount} files added, ${detached} files removed`);
console.log(`Stored now: ${liveBytes} bytes across ${liveFiles} ready files`);

let bad = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}: rebuilt ${got}, expected ${want}`);
}
if (bad) {
  console.error('\nReconstruction disagrees with a direct count — refusing to write.');
  process.exit(1);
}

// ---- Shape of what was rebuilt --------------------------------------------
// Printed so the reconstruction can be EYEBALLED before it is written. The
// ClickUp re-import created many cards at once; if their `createdAt` is the
// import moment rather than the original, that day is a spike that means
// "imported", not "worked". Better to see it here than to explain it later.
{
  const perDay = new Map();
  for (const [month, days] of buckets.get(STATS_ALL_SCOPE) ?? []) {
    for (const [dd, b] of days) perDay.set(`${month}-${dd}`, b);
  }
  const busiest = [...perDay.entries()]
    .sort((a, b) => (b[1].cardsCreated ?? 0) - (a[1].cardsCreated ?? 0))
    .slice(0, 5);
  console.log('\nBusiest days by cards created (org-wide):');
  for (const [day, b] of busiest) {
    console.log(
      `  ${day}  created ${b.cardsCreated ?? 0}, archived ${b.cardsArchived ?? 0}, ` +
        `comments ${b.comments ?? 0}, people ${b.actors.size}`,
    );
  }
  console.log(`Days with any activity: ${perDay.size}`);
}

// ---- Write -----------------------------------------------------------------
let docs = 0;
for (const [scope, months] of buckets) {
  for (const [month, days] of months) {
    const ref = db.doc(`stats/${scope}/months/${month}`);
    const next = {};
    for (const [dd, b] of days) {
      const { actors, ...counters } = b;
      next[dd] = { ...counters, ...(actors.size ? { actors: [...actors].sort() } : {}) };
    }

    if (WRITE) {
      const existing = (await ref.get()).data()?.days ?? {};
      for (const [dd, v] of Object.entries(existing)) {
        // Preserve any day the live triggers own. `add()` already refuses to
        // build today, but the EXISTING document may hold it, and this write
        // replaces `days` wholesale — so carry those entries across untouched.
        if (`${month}-${dd}` >= TODAY) {
          next[dd] = v;
          continue;
        }
        // For every OLDER day, carry `bytesRemoved` across too.
        //
        // It is the one series this script cannot rebuild — the activity log
        // records that a file was detached and its NAME, not its size — so a
        // rebuild would silently reset it to zero. Destroying the only series
        // that has no other source would defeat the point of a repair tool, and
        // it would do it quietly: the numbers would move, so it would look like
        // the repair working. Everything else here is reconstructable and is
        // deliberately overwritten.
        if (v?.bytesRemoved && next[dd]) next[dd].bytesRemoved = v.bytesRemoved;
        else if (v?.bytesRemoved) next[dd] = { bytesRemoved: v.bytesRemoved };
      }
      await ref.set({ scope, month, days: next }, { merge: false });
    }
    docs++;
  }
}

if (WRITE) {
  // Seeded from the live sum rather than from reconstructed deltas: the stock is
  // what is actually stored right now, and it is directly measurable.
  await db.doc(`stats/${STATS_ALL_SCOPE}`).set(
    { bytesStored: liveBytes, filesStored: liveFiles },
    { merge: true },
  );
}

console.log(
  WRITE
    ? `\nWrote ${docs} month documents and seeded the stored totals.`
    : `\nDRY RUN — would write ${docs} month documents. Re-run with --write.`,
);
process.exit(0);
