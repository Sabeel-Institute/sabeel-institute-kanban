#!/usr/bin/env node
/**
 * Find data nothing reads and nothing will remove: the cruft a delete or a
 * trigger can leave behind. Read-only; it reports paths and ids, never contents.
 *
 *     node scripts/audit-orphans.mjs                    # against production
 *     CHECK_PROJECT="$(npx sabeel-ci ports --project)" \
 *       FIRESTORE_EMULATOR_HOST="127.0.0.1:$(npx sabeel-ci ports firestore)" \
 *       FIREBASE_STORAGE_EMULATOR_HOST="127.0.0.1:$(npx sabeel-ci ports storage)" \
 *       node scripts/audit-orphans.mjs                  # against the emulators
 *
 * Exits 1 when it finds any. It walks every document, those under a parent
 * that no longer exists included, which is what a query cannot see. What
 * counts as cruft:
 *
 * - a document under a parent document that is gone (Firestore does not
 *   cascade, so every subcollection of a deleted card or board is one);
 * - a card or label on a board that is gone, a card whose parent card is gone,
 *   a Stats page for a board that is gone;
 * - a person's favourites, recents, mutes, watches, hidden boards or open
 *   notes naming a board that is gone; an unread count that disagrees with
 *   the inbox;
 * - a pending notice for a card that is gone, older than the sweep's reach;
 * - a stored file with no attachment document (past a day, so an upload in
 *   flight is not one), and a ready attachment whose file is missing.
 *
 * Alerts that name a deleted card are not cruft: `pruneNotifications` removes
 * every alert by age.
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { STATS_ALL_SCOPE } from '@sabeel/shared';

if (process.argv.length !== 2) {
  console.error('usage: audit-orphans.mjs   (no arguments; CHECK_PROJECT picks the project)');
  process.exit(2);
}
const PROJECT_ID = process.env.CHECK_PROJECT
  ?? JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8')).projects.default;
initializeApp({ projectId: PROJECT_ID, storageBucket: `${PROJECT_ID}.firebasestorage.app` });
const db = getFirestore();
const bucket = getStorage().bucket();

const DAY = 24 * 60 * 60 * 1000;
const NOTICE_GRACE = 60 * 60 * 1000;

/** path -> data, for every document that exists, wherever it is. */
const docs = new Map();
/** Paths of documents that exist under a parent document that does not. */
const orphans = [];

async function walk(col, parentMissing) {
  const refs = await col.listDocuments();
  for (let i = 0; i < refs.length; i += 300) {
    const chunk = refs.slice(i, i + 300);
    const snaps = await db.getAll(...chunk);
    await Promise.all(snaps.map(async (s, j) => {
      if (s.exists) {
        docs.set(s.ref.path, s.data());
        if (parentMissing) orphans.push(s.ref.path);
      }
      for (const sub of await chunk[j].listCollections()) await walk(sub, parentMissing || !s.exists);
    }));
  }
}
for (const col of await db.listCollections()) await walk(col, false);

const ofShape = (re) => [...docs.entries()].filter(([p]) => re.test(p));
const idOf = (p) => p.split('/').at(-1);
const boards = new Set(ofShape(/^boards\/[^/]+$/).map(([p]) => idOf(p)));
const cards = new Set(ofShape(/^cards\/[^/]+$/).map(([p]) => idOf(p)));

// stats/{scope} is a document only for the institute-wide scope; a board's
// pages hang under a path that is not one, by design. Judge them by the board.
const statsPages = [];
const trueOrphans = orphans.filter((p) => {
  const m = p.match(/^stats\/([^/]+)\/months\/[^/]+$/);
  if (!m) return true;
  if (m[1] !== STATS_ALL_SCOPE && !boards.has(m[1])) statsPages.push(p);
  return false;
});

const deadBoardRefs = [];
for (const [p, d] of [...ofShape(/^cards\/[^/]+$/), ...ofShape(/^labels\/[^/]+$/)]) {
  if (d.boardId && !boards.has(d.boardId)) deadBoardRefs.push(`${p} -> board ${d.boardId}`);
}
const deadParents = ofShape(/^cards\/[^/]+$/)
  .filter(([, d]) => d.parentId && !cards.has(d.parentId))
  .map(([p, d]) => `${p} -> parent ${d.parentId}`);

const BOARD_LISTS = ['mutedBoardIds', 'favoriteBoardIds', 'recentBoardIds', 'overviewHiddenBoardIds', 'notesOpenBoardIds'];
const WATCH_LISTS = ['watchedColumns', 'watchedLanes'];
const userRefs = [];
const badCounts = [];
for (const [p, d] of ofShape(/^users\/[^/]+$/)) {
  for (const f of BOARD_LISTS) for (const id of d[f] ?? []) if (!boards.has(id)) userRefs.push(`${p}.${f}: ${id}`);
  for (const f of WATCH_LISTS) for (const k of d[f] ?? []) if (!boards.has(k.split('/')[0])) userRefs.push(`${p}.${f}: ${k}`);
  const unread = ofShape(new RegExp(`^${p}/notifications/[^/]+$`)).filter(([, n]) => n.read === false).length;
  if ((d.unreadNotifCount ?? 0) !== unread) badCounts.push(`${p}: stored ${d.unreadNotifCount ?? 0}, inbox ${unread}`);
}

const staleNotices = ofShape(/^pendingNotices\/[^/]+$/)
  .filter(([p]) => !cards.has(idOf(p)))
  .filter(([, d]) => Object.values(d.entries ?? {}).every((e) => Date.now() - (e.at ?? 0) > NOTICE_GRACE))
  .map(([p]) => p);

const [objects] = await bucket.getFiles();
const objectNames = new Set(objects.map((o) => o.name));
const strayObjects = objects
  .filter((o) => {
    const m = o.name.match(/^cards\/([^/]+)\/attachments\/([^/]+)$/);
    return !(m && docs.has(`cards/${m[1]}/attachments/${m[2]}`));
  })
  .filter((o) => Date.now() - Date.parse(o.metadata.timeCreated) > DAY)
  .map((o) => `${o.name} (${o.metadata.size} bytes)`);
const missingObjects = ofShape(/^cards\/[^/]+\/attachments\/[^/]+$/)
  .filter(([p, d]) => d.status === 'ready' && !objectNames.has(p))
  .map(([p]) => p);

const sections = [
  ['documents under a parent that is gone', trueOrphans],
  ['Stats pages for boards that are gone', statsPages],
  ['cards or labels on boards that are gone', deadBoardRefs],
  ['cards whose parent card is gone', deadParents],
  ["people's lists naming boards that are gone", userRefs],
  ['unread counts that disagree with the inbox', badCounts],
  ['pending notices for cards that are gone', staleNotices],
  ['stored files with no attachment document', strayObjects],
  ['ready attachments whose file is missing', missingObjects],
];
console.log(`${PROJECT_ID}: ${docs.size} documents, ${objects.length} stored files`);
let found = 0;
for (const [label, list] of sections) {
  found += list.length;
  console.log(`${label}: ${list.length}`);
  for (const line of list) console.log(`  ${line}`);
}
process.exit(found ? 1 : 0);
