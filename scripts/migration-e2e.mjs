/**
 * The board-ownership migration scripts, rehearsed end to end.
 *
 *   npm run test:emulator    # its rules pass runs this first, on an empty project
 *
 *   # alone, or against a production shape (`--shape`, below):
 *   JAVA_HOME=$(npx sabeel-ci jdk21) firebase emulators:exec \
 *     --project $(npx sabeel-ci ports --project) --only firestore,auth \
 *     "node scripts/migration-e2e.mjs [--shape migration/shape-<project>.json]"
 *
 * These four scripts change who can do what, against live production data, and
 * they are run by hand at most a handful of times — so nothing else exercises
 * them. This does: it seeds the awkward cases, drives each script as a real
 * subprocess (exit code included, since three of the gates ARE exit codes), and
 * asserts the round trip in both directions.
 *
 * The awkward cases are the point. A board whose creator has left it, a board
 * that already carries the field, an archived one, an account whose claims and
 * mirror disagree, a user doc with no Auth account behind it, a board with no
 * author at all. Each was chosen because it produces something plausible and
 * wrong if the script does not handle it — most of them silently.
 *
 * Needs firestore + auth ONLY. Deliberately no functions emulator: these scripts
 * write with the Admin SDK, and running triggers would add writes this suite
 * would then have to reason about.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { shapeMode } from './migration-shape-replay.mjs';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { PORTS, PROJECT } from './lib/emulators.mjs';

// The scripts under test write their manifests to `migration/` relative to the
// working directory, as an operator runs them from the repo root. So does this,
// whoever starts it: `npm run test:emulator` starts it in functions/.
process.chdir(resolve(import.meta.dirname, '..'));

process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${PORTS.auth}`;
process.env.GCLOUD_PROJECT = PROJECT;

const MANIFEST = resolve(import.meta.dirname, '..', 'migration', 'rehearsal-role-rename.json');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Run one migration script as a subprocess. Its exit code is part of its contract. */
function run(script, ...args) {
  const r = spawnSync('node', [resolve(import.meta.dirname, script), ...args], {
    env: { ...process.env },
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

/**
 * REPLAY MODE. `--shape migration/shape-<project>.json` seeds the emulator from
 * the redacted structure of a real database and runs the whole upgrade against
 * it, instead of the hand-written fixtures below.
 *
 * The fixtures are still the default and still the more DEMANDING test — they
 * contain every awkward case on purpose, and production may contain none of
 * them. Replay answers the other question: does the sequence work on the shape
 * that actually exists, with the number of boards and accounts that actually
 * exist? Neither substitutes for the other, which is why this is a mode rather
 * than a replacement.
 */
const shapeIdx = process.argv.indexOf('--shape');
if (shapeIdx >= 0) {
  const path = process.argv[shapeIdx + 1];
  if (!path) {
    console.error('usage: --shape <migration/shape-*.json from dump-migration-shape.mjs>');
    process.exit(1);
  }
  await shapeMode({ path, db, auth, run, check, results });
  const failedShape = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failedShape.length}/${results.length} checks passed.`);
  if (failedShape.length > 0) {
    console.log('\nFailed:');
    for (const f of failedShape) console.log(`  - ${f.name}`);
    process.exit(1);
  }
  process.exit(0);
}

const A = 'mig_admin';
const M1 = 'mig_mgr1';
const M2 = 'mig_mgr2';
const MEM = 'mig_member';
/** Claims say manager, the mirror says member. The rename must settle both. */
const STALE = 'mig_stale';
/**
 * The inverse drift: the DOC says manager, the account carries no claims at all.
 * The revert has nothing recorded to put back, and writing the recorded empty
 * string would mint a role no rule matches.
 */
const CLAIMLESS = 'mig_claimless';
/** A user doc with no Auth account — what a half-finished Auth restore leaves. */
const DOC_ONLY = 'mig_doconly';

async function makeUser(uid, role, status, { claims = null, authAccount = true } = {}) {
  if (authAccount) {
    await auth.createUser({ uid, email: `${uid}@oursabeel.com`, emailVerified: true });
    // `claims: false` means an account that carries none at all, which is what a
    // half-finished restore or a very old account looks like.
    if (claims !== false) await auth.setCustomUserClaims(uid, claims ?? { role, status });
  }
  await db.doc(`users/${uid}`).set({
    email: `${uid}@oursabeel.com`,
    displayName: uid,
    role,
    status,
    createdAt: 1,
  });
}

function board(overrides) {
  return {
    name: 'Board',
    description: '',
    archived: false,
    columns: [{ id: 'c1', name: 'To Do' }],
    columnIds: ['c1'],
    memberUids: [],
    memberProfiles: {},
    activeCardCount: 0,
    createdAt: 1,
    createdBy: '',
    ...overrides,
  };
}

console.log('Seeding…');
rmSync(MANIFEST, { force: true });

await makeUser(A, 'admin', 'active');
await makeUser(M1, 'manager', 'active');
await makeUser(M2, 'manager', 'active');
await makeUser(MEM, 'member', 'active');
await makeUser(STALE, 'member', 'active', { claims: { role: 'manager', status: 'active' } });
await makeUser(CLAIMLESS, 'manager', 'active', { claims: false });
await makeUser(DOC_ONLY, 'manager', 'active', { authAccount: false });

const B_NORMAL = 'mig_b_normal';
const B_LEFT = 'mig_b_left';
const B_MANY = 'mig_b_many';
const B_ARCHIVED = 'mig_b_archived';
const B_DONE = 'mig_b_done';

await db.doc(`boards/${B_NORMAL}`).set(
  board({ name: 'Normal', createdBy: M1, memberUids: [M1, MEM] }),
);
// The creator was removed from their own board. Naming them owner would be a
// false record — `ownsBoard` needs membership too, so it would grant nothing.
await db.doc(`boards/${B_LEFT}`).set(
  board({ name: 'Creator left', createdBy: M2, memberUids: [MEM] }),
);
await db.doc(`boards/${B_MANY}`).set(
  board({ name: 'Several members', createdBy: A, memberUids: [A, M1, MEM] }),
);
await db.doc(`boards/${B_ARCHIVED}`).set(
  board({ name: 'Archived', createdBy: M1, memberUids: [M1], archived: true }),
);
// Already migrated — a partial run, or a re-run. Must be left exactly as-is.
await db.doc(`boards/${B_DONE}`).set(
  board({ name: 'Already done', createdBy: M1, memberUids: [M1, MEM], boardOwnerUids: [MEM] }),
);

const owners = async (id) => (await db.doc(`boards/${id}`).get()).data()?.boardOwnerUids;
const roleOf = async (uid) => {
  const claims = (await auth.getUser(uid).catch(() => null))?.customClaims ?? {};
  const doc = (await db.doc(`users/${uid}`).get()).data() ?? {};
  return { claims: `${claims.role ?? '-'}/${claims.status ?? '-'}`, doc: `${doc.role ?? '-'}/${doc.status ?? '-'}` };
};

// ---- backfill: the gates ----------------------------------------------------
console.log('\nbackfill-board-owners — gates');

{
  const r = run('backfill-board-owners.mjs');
  check('dry run reports every board and writes nothing', r.code === 0 && (await owners(B_NORMAL)) === undefined);
  check('dry run says so out loud', r.out.includes('DRY RUN'));
  check(
    'dry run names the board whose creator left',
    r.out.includes(B_LEFT) && r.out.includes('NO OWNER'),
    r.out.includes('NO OWNER') ? '' : r.out.slice(-400),
  );
}

{
  const r = spawnSync('node', [resolve(import.meta.dirname, 'backfill-board-owners.mjs')], {
    env: { ...process.env, GCLOUD_PROJECT: '' },
    encoding: 'utf8',
  });
  check('refuses to run without GCLOUD_PROJECT', r.status === 1);
}

{
  // GATE 1 — no author. Writing `['']` would mint an owner no uid can ever match.
  await db.doc('boards/mig_b_authorless').set(board({ name: 'No author', memberUids: [MEM] }));
  const r = run('backfill-board-owners.mjs', '--apply');
  check('ABORTS on a board with no createdBy', r.code === 1 && r.out.includes('ABORT'));
  check('names the offending board', r.out.includes('mig_b_authorless'));
  check('and wrote nothing first', (await owners(B_NORMAL)) === undefined);
  await db.doc('boards/mig_b_authorless').delete();
}

{
  // GATE 3 — an owner who could not administer a board under the OLD rules. This
  // is what makes shipping the client before the rules flip safe: everyone the
  // new client offers buttons to is someone the old rule still allows.
  await db.doc('boards/mig_b_lowrole').set(
    board({ name: 'Member-created', createdBy: MEM, memberUids: [MEM] }),
  );
  const r = run('backfill-board-owners.mjs', '--apply');
  check('ABORTS when an owner-to-be is only a member', r.code === 1 && r.out.includes(MEM));
  check('and still wrote nothing', (await owners(B_NORMAL)) === undefined);
  await db.doc('boards/mig_b_lowrole').delete();
}

{
  /**
   * GATE 3 READS THE CLAIM, not the mirror.
   *
   * The gate reasons about what `firestore.rules` will allow, and rules read the
   * token. Checking `users/{uid}` instead would pass an account whose document
   * says manager and whose token says member — precisely the case where the new
   * client offers buttons that fail — and abort on the harmless inverse.
   *
   * `mig_docmgr` is that first case: mirror manager, claim member.
   */
  await makeUser('mig_docmgr', 'manager', 'active', {
    claims: { role: 'member', status: 'active' },
  });
  await db.doc('boards/mig_b_docmgr').set(
    board({ name: 'Doc says manager', createdBy: 'mig_docmgr', memberUids: ['mig_docmgr'] }),
  );
  const r = run('backfill-board-owners.mjs', '--apply');
  check(
    'ABORTS on an owner whose MIRROR says manager but whose CLAIM says member',
    r.code === 1 && r.out.includes('mig_docmgr'),
    r.out.slice(-300),
  );
  check('and says which source it judged by', r.out.includes('from the claim'));
  await db.doc('boards/mig_b_docmgr').delete();
  await auth.deleteUser('mig_docmgr');
  await db.doc('users/mig_docmgr').delete();

  // The harmless inverse must NOT abort: STALE's claim says manager while its
  // mirror says member, and the claim is the one the rules will read.
  await db.doc('boards/mig_b_stale').set(
    board({ name: 'Claim says manager', createdBy: STALE, memberUids: [STALE] }),
  );
  const ok = run('backfill-board-owners.mjs');
  check('accepts the inverse, where the CLAIM is the one that qualifies', ok.code === 0);
  check('and reports the disagreement rather than swallowing it', ok.out.includes('claim=manager'));
  await db.doc('boards/mig_b_stale').delete();
}

// ---- backfill: the canary and the run ---------------------------------------
console.log('\nbackfill-board-owners — apply');

{
  const r = run('backfill-board-owners.mjs', '--only', B_NORMAL, '--apply');
  const one = await owners(B_NORMAL);
  check('--only writes exactly the named board', r.code === 0 && JSON.stringify(one) === JSON.stringify([M1]));
  check('--only leaves the others alone', (await owners(B_MANY)) === undefined);
}

{
  const r = run('backfill-board-owners.mjs', '--apply');
  check('exits clean', r.code === 0, r.code === 0 ? '' : r.out.slice(-500));
  check('the creator becomes the owner', JSON.stringify(await owners(B_MANY)) === JSON.stringify([A]));
  check('an archived board is migrated too', JSON.stringify(await owners(B_ARCHIVED)) === JSON.stringify([M1]));
  check(
    'a board whose creator left gets an HONEST empty list',
    JSON.stringify(await owners(B_LEFT)) === JSON.stringify([]),
  );
  check(
    'an already-migrated board is untouched',
    JSON.stringify(await owners(B_DONE)) === JSON.stringify([MEM]),
  );
  check('and it says which boards need a hand', r.out.includes('assign by hand'));
}

{
  const before = JSON.stringify(await owners(B_NORMAL));
  const r = run('backfill-board-owners.mjs', '--apply');
  check(
    'is idempotent — a second run changes nothing',
    r.code === 0 && JSON.stringify(await owners(B_NORMAL)) === before,
  );
  check('and reports them as already done', /already had owners/.test(r.out));
}

// ---- verify: it must FAIL before the rename ---------------------------------
console.log('\nverify-board-owners — before the rename');

{
  const r = run('verify-board-owners.mjs');
  // A verifier that cannot fail proves nothing, so this is asserted first, on a
  // state that is genuinely not finished: the claims still say `manager`.
  check('fails while any account still holds the retired role', r.code === 1);
  check('says which accounts', r.out.includes(`${M1}@oursabeel.com`));
  check('warns about the ownerless board without failing on it', r.out.includes('NO owner'));
  check('counts the boards when asked', run('verify-board-owners.mjs', '--expect-boards', '5').out.includes('matching the manifest'));
  check('fails on a board count that moved', run('verify-board-owners.mjs', '--expect-boards', '4').code === 1);
}

{
  // A stray owner is inert — `ownsBoard` needs membership too — but it is a lie
  // on screen, and it is exactly what a `removeBoardMember` that forgot its
  // arrayRemove would leave behind.
  await db.doc(`boards/${B_MANY}`).update({ boardOwnerUids: FieldValue.arrayUnion('mig_ghost') });
  const r = run('verify-board-owners.mjs');
  check('fails on an owner who is not a member', r.code === 1 && r.out.includes('mig_ghost'));
  await db.doc(`boards/${B_MANY}`).update({ boardOwnerUids: FieldValue.arrayRemove('mig_ghost') });
}

{
  await db.doc(`boards/${B_NORMAL}`).update({ boardOwnerUids: FieldValue.delete() });
  const r = run('verify-board-owners.mjs');
  check('fails on a board the backfill missed', r.code === 1 && r.out.includes('did not finish'));
  await db.doc(`boards/${B_NORMAL}`).update({ boardOwnerUids: [M1] });
}

// ---- rename ------------------------------------------------------------------
console.log('\nrename-manager-role');

{
  /**
   * ORDER GATE. Renaming the role takes board authority off everyone holding
   * `manager`, and `boardOwnerUids` is what they are supposed to land on — so
   * running this before the backfill leaves nobody able to administer anything,
   * the one state the runbook says never to enter.
   */
  await db.doc('boards/mig_b_nofield').set(
    board({ name: 'Not backfilled', createdBy: M1, memberUids: [M1] }),
  );
  const r = run('rename-manager-role.mjs', '--manifest', MANIFEST, '--apply');
  check('ABORTS if any active board has not been backfilled', r.code === 1);
  check('and names it', r.out.includes('mig_b_nofield'));
  check('and says what to run first', r.out.includes('backfill-board-owners.mjs --apply'));
  check('having changed nothing', (await roleOf(M1)).claims === 'manager/active');

  // An ARCHIVED board left behind must not block the window: it is out of
  // everyone's way by definition.
  await db.doc('boards/mig_b_nofield').update({ archived: true });
  const arch = run('rename-manager-role.mjs', '--manifest', MANIFEST);
  check('but an archived one does not block it', arch.code === 0, arch.out.slice(-300));
  await db.doc('boards/mig_b_nofield').delete();
}

{
  const r = run('rename-manager-role.mjs', '--manifest', MANIFEST);
  check('dry run writes nothing', r.code === 0 && (await roleOf(M1)).claims === 'manager/active');
  check('dry run writes no manifest either', !existsSync(MANIFEST));
  check('finds the account whose claims and mirror disagree', r.out.includes(STALE));
  check('finds the user doc with no Auth account', r.out.includes('DOC ONLY'));
}

{
  const r = run('rename-manager-role.mjs', '--manifest', MANIFEST, '--apply');
  check('exits clean', r.code === 0, r.code === 0 ? '' : r.out.slice(-500));
  check('a manager becomes an organizer in the claims', (await roleOf(M1)).claims === 'organizer/active');
  check('and in the mirror', (await roleOf(M1)).doc === 'organizer/active');
  check('an admin is untouched', (await roleOf(A)).claims === 'admin/active');
  check('a member is untouched', (await roleOf(MEM)).claims === 'member/active');

  const stale = await roleOf(STALE);
  check('a stale mirror is repaired to match the claims', stale.claims === 'organizer/active' && stale.doc === 'organizer/active', `${stale.claims} / ${stale.doc}`);

  const orphan = (await db.doc(`users/${DOC_ONLY}`).get()).data();
  check('an orphan mirror is renamed too', orphan?.role === 'organizer');

  /**
   * An account with NO claims: the mirror is renamed, and claims are NOT minted.
   *
   * Renaming a mirror is a rename; creating claims for an account that had none
   * would be a GRANT — that account cannot use the app at all today, whatever its
   * document says, because rules default a missing status to '' and deny.
   */
  const bare = await roleOf(CLAIMLESS);
  check('a claimless account has its MIRROR renamed', bare.doc === 'organizer/active');
  check('and is not handed claims it never had', bare.claims === '-/-', bare.claims);
  check('and the run says so out loud', r.out.includes('an admin must re-approve'));

  check('the change is stamped so signed-in clients refresh', Boolean((await db.doc(`users/${M1}`).get()).data()?.claimsUpdatedAt));
  check('and attributed', (await db.doc(`users/${M1}`).get()).data()?.accessChangedBy === 'rename-manager-role-script');
}

{
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  check('the manifest exists and names this project', m.projectId === PROJECT);
  check(
    'it records the PRE-migration claims',
    m.entries.filter((e) => e.uid !== CLAIMLESS).every((e) => e.claims.role === 'manager'),
  );
  check(
    'including an empty record for the account that had none',
    m.entries.find((e) => e.uid === CLAIMLESS)?.claims.role === '',
  );
  check('including the disagreeing mirror', m.entries.find((e) => e.uid === STALE)?.doc.role === 'member');
  check('and the orphan', m.docOnly.some((d) => d.uid === DOC_ONLY));
}

{
  // The manifest is the ONLY way back — claims are in no backup — so a second
  // run must not replace the pre-migration record with the migrated one.
  const before = readFileSync(MANIFEST, 'utf8');
  const r = run('rename-manager-role.mjs', '--manifest', MANIFEST, '--apply');
  check('a re-run finds nothing left to do', r.code === 0 && r.out.includes('Nothing to do'));
  check('and does not overwrite the manifest', readFileSync(MANIFEST, 'utf8') === before);
}

// ---- verify: now it must PASS ------------------------------------------------
console.log('\nverify-board-owners — after the rename');

{
  // The claimless account is still claimless — deliberately — so verify must
  // still be failing, and for THAT reason rather than any leftover.
  const r = run('verify-board-owners.mjs', '--expect-boards', '5');
  check('still fails while an account carries no claims', r.code === 1);
  check('and names it', r.out.includes(`${CLAIMLESS}@oursabeel.com`));
  check('no account holds the retired role any more', !r.out.includes('still hold "manager"'));

  // An admin re-approving writes both halves. That is the documented fix, and it
  // is the only thing standing between here and a clean verify.
  await auth.setCustomUserClaims(CLAIMLESS, { role: 'organizer', status: 'active' });

  const after = run('verify-board-owners.mjs', '--expect-boards', '5');
  check('passes once that is done', after.code === 0, after.code === 0 ? '' : after.out.slice(-800));
  check('still warns about the ownerless board', after.out.includes('NO owner'));
  check('claims and mirror agree everywhere', after.out.includes('claims and mirror agree'));
}

// ---- both inverses -----------------------------------------------------------
console.log('\nthe undo paths');

{
  const r = run('rename-manager-role.mjs', '--revert', MANIFEST, '--apply');
  check('revert exits clean', r.code === 0, r.code === 0 ? '' : r.out.slice(-500));
  check('claims go back exactly', (await roleOf(M1)).claims === 'manager/active');
  // EXACTLY what was recorded, on both halves independently. The mirror had said
  // `member` before the rename, and that is what a revert puts back — deriving
  // it from the claims would be a repair, not an undo.
  const stale = await roleOf(STALE);
  check('the claims go back to manager', stale.claims === 'manager/active');
  check('and the mirror back to its OWN recorded value', stale.doc === 'member/active', stale.doc);
  // The account that had none gets none: inventing claims here would let in an
  // account that could not sign in before.
  const bare = await roleOf(CLAIMLESS);
  check('a claimless account is left claimless', bare.claims === '-/-', bare.claims);
  check('with its mirror back to manager', bare.doc === 'manager/active', bare.doc);
  check('the orphan mirror is reverted too', (await roleOf(DOC_ONLY)).doc === 'manager/active');
  check('verify notices immediately', run('verify-board-owners.mjs').code === 1);
}

{
  const r = spawnSync('node', [resolve(import.meta.dirname, 'rename-manager-role.mjs'), '--revert', MANIFEST, '--apply'], {
    env: { ...process.env, GCLOUD_PROJECT: 'some-other-project' },
    encoding: 'utf8',
  });
  check(
    'revert refuses a manifest from another project',
    r.status === 1 && `${r.stdout}${r.stderr}`.includes('ABORT'),
  );
}

{
  // Forward again, so the rest of the run is on the migrated state.
  run('rename-manager-role.mjs', '--manifest', MANIFEST, '--apply');
  check('and forward again lands', (await roleOf(M1)).claims === 'organizer/active');
}

{
  const dry = run('unbackfill-board-owners.mjs');
  check('unbackfill dry run writes nothing', dry.code === 0 && (await owners(B_NORMAL)) !== undefined);

  const r = run('unbackfill-board-owners.mjs', '--apply');
  check('unbackfill exits clean', r.code === 0, r.code === 0 ? '' : r.out.slice(-500));
  const gone = await Promise.all(
    [B_NORMAL, B_LEFT, B_MANY, B_ARCHIVED, B_DONE].map((id) => owners(id)),
  );
  // This is the only undo the backfill has: a Firestore import merges by
  // document id, so it restores what was DELETED and cannot remove what was
  // wrongly ADDED. A field addition is outside the backup's reach entirely.
  check('the field is gone from every board', gone.every((o) => o === undefined));
  check('the boards themselves survive', (await db.collection('boards').get()).size === 5);
  check('and their members are untouched', (await db.doc(`boards/${B_MANY}`).get()).data()?.memberUids?.length === 3);
}

{
  const r = run('backfill-board-owners.mjs', '--apply');
  check('the round trip completes — backfill works again after an undo', r.code === 0 && JSON.stringify(await owners(B_MANY)) === JSON.stringify([A]));
}

// ---- restore-auth, across the migration --------------------------------------
console.log('\nrestore-auth, on a mirror from before the migration');

{
  // What a restore from a pre-migration backup looks like: the user doc carries
  // a role nothing matches any more. Restoring it verbatim would produce an
  // account that signs in and can do nothing, with no error saying why.
  await db.doc(`users/${M1}`).set({ role: 'manager' }, { merge: true });
  const r = run('restore-auth.mjs', '--apply');
  check('exits clean', r.code === 0, r.code === 0 ? '' : r.out.slice(-500));
  const after = await roleOf(M1);
  check('a retired role is not reinstated', !after.claims.startsWith('manager'), after.claims);
  // Narrowed to the least-privilege role — but `active` survives, because the
  // two fields are independent and an unrecognised role says nothing about
  // whether the account was approved.
  check('it lands on the least-privilege role', after.claims === 'member/active', after.claims);
  check('and says so', r.out.includes('no rule matches'));
  check('the mirror is narrowed too, so the next restore has nothing to repair', after.doc === 'member/active');
  check('an admin is restored as an admin', (await roleOf(A)).claims === 'admin/active');

  // Put it back for the summary below.
  await auth.setCustomUserClaims(M1, { role: 'organizer', status: 'active' });
  await db.doc(`users/${M1}`).set({ role: 'organizer', status: 'active' }, { merge: true });
}

// ---- the dump that step R1 depends on ----------------------------------------
console.log('\ndump-migration-shape');

{
  /**
   * R1's safety net, and the input to the replay mode above — so if it breaks,
   * the migration loses its only record of who held what AND its only way to
   * rehearse against real structure. Nothing else runs it.
   *
   * The load-bearing assertion is the REDACTION. The shape file is the half that
   * may be kept, and it must carry no address and no board name; a leak there
   * would be silent, because the file looks the same either way.
   */
  const dumpDir = resolve(import.meta.dirname, '..', 'migration');
  const manifestFile = resolve(dumpDir, `manifest-${PROJECT}.json`);
  const shapeFile = resolve(dumpDir, `shape-${PROJECT}.json`);
  rmSync(manifestFile, { force: true });
  rmSync(shapeFile, { force: true });

  const r = run('dump-migration-shape.mjs');
  check('exits clean', r.code === 0, r.out.slice(-400));
  check('writes both files', existsSync(manifestFile) && existsSync(shapeFile));

  const man = JSON.parse(readFileSync(manifestFile, 'utf8'));
  check('the manifest records real claims, which no backup holds', man.accounts.some((a) => a.claim.role));
  check('and every board, with who created it', man.boards.length === (await db.collection('boards').get()).size);

  const raw = readFileSync(shapeFile, 'utf8');
  const sh = JSON.parse(raw);
  check('the shape carries the same board count', sh.boards.length === man.boards.length);
  check('and the same account count', sh.accounts.length === man.accounts.length);
  // The redaction, asserted on the FILE TEXT rather than the parsed object, so
  // a value hiding in a key or a nested field cannot slip past.
  check('no address survives redaction', !raw.includes('@'), raw.match(/\S*@\S*/)?.[0] ?? '');
  check(
    'no real uid survives redaction',
    !raw.includes(A) && !raw.includes(M1) && !raw.includes(MEM),
  );
  check('no board name survives redaction', !raw.includes('Several members') && !raw.includes('Creator left'));
  check(
    'and the structure the replay reads is intact',
    sh.boards.every((b) => Array.isArray(b.memberUids) && typeof b.archived === 'boolean'),
  );

  rmSync(manifestFile, { force: true });
  rmSync(shapeFile, { force: true });
}

// ---- done --------------------------------------------------------------------
rmSync(MANIFEST, { force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}
process.exit(0);
