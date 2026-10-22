// Step R1: the recovery manifest, and a redacted SHAPE the rehearsal can replay.
//
// READ-ONLY. It writes two files and touches nothing in the database.
//
//   migration/manifest-<project>.json   REAL uids, emails, CLAIMS and board
//                                       membership. The safety net: custom
//                                       claims are in no backup at all, so if
//                                       this file does not exist there is no
//                                       record of who held what before the
//                                       migration. Keep a copy OFF this machine.
//
//   migration/shape-<project>.json      The same structure with every name,
//                                       address and uid replaced. Only the facts
//                                       the migration actually branches on.
//
// WHY THE SECOND FILE EXISTS. Every decision the migration makes is structural:
// does this board record an author, is that author still a member, does the
// account hold a role that could already administer a board, do its claim and
// its mirror agree. None of that needs a real name — so the shape can be
// replayed against the emulator, which is what `migration-e2e.mjs --shape` does,
// and the rehearsal then exercises the real scripts against the real structure
// of production instead of against fixtures somebody imagined.
//
// It carries NO card data, no board names, no descriptions and no addresses.
// `migration/` is gitignored, and this repo is public; the shape file is the one
// of the two that would be harmless if that ever failed.
//
//   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/dump-migration-shape.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

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
  `Reading ${projectId}${usingEmulators ? ' (EMULATORS)' : ' (PRODUCTION)'} — nothing is written to it.\n`,
);

initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

const boards = (await db.collection('boards').get()).docs;
const userDocs = (await db.collection('users').get()).docs;

const authUsers = [];
let pageToken;
do {
  const page = await auth.listUsers(1000, pageToken);
  authUsers.push(...page.users);
  pageToken = page.pageToken;
} while (pageToken);

/**
 * Every uid the migration will look at, from BOTH directories.
 *
 * An account can exist in one and not the other — a doc with no Auth account is
 * what a half-finished restore leaves, and an Auth account with no doc is what a
 * failed provision leaves. Both change what the scripts do, so both are in here.
 */
const uids = [
  ...new Set([...authUsers.map((u) => u.uid), ...userDocs.map((d) => d.id)]),
].sort();

const authByUid = new Map(authUsers.map((u) => [u.uid, u]));
const docByUid = new Map(userDocs.map((d) => [d.id, d.data() ?? {}]));

const accounts = uids.map((uid) => {
  const a = authByUid.get(uid);
  const d = docByUid.get(uid);
  return {
    uid,
    email: a?.email ?? d?.email ?? '',
    hasAuth: Boolean(a),
    hasDoc: Boolean(d),
    // The CLAIM is what firestore.rules reads; the document is a mirror kept for
    // display. Both are recorded because the scripts branch on each, and because
    // a disagreement between them is itself a thing to notice.
    claim: { role: a?.customClaims?.role ?? '', status: a?.customClaims?.status ?? '' },
    doc: { role: d?.role ?? '', status: d?.status ?? '' },
  };
});

const boardRecords = boards.map((b) => {
  const data = b.data() ?? {};
  const memberUids = Array.isArray(data.memberUids) ? data.memberUids : [];
  const createdBy = typeof data.createdBy === 'string' ? data.createdBy : '';
  return {
    id: b.id,
    name: (data.name ?? ''),
    createdBy,
    memberUids,
    boardOwnerUids: Array.isArray(data.boardOwnerUids) ? data.boardOwnerUids : null,
    archived: data.archived === true,
    creatorIsMember: createdBy !== '' && memberUids.includes(createdBy),
  };
});

mkdirSync('migration', { recursive: true });

const manifestPath = `migration/manifest-${projectId}.json`;
writeFileSync(
  manifestPath,
  `${JSON.stringify({ projectId, takenAt: new Date().toISOString(), accounts, boards: boardRecords }, null, 2)}\n`,
);

// ---- the redacted twin -------------------------------------------------------

/**
 * uid -> u1, u2, … Stable within one dump, meaningless outside it.
 *
 * MINTED ON DEMAND, because a board can name a uid that is in neither directory:
 * an account deleted outright leaves its uid in `memberUids` for good. A fixed
 * fallback string would collapse every such uid into one alias, which changes
 * the shape — two stale members would become one, and the replay would then be
 * rehearsing a database that does not exist.
 */
