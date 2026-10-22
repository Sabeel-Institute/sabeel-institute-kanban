// Give every board a `boardOwnerUids`, seeded with its creator.
//
// Step R4 of the board-ownership migration (docs/DEPLOY.md § Restoring across
// the board-ownership migration). Board authority used to be an org role; it is
// now this field, so a board without one is administrable by nobody but an
// admin.
//
// ORDERING IS NOT OPTIONAL. The compat rules must already be deployed — they
// admit `boardOwnerUids` to the board key lists. `hasOnly` validates the whole
// merged document, so the moment a board CARRIES a field the rules do not list,
// every client write to that board is refused. The Admin SDK bypasses rules, so
// this script is never the thing that breaks; ordinary people editing boards
// are. That is exactly how the labels migration broke board editing.
//
// DRY RUN BY DEFAULT. `--apply` writes. `--only <boardId>` does one board, which
// is how the canary step proves the compat rules actually propagated — a green
// `firebase deploy` is not that proof.
//
// Idempotent: a board that already has a non-empty list is left alone, so a
// re-run after a partial run finishes the job rather than repeating it.
//
// NEEDS AUTH READ ACCESS as well as Firestore: gate 3 judges an owner-to-be by
// their custom CLAIM, because that is what firestore.rules reads. ADC for the
// project covers both.
//
//   # emulators
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:$(npx sabeel-ci ports firestore) GCLOUD_PROJECT=demo-sabeel-kanban \
//     node scripts/backfill-board-owners.mjs
//   # production, one board first
//   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/backfill-board-owners.mjs --only <boardId> --apply
//   # production, the rest
//   GCLOUD_PROJECT=sabeel-institute-kanban node scripts/backfill-board-owners.mjs --apply
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

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
  `Backfilling boardOwnerUids on ${projectId}` +
    `${usingEmulators ? ' (EMULATORS)' : ' (PRODUCTION)'}` +
    `${APPLY ? '' : '  — DRY RUN, nothing will be written'}` +
    `${ONLY ? `  — ONLY boards/${ONLY}` : ''}\n`,
);

initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

const snap = ONLY
  ? { docs: [await db.doc(`boards/${ONLY}`).get()] }
  : await db.collection('boards').get();
if (ONLY && !snap.docs[0].exists) {
  console.error(`No such board: boards/${ONLY}`);
  process.exit(1);
}

/**
 * GATE 1 — a board with no author cannot be given an owner.
 *
 * Writing `boardOwnerUids: ['']` would mint a permanently un-matchable owner: no
 * uid equals the empty string, so nobody but an admin could ever administer that
 * board and nothing on screen would say why. Production is expected to be clean
 * (the ClickUp importer sets `createdBy: adminUid`); this is asserted anyway, for
 * the re-run that matters — after a restore from a backup predating the
 * migration. Abort rather than mint something unfixable.
 */
const authorless = snap.docs.filter((d) => {
  const by = d.data()?.createdBy;
  return typeof by !== 'string' || by.length === 0;
});
if (authorless.length > 0) {
  console.error('ABORT: these boards have no usable `createdBy`:');
  for (const d of authorless) console.error(`  boards/${d.id}  "${d.data()?.name ?? ''}"`);
  console.error('\nGive each one an author first, or exclude it with --only.');
  process.exit(1);
}

const planned = [];
const orphans = [];
let already = 0;

for (const d of snap.docs) {
  const data = d.data() ?? {};
  const existing = data.boardOwnerUids;
  if (Array.isArray(existing) && existing.length > 0) {
    already += 1;
    continue;
  }
  const createdBy = data.createdBy;
  const members = Array.isArray(data.memberUids) ? data.memberUids : [];

  /**
   * GATE 2 — a creator who is no longer a member gets NO ownership.
   *
   * Authority is membership AND ownership, so naming them would be inert anyway:
   * the board would read as owned while being administrable by nobody. An honest
   * empty list plus a line in the report is better than a false record — an
   * admin assigns those by hand, which is the plan.
   */
  if (!members.includes(createdBy)) {
    orphans.push({ id: d.id, name: data.name ?? '', createdBy, archived: data.archived === true });
    planned.push({ id: d.id, name: data.name ?? '', owners: [] });
    continue;
  }
  planned.push({ id: d.id, name: data.name ?? '', owners: [createdBy] });
}

