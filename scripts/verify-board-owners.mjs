// Prove the board-ownership migration landed. READ-ONLY — it writes nothing.
//
// Steps R4 and R7c of the migration. Every check here corresponds to a way the
// migration can appear to have worked while leaving something unusable, and the
// point of running it is that none of these are visible from the app: a board
// with no owner looks completely normal until somebody tries to rename it.
//
// `healthCheck` is not this. It counts documents, so it is blind to a
// field-level change, and it re-baselines every run — a corruption alerts once
// at 03:15 and then normalises.
//
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports firestore) FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports auth) \
//     GCLOUD_PROJECT=demo-sabeel-kanban node scripts/verify-board-owners.mjs
//   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/verify-board-owners.mjs --expect-boards 9
//
// Exits non-zero if anything failed, so it can gate the next migration step.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const RETIRED_ROLE = 'manager';
const VALID_ROLES = ['member', 'organizer', 'admin'];

const expectIdx = process.argv.indexOf('--expect-boards');
const EXPECT_BOARDS = expectIdx >= 0 ? Number(process.argv[expectIdx + 1]) : null;
if (expectIdx >= 0 && !Number.isInteger(EXPECT_BOARDS)) {
  console.error('usage: --expect-boards <the count from the R1 manifest>');
  process.exit(1);
}

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
  `Verifying board ownership on ${projectId}` +
    `${usingEmulators ? ' (EMULATORS)' : ' (PRODUCTION)'}\n`,
);

initializeApp({ projectId });
const db = getFirestore();

const failures = [];
const warnings = [];
const fail = (m) => failures.push(m);
const warn = (m) => warnings.push(m);
const pass = (m) => console.log(`  ok    ${m}`);

const boards = await db.collection('boards').get();

// 1. Nothing vanished. `update()` cannot delete a document, so a shortfall here
//    means something other than this migration removed one.
if (EXPECT_BOARDS === null) {
  console.log(`  info  ${boards.size} board(s) — pass --expect-boards to assert this`);
} else if (boards.size === EXPECT_BOARDS) {
  pass(`${boards.size} board(s), matching the manifest`);
} else {
  fail(`board count is ${boards.size}, the manifest said ${EXPECT_BOARDS}`);
}

// 2. Every board carries the field. Absent, `ownsBoard()` falls back to `[]` and
//    the board is administrable by admins only, silently and forever.
const missingField = boards.docs.filter((d) => !Array.isArray(d.data()?.boardOwnerUids));
if (missingField.length === 0) {
  pass('every board carries boardOwnerUids');
} else {
  fail(`${missingField.length} board(s) have no boardOwnerUids — the backfill did not finish`);
  for (const d of missingField) fail(`    boards/${d.id}  "${d.data()?.name ?? ''}"`);
}

// 3. Every owner is a member. An entry that is not is INERT rather than
//    dangerous — `ownsBoard()` requires both — but it is also a lie on screen,
//    and it is what `removeBoardMember` forgetting its arrayRemove looks like.
const strays = [];
for (const d of boards.docs) {
  const data = d.data() ?? {};
  const members = Array.isArray(data.memberUids) ? data.memberUids : [];
  for (const uid of Array.isArray(data.boardOwnerUids) ? data.boardOwnerUids : []) {
    if (!members.includes(uid)) strays.push(`boards/${d.id} "${data.name ?? ''}" owner ${uid}`);
  }
}
if (strays.length === 0) {
  pass('every owner is also a member of their board');
} else {
  fail(`${strays.length} owner entr${strays.length === 1 ? 'y is' : 'ies are'} not board members`);
  for (const s of strays) fail(`    ${s}`);
}

// 4. Every board has an author. Nothing here can repair one that does not — the
//    backfill refuses to run against it, and the update rule pins the field.
const authorless = boards.docs.filter((d) => {
  const by = d.data()?.createdBy;
  return typeof by !== 'string' || by.length === 0;
});
if (authorless.length === 0) {
  pass('every board records who created it');
} else {
  fail(`${authorless.length} board(s) have no createdBy`);
  for (const d of authorless) fail(`    boards/${d.id}  "${d.data()?.name ?? ''}"`);
}

