// Rename the `manager` role to `organizer`, in custom claims and in the mirror.
//
// Step R7b of the board-ownership migration. `manager` used to mean three
// unrelated things — administer any board, curate org labels, see stats — and
// two of them have moved elsewhere. What is left is "may start a board", which
// is what `organizer` names. There is NO compatibility shim: after the R7a rules
// and functions deploy, nothing recognises `manager` at all, so an account still
// holding it can sign in and do nothing but read the boards it belongs to.
//
// RUN IT IMMEDIATELY AFTER R7a — target under two minutes. That gap is the one
// window where `setUserAccess` cannot disable, reject or restore anyone still
// holding `manager` (it sends role and status together, and the role is now
// invalid). This script is an Admin SDK tool, so it can set status directly if
// the gap ever has to be worked through.
//
// THE MANIFEST IS THE ONLY WAY BACK. Custom claims are in no backup — Firebase
// Auth is a separate system from Firestore and neither PITR nor the daily
// exports touch it (docs/DEPLOY.md § Auth is not in any backup). So the manifest
// is written, flushed and re-read BEFORE the first claim changes, and a re-run
// never overwrites it — it only APPENDS anyone new. The first run holds the true
// pre-migration state, and a second pass after a partial run would otherwise
// record the half-migrated one as the thing to restore.
//
// DRY RUN BY DEFAULT. `--apply` writes.
//
//   # emulators
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports firestore) FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports auth) \
//     GCLOUD_PROJECT=$(npx sabeel-ci ports --project) node scripts/rename-manager-role.mjs --apply
//   # production
//   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/rename-manager-role.mjs --apply
//   # and back again
//   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/rename-manager-role.mjs \
//     --revert migration/role-rename-manager-to-organizer.json --apply
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const OLD_ROLE = 'manager';
const NEW_ROLE = 'organizer';
const DEFAULT_MANIFEST = 'migration/role-rename-manager-to-organizer.json';

const APPLY = process.argv.includes('--apply');
const revertIdx = process.argv.indexOf('--revert');
const REVERT = revertIdx >= 0 ? process.argv[revertIdx + 1] : null;
const manifestIdx = process.argv.indexOf('--manifest');
const MANIFEST = manifestIdx >= 0 ? process.argv[manifestIdx + 1] : DEFAULT_MANIFEST;