const alias = new Map(uids.map((uid, i) => [uid, `u${i + 1}`]));
let minted = 0;
function aka(uid) {
  const known = alias.get(uid);
  if (known) return known;
  minted += 1;
  const made = `gone${minted}`;
  alias.set(uid, made);
  return made;
}

const shape = {
  projectId: 'redacted',
  takenAt: new Date().toISOString(),
  accounts: accounts.map((a) => ({
    uid: aka(a.uid),
    hasAuth: a.hasAuth,
    hasDoc: a.hasDoc,
    claim: a.claim,
    doc: a.doc,
  })),
  boards: boardRecords.map((b, i) => ({
    id: `b${i + 1}`,
    // The name is dropped, not aliased: nothing in the migration reads it, and a
    // board name is the sort of thing that quotes a donor or a person.
    createdBy: b.createdBy ? aka(b.createdBy) : '',
    memberUids: b.memberUids.map(aka),
    boardOwnerUids: b.boardOwnerUids ? b.boardOwnerUids.map(aka) : null,
    archived: b.archived,
  })),
};
const shapePath = `migration/shape-${projectId}.json`;
writeFileSync(shapePath, `${JSON.stringify(shape, null, 2)}\n`);

// ---- what the operator needs to see -----------------------------------------

const authorless = boardRecords.filter((b) => !b.createdBy);
const orphaned = boardRecords.filter((b) => b.createdBy && !b.creatorIsMember);
const alreadyOwned = boardRecords.filter((b) => (b.boardOwnerUids ?? []).length > 0);
const drift = accounts.filter((a) => a.hasAuth && a.hasDoc && a.claim.role !== a.doc.role);
const claimless = accounts.filter((a) => a.hasAuth && !a.claim.role && !a.claim.status);

console.log(`  ${manifestPath}   (REAL data — gitignored; copy it off this machine)`);
console.log(`  ${shapePath}      (redacted — safe to keep, and what the rehearsal reads)\n`);
console.log(`  boards: ${boardRecords.length}   <- pass this to verify-board-owners --expect-boards`);
if (minted > 0) {
  console.log(
    `  ${minted} uid(s) on boards belong to no account at all — an account deleted\n` +
      '  outright leaves its uid behind. They are inert, and the shape keeps them\n' +
      '  distinct so the rehearsal sees the same structure.',
  );
}
console.log(`  accounts: ${accounts.length}`);
if (alreadyOwned.length) console.log(`  already carry boardOwnerUids: ${alreadyOwned.length}`);
if (authorless.length) {
  console.log(`\n  ${authorless.length} board(s) record NO author — the backfill will ABORT on these:`);
  for (const b of authorless) console.log(`    boards/${b.id}  "${b.name}"`);
}
if (orphaned.length) {
  console.log(
    `\n  ${orphaned.length} board(s) whose creator is no longer a member. Each gets an\n` +
      '  EMPTY owner list and needs one assigned by hand (step R8):',
  );
  for (const b of orphaned) console.log(`    boards/${b.id}  "${b.name}"`);
}
if (drift.length) {
  console.log(`\n  ${drift.length} account(s) whose claim and mirror disagree:`);
  for (const a of drift) console.log(`    ${a.email || a.uid}  claim=${a.claim.role || '(none)'}  mirror=${a.doc.role || '(none)'}`);
}
if (claimless.length) {
  console.log(
    `\n  ${claimless.length} account(s) carry NO claims and cannot use the app at all.\n` +
      '  The rename repairs their mirror only; an admin must re-approve them:',
  );
  for (const a of claimless) console.log(`    ${a.email || a.uid}`);
}

console.log(
  '\nRehearse the whole upgrade against this shape, on the emulators:\n' +
    '  JAVA_HOME=$(npx sabeel-ci jdk21) firebase emulators:exec --project $(npx sabeel-ci ports --project) \\\n' +
    `    --only firestore,auth "node scripts/migration-e2e.mjs --shape ${shapePath}"`,
);
process.exit(0);