/**
 * GATE 3 — every uid about to be written must currently hold a role that could
 * already administer every board.
 *
 * This is what makes the client-first ordering safe. The new client shows edit
 * controls to whoever `canManageBoard` approves; while the OLD rules are still
 * live, those same writes are checked against `isManager()`. If every owner is
 * already a manager or an admin, the two agree and nobody is offered a button
 * that fails. Board creation has always required `isManager()`, so this should
 * hold everywhere — assert it rather than assume it.
 *
 * READ FROM THE CUSTOM CLAIM, not from `users/{uid}`. The claim is what
 * `firestore.rules` evaluates; the document is a mirror kept for display, and
 * this gate's whole reasoning is about what the RULES will allow. Checking the
 * mirror would pass an account whose doc says manager and whose token says
 * member — the exact case where the new client offers buttons that fail — and
 * would abort on the harmless inverse. A mirror that disagrees is reported
 * either way: `rename-manager-role.mjs` repairs it, and a silent disagreement is
 * worth seeing before a migration rather than after.
 */
const ADMINISTERS_ANY_BOARD = ['manager', 'organizer', 'admin'];
const owners = [...new Set(planned.flatMap((p) => p.owners))];
const wrongRole = [];
const mirrorDrift = [];
for (const uid of owners) {
  const doc = (await db.doc(`users/${uid}`).get()).data();
  // "No such account" and "could not reach Auth" are NOT the same answer, and a
  // bare catch would turn the second into a silent fall back to the mirror —
  // reintroducing the very confusion this gate was fixed to avoid. Anything but
  // a genuine not-found is rethrown and the run stops.
  let record = null;
  try {
    record = await auth.getUser(uid);
  } catch (e) {
    if (e?.errorInfo?.code !== 'auth/user-not-found') throw e;
  }
  const claims = record?.customClaims ?? null;
  // No Auth account at all: the mirror is the only thing left to judge by, and
  // it is what `restore-auth.mjs` would rebuild the claim from.
  const effective = claims ? claims.role : doc?.role;
  const source = claims ? 'claim' : 'mirror (no Auth account)';
  if (!ADMINISTERS_ANY_BOARD.includes(effective)) {
    wrongRole.push({ uid, role: effective ?? '(none)', source });
  }
  if (claims && doc && claims.role !== doc.role) {
    mirrorDrift.push({ uid, claim: claims.role ?? '(none)', mirror: doc.role ?? '(none)' });
  }
}
if (mirrorDrift.length > 0) {
  console.log(
    'NOTE — these accounts\u2019 claims and user documents disagree. The claim is\n' +
      'what the rules read; rename-manager-role.mjs writes both and settles it:',
  );
  for (const d of mirrorDrift) {
    console.log(`  ${d.uid}  claim=${d.claim}  mirror=${d.mirror}`);
  }
  console.log('');
}
if (wrongRole.length > 0) {
  console.error(
    'ABORT: these boards would be given an owner who cannot administer a board\n' +
      'under the CURRENT rules, so the new client would offer them controls that\n' +
      'fail until the authority change lands:',
  );
  for (const w of wrongRole) console.error(`  ${w.uid}  role=${w.role}  (from the ${w.source})`);
  process.exit(1);
}

for (const p of planned) {
  console.log(
    `  boards/${p.id}  "${p.name}" -> [${p.owners.join(', ')}]` +
      `${p.owners.length === 0 ? '   (NO OWNER — assign by hand)' : ''}`,
  );
}

if (orphans.length > 0) {
  console.log(
    `\nREPORT — ${orphans.length} board(s) whose creator is no longer a member.\n` +
      'Each gets an empty owner list and is administrable only by an admin until\n' +
      'somebody is given ownership through Board settings:',
  );
  for (const o of orphans) {
    console.log(`  boards/${o.id}  "${o.name}"  creator=${o.createdBy}${o.archived ? '  (archived)' : ''}`);
  }
}

if (!APPLY) {
  console.log(
    `\n${planned.length} board(s) would be written, ${already} already have owners.` +
      '\nDRY RUN — nothing was written. Re-run with --apply.',
  );
  process.exit(0);
}

let written = 0;
for (const p of planned) {
  // `update`, never `set`: `set({merge:true})` on a board deleted while this ran
  // would RESURRECT it, which the nightly healthCheck would then see as a
  // document appearing from nowhere. `update` fails on a missing document, which
  // is the honest outcome.
  await db.doc(`boards/${p.id}`).update({ boardOwnerUids: p.owners });
  written += 1;
}

console.log(`\nWrote ${written} board(s); ${already} already had owners.`);
console.log('Next: node scripts/verify-board-owners.mjs');
process.exit(0);