if (revertIdx >= 0 && !REVERT) {
  console.error('usage: --revert <path to the manifest written by the forward run>');
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
const usingEmulators = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
console.log(
  `${REVERT ? `Reverting from ${REVERT}` : `Renaming ${OLD_ROLE} -> ${NEW_ROLE}`} on ` +
    `${projectId}${usingEmulators ? ' (EMULATORS)' : ' (PRODUCTION)'}` +
    `${APPLY ? '' : '  — DRY RUN, nothing will be written'}\n`,
);

initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

/** Every Auth account. Small enough not to need paging; paged anyway, for free. */
async function allAuthUsers() {
  const out = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    out.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return out;
}

/**
 * Write both halves of one account's access.
 *
 * `setCustomUserClaims` REPLACES the whole claims object — it does not merge —
 * so status has to be written back alongside the role every time. Sending role
 * alone drops status, and `firestore.rules` defaults a missing status to `''`,
 * which denies everything: a silent, total lockout of whoever was migrated.
 *
 * `claimsUpdatedAt` moving is what makes the change land in about a second:
 * `session.ts` watches the mirror and force-refreshes the ID token when it
 * moves. Without it the old claim sits in the client's token for up to an hour.
 */
async function writeAccess(uid, role, status, by) {
  await auth.setCustomUserClaims(uid, { role, status });
  await mirror(uid, { role, status }, by);
}

/** The display copy alone, stamped so a signed-in client refreshes its token. */
async function mirror(uid, fields, by) {
  await db.doc(`users/${uid}`).set(
    { ...fields, claimsUpdatedAt: FieldValue.serverTimestamp(), accessChangedBy: by },
    { merge: true },
  );
}

if (REVERT) {
  if (!existsSync(REVERT)) {
    console.error(`No such manifest: ${REVERT}`);
    process.exit(1);
  }
  const m = JSON.parse(readFileSync(REVERT, 'utf8'));
  if (m.projectId !== projectId) {
    console.error(
      `ABORT: that manifest was taken from ${m.projectId}, and GCLOUD_PROJECT is ` +
        `${projectId}. Restoring one project's claims onto another is not a thing ` +
        'you can undo.',
    );
    process.exit(1);
  }

  for (const e of m.entries) {
    console.log(
      `  ${e.email || e.uid}  claims ${e.claims.role || '(none)'}/${e.claims.status || '(none)'}` +
        `  doc ${e.doc.role || '(none)'}/${e.doc.status || '(none)'}`,
    );
  }
  if (!APPLY) {
    console.log(
      `\n${m.entries.length} account(s) would be restored to their pre-migration access.` +
        '\nDRY RUN — nothing was written. Re-run with --apply.',
    );
    process.exit(0);
  }

  let restored = 0;
  for (const e of m.entries) {
    /**
     * EXACTLY what was recorded, on both halves independently.
     *
     * A revert is an undo, not a repair. Deriving one half from the other —
     * writing the doc's role into the claims because the claims were empty —
     * would GRANT access the account never had: an account whose doc said
     * manager/active while it carried no claims at all could not use the app,
     * and inventing claims for it would let it in. Least privilege wins over
     * tidiness on the emergency path.
     *
     * `setCustomUserClaims(uid, null)` is how "there were none" goes back.
     */
    const hadClaims = Boolean(e.claims.role || e.claims.status);
    if (hadClaims) {
      await auth.setCustomUserClaims(e.uid, { role: e.claims.role, status: e.claims.status });
    } else {
      await auth.setCustomUserClaims(e.uid, null);
    }
    // The mirror goes back to ITS recorded values, and only the ones that were
    // there — writing an empty string would put a role no rule matches into the
    // document `restore-auth.mjs` rebuilds claims from.
    const docFields = {};
    if (e.doc.role) docFields.role = e.doc.role;
    if (e.doc.status) docFields.status = e.doc.status;
    await mirror(e.uid, docFields, 'rename-manager-role-script');
    restored += 1;
    console.log(
      `  restored ${e.email || e.uid} -> claims ` +
        `${hadClaims ? `${e.claims.role}/${e.claims.status}` : '(cleared)'}` +
        `, doc ${e.doc.role || '(unchanged)'}/${e.doc.status || '(unchanged)'}`,
    );
  }
  // The mirror-only entries go back too, or a revert would leave the rename
  // half-undone on exactly the accounts nothing else will fix.
  for (const d of m.docOnly ?? []) {
    await mirror(d.uid, { role: d.doc.role }, 'rename-manager-role-script');
    restored += 1;
    console.log(`  restored ${d.email || d.uid} -> doc ${d.doc.role} (mirror only)`);
  }
  console.log(`\nRestored ${restored} account(s).`);
  process.exit(0);
}

// ---- forward ----------------------------------------------------------------

/**
 * ORDER GATE: the backfill must have run first.
 *
 * Renaming the role takes board authority off everybody who held `manager` —
 * under the old rules AND the new ones, since neither recognises `organizer` as
 * board authority. `boardOwnerUids` is what they land on instead, so running
 * this against boards that do not carry it yet leaves nobody able to administer
 * anything, which is the one state in this migration the runbook says never to
 * enter. Refuse rather than describe it afterwards.
 *
 * Archived boards are excluded: they are out of everyone's way by definition, and
 * one left behind by an aborted backfill should not block the window.
 */
const boardsMissingOwners = (await db.collection('boards').get()).docs.filter(
  (d) => d.data()?.archived !== true && !Array.isArray(d.data()?.boardOwnerUids),
);
if (boardsMissingOwners.length > 0) {
  console.error(
    `ABORT: ${boardsMissingOwners.length} active board(s) have no boardOwnerUids, so\n` +
      'renaming the role now would leave nobody able to administer them:',
  );
  for (const d of boardsMissingOwners) {
    console.error(`  boards/${d.id}  "${d.data()?.name ?? ''}"`);
  }
  console.error('\nRun scripts/backfill-board-owners.mjs --apply first.');
  process.exit(1);
}

const users = await allAuthUsers();
const docs = await db.collection('users').get();
const docById = new Map(docs.docs.map((d) => [d.id, d.data() ?? {}]));

const entries = [];
for (const u of users) {
  const claims = u.customClaims ?? {};
  const doc = docById.get(u.uid) ?? {};
  // Either half being stale is enough to matter: the claims are what the rules
  // trust, and the mirror is what `restore-auth.mjs` would rebuild them from.
  if (claims.role !== OLD_ROLE && doc.role !== OLD_ROLE) continue;
  entries.push({
    uid: u.uid,
    email: u.email ?? '',
    claims: { role: claims.role ?? '', status: claims.status ?? '' },
    doc: { role: doc.role ?? '', status: doc.status ?? '' },
  });
}

/**
 * A doc carrying the old role with no Auth account behind it. `restore-auth.mjs`
 * would rebuild claims from that doc and reinstate a role nothing recognises, so
 * these are repaired too — mirror only, since there is no account to claim.
 */
const docOnly = [];
for (const [uid, d] of docById) {
  if (d.role === OLD_ROLE && !users.some((u) => u.uid === uid)) {
    docOnly.push({ uid, email: d.email ?? '', doc: { role: d.role, status: d.status ?? '' } });
  }
}

if (entries.length === 0 && docOnly.length === 0) {
  console.log(`No account holds ${OLD_ROLE}. Nothing to do.`);
  process.exit(0);
}

/**
 * An account with NO claims at all cannot use the app, whatever its document
 * says: `firestore.rules` defaults a missing status to `''`, which denies
 * everything. Renaming its mirror is a rename; MINTING claims for it would be a
 * grant, and this script is not the place a person gets let in. The mirror is
 * repaired so a later `restore-auth.mjs` does not rebuild the retired role, and
 * the operator is told to have an admin re-approve them.
 */
const claimless = entries.filter((e) => !e.claims.role && !e.claims.status);

for (const e of entries) {
  const bare = claimless.includes(e);
  console.log(
    `  ${e.email || e.uid}  claims ${e.claims.role || '(none)'}/${e.claims.status || '(none)'}` +
      `  doc ${e.doc.role || '(none)'}/${e.doc.status || '(none)'}` +
      (bare
        ? `  ->  ${NEW_ROLE} in the MIRROR ONLY (no claims to rename; an admin must re-approve)`
        : `  ->  ${NEW_ROLE}/${e.claims.status || e.doc.status || 'pending'}`),
  );
}
for (const d of docOnly) {
  console.log(`  ${d.email || d.uid}  DOC ONLY (no Auth account)  ->  ${NEW_ROLE} in the mirror`);
}

if (!APPLY) {
  console.log(
    `\n${entries.length} account(s) and ${docOnly.length} orphan mirror(s) would change.` +
      `\nManifest would be written to ${MANIFEST}.` +
      '\nDRY RUN — nothing was written. Re-run with --apply.',
  );
  process.exit(0);
}

// The manifest goes to disk, and is READ BACK, before a single claim moves.
// Claims are in no backup; if this file is not on disk there is no way back.
if (existsSync(MANIFEST)) {
  const prior = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  // Kept, not replaced: it holds the PRE-migration state, and a second pass
  // after a partial run would otherwise record the half-migrated one as the
  // thing to restore. Anyone NEW is appended rather than dropped — an account
  // promoted between the two runs is still an account the revert has to know
  // about, and appending cannot lose what is already there.
  const known = new Set(prior.entries.map((e) => e.uid));
  const fresh = entries.filter((e) => !known.has(e.uid));
  if (fresh.length > 0) {
    prior.entries.push(...fresh);
    writeFileSync(MANIFEST, `${JSON.stringify(prior, null, 2)}\n`);
  }
  console.log(
    `Reusing the existing manifest at ${MANIFEST} (${prior.entries.length} entr` +
      `${prior.entries.length === 1 ? 'y' : 'ies'}` +
      `${fresh.length > 0 ? `, ${fresh.length} newly appended` : ''}).\n`,
  );
} else {
  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(
    MANIFEST,
    `${JSON.stringify(
      {
        projectId,
        direction: `${OLD_ROLE}->${NEW_ROLE}`,
        writtenAt: new Date().toISOString(),
        entries,
        docOnly,
      },
      null,
      2,
    )}\n`,
  );
  const check = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  if (check.entries.length !== entries.length) {
    console.error(`ABORT: ${MANIFEST} did not read back intact. Nothing was changed.`);
    process.exit(1);
  }
  console.log(
    `Manifest written to ${MANIFEST} — ${entries.length} account(s). This file is\n` +
      'the ONLY record of the previous claims. It is gitignored (it carries real\n' +
      'addresses and this repo is public); keep a copy off this machine.\n',
  );
}

let changed = 0;
for (const e of entries) {
  if (claimless.includes(e)) {
    await mirror(e.uid, { role: NEW_ROLE }, 'rename-manager-role-script');
    changed += 1;
    console.log(`  ${e.email || e.uid} -> ${NEW_ROLE} (mirror only — no claims to rename)`);
    continue;
  }
  // Status comes from the claims first: they are the live authority, and a
  // mirror that disagrees is the stale copy. Falling back to `pending` rather
  // than `active` keeps the failure direction safe — an admin re-approves.
  const status = e.claims.status || e.doc.status || 'pending';
  await writeAccess(e.uid, NEW_ROLE, status, 'rename-manager-role-script');
  changed += 1;
  console.log(`  ${e.email || e.uid} -> ${NEW_ROLE}/${status}`);
}
for (const d of docOnly) {
  await db
    .doc(`users/${d.uid}`)
    .set(
      { role: NEW_ROLE, accessChangedBy: 'rename-manager-role-script' },
      { merge: true },
    );
  console.log(`  ${d.email || d.uid} -> ${NEW_ROLE} (mirror only)`);
}

console.log(
  `\nRenamed ${changed} account(s) and ${docOnly.length} orphan mirror(s).\n` +
    'Anyone signed in picks it up within about a second.',
);
if (claimless.length > 0) {
  console.log(
    `\n${claimless.length} of those carried NO custom claims, so only their mirror\n` +
      'was renamed. They cannot use the app at all until an admin re-approves them\n' +
      'from the People screen, which writes both halves. verify-board-owners.mjs\n' +
      'reports each one until that happens:',
  );
  for (const e of claimless) console.log(`  ${e.email || e.uid}`);
}
console.log('\nNext: node scripts/verify-board-owners.mjs');
process.exit(0);