// 5. Ownerless boards. A WARNING, not a failure: the backfill produces these
//    deliberately where the creator has left the board, and an admin assigns
//    them by hand. Loud, because nothing in the app says why the buttons are gone.
const ownerless = boards.docs.filter(
  (d) => Array.isArray(d.data()?.boardOwnerUids) && d.data().boardOwnerUids.length === 0,
);
if (ownerless.length === 0) {
  pass('every board has at least one owner');
} else {
  warn(
    `${ownerless.length} board(s) have NO owner — only an admin can administer ` +
      'them until someone is given ownership in Board settings:',
  );
  for (const d of ownerless) {
    const archived = d.data()?.archived === true ? '  (archived)' : '';
    warn(`    boards/${d.id}  "${d.data()?.name ?? ''}"${archived}`);
  }
}

// 6/7. Claims are what the rules trust; the mirror is what a later
//      `restore-auth.mjs` would rebuild them from. A disagreement means one of
//      the two is a time bomb, and `manager` anywhere means the rename missed.
const docs = await db.collection('users').get();
const docById = new Map(docs.docs.map((d) => [d.id, d.data() ?? {}]));

const authUsers = [];
let pageToken;
do {
  const page = await getAuth().listUsers(1000, pageToken);
  authUsers.push(...page.users);
  pageToken = page.pageToken;
} while (pageToken);

const mismatched = [];
const retired = [];
const unknownRole = [];
const claimless = [];
for (const u of authUsers) {
  const claims = u.customClaims ?? {};
  const doc = docById.get(u.uid) ?? {};
  const who = u.email || u.uid;
  // No claims AT ALL is its own failure, separated from the generic mismatch
  // below rather than folded into it. `firestore.rules` defaults a missing status
  // to '', which denies everything — such an account can sign in and do nothing,
  // and no script may mint claims for it. An admin re-approving from People
  // writes both halves and is the only fix.
  //
  // Reported INSTEAD of a mismatch, not as well as: every claimless account
  // trivially disagrees with its mirror, and two lines saying the same thing
  // twice is how a report stops being read. The retired-role check below still
  // runs on it, because its document is exactly where the old role hides.
  const bare = !claims.role && !claims.status;
  if (bare) {
    claimless.push(`${who}  doc ${doc.role ?? '(none)'}/${doc.status ?? '(none)'}`);
  } else if (claims.role !== doc.role || claims.status !== doc.status) {
    mismatched.push(
      `${who}  claims ${claims.role ?? '(none)'}/${claims.status ?? '(none)'}  ` +
        `doc ${doc.role ?? '(none)'}/${doc.status ?? '(none)'}`,
    );
  }
  if (claims.role === RETIRED_ROLE || doc.role === RETIRED_ROLE) retired.push(who);
  if (claims.role && !VALID_ROLES.includes(claims.role)) {
    unknownRole.push(`${who} claims role=${claims.role}`);
  }
}
for (const [uid, d] of docById) {
  if (d.role === RETIRED_ROLE && !authUsers.some((u) => u.uid === uid)) {
    retired.push(`${d.email || uid} (mirror only, no Auth account)`);
  }
}

if (claimless.length === 0) {
  pass('every account carries custom claims');
} else {
  fail(`${claimless.length} account(s) carry NO custom claims and cannot use the app`);
  for (const c of claimless) fail(`    ${c}`);
  fail('    An admin must re-approve each one from the People screen.');
}

if (mismatched.length === 0) {
  pass(`${authUsers.length} account(s): claims and mirror agree`);
} else {
  fail(`${mismatched.length} account(s) whose claims and mirror disagree`);
  for (const m of mismatched) fail(`    ${m}`);
}

if (retired.length === 0) {
  pass(`no account holds the retired "${RETIRED_ROLE}" role`);
} else {
  fail(`${retired.length} account(s) still hold "${RETIRED_ROLE}" — re-run rename-manager-role.mjs`);
  for (const r of retired) fail(`    ${r}`);
}

if (unknownRole.length === 0) {
  pass('every claimed role is one this app recognises');
} else {
  fail(`${unknownRole.length} account(s) carry a role no rule matches`);
  for (const u of unknownRole) fail(`    ${u}`);
}

if (warnings.length > 0) {
  console.log('\nWARNINGS — expected in places, but read them:');
  for (const w of warnings) console.log(`  warn  ${w}`);
}

if (failures.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${failures.length} check(s) failed. Do not proceed to the next step.`);
  process.exit(1);
}

console.log(`\nAll checks passed${warnings.length > 0 ? `, with ${warnings.length} warning(s)` : ''}.`);
process.exit(0);
