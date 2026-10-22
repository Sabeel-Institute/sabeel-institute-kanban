// Replay the board-ownership migration against the SHAPE of a real database.
//
// `scripts/dump-migration-shape.mjs` reads production and writes a redacted
// structure — no names, no addresses, no board titles, no cards, uids replaced
// with `u1..uN`. This seeds an emulator from that file and runs the real
// scripts, in the real order, over it.
//
//   JAVA_HOME=$(npx sabeel-ci jdk21) firebase emulators:exec \
//     --project $(npx sabeel-ci ports --project) --only firestore,auth \
//     "node scripts/migration-e2e.mjs --shape migration/shape-<project>.json"
//
// WHAT THIS ANSWERS, that the hand-written fixtures do not: whether the sequence
// works on the structure that actually exists. The fixtures contain every
// awkward case deliberately, which makes them the harder test and also an
// invented one — production may hold a case nobody thought of, or none of them.
// Running both is the point.
//
// It asserts INVARIANTS, never specific ids, because the shape is different
// every time it is taken. The invariants are exactly the promises the runbook
// makes to the people using the app.
import { readFileSync, rmSync } from 'node:fs';

/** A board document the rules would accept, built from a shape entry. */
function boardFrom(b) {
  const doc = {
    name: b.id,
    description: '',
    archived: b.archived === true,
    columns: [{ id: 'c1', name: 'To Do' }],
    columnIds: ['c1'],
    memberUids: b.memberUids,
    memberProfiles: Object.fromEntries(
      b.memberUids.map((u) => [u, { displayName: u, email: `${u}@oursabeel.com` }]),
    ),
    activeCardCount: 0,
    createdAt: 1,
    createdBy: b.createdBy,
  };
  // `null` in the shape means the field was absent, which is a different state
  // from an empty list and the backfill treats it differently.
  if (b.boardOwnerUids !== null) doc.boardOwnerUids = b.boardOwnerUids;
  return doc;
}

export async function shapeMode({ path, db, auth, run, check, results }) {
  const shape = JSON.parse(readFileSync(path, 'utf8'));
  const boards = shape.boards ?? [];
  const accounts = shape.accounts ?? [];

  // A manifest of its own, cleared first. `rename-manager-role.mjs` REUSES an
  // existing one by design — it holds the true pre-migration state — which would
  // otherwise make a second replay revert against the first shape's record.
  const manifest = 'migration/shape-replay-manifest.json';
  rmSync(manifest, { force: true });

  console.log(
    `Replaying ${boards.length} board(s) and ${accounts.length} account(s) from ${path}\n`,
  );

  // ---- seed ------------------------------------------------------------------
  for (const a of accounts) {
    if (a.hasAuth) {
      // Tolerate a re-run against an emulator that was not restarted; anything
      // else is a real failure and must not be swallowed.
      try {
        await auth.createUser({ uid: a.uid, email: `${a.uid}@oursabeel.com`, emailVerified: true });
      } catch (e) {
        if (e?.errorInfo?.code !== 'auth/uid-already-exists') throw e;
      }
      // An account with no claims at all is a real state, and one the scripts
      // treat differently from any other — so an empty pair means empty, not
      // "fall back to the doc".
      if (a.claim.role || a.claim.status) {
        await auth.setCustomUserClaims(a.uid, { role: a.claim.role, status: a.claim.status });
      }
    }
    if (a.hasDoc) {
      await db.doc(`users/${a.uid}`).set({
        email: `${a.uid}@oursabeel.com`,
        displayName: a.uid,
        role: a.doc.role,
        status: a.doc.status,
        createdAt: 1,
      });
    }
  }
  for (const b of boards) {
    await db.doc(`boards/${b.id}`).set(boardFrom(b));
  }

  // ---- what the migration SHOULD produce, worked out from the shape alone ----
  const ADMINISTERS = ['manager', 'organizer', 'admin'];
  const effectiveRole = (uid) => {
    const a = accounts.find((x) => x.uid === uid);
    if (!a) return null;
    return a.hasAuth && (a.claim.role || a.claim.status) ? a.claim.role : a.doc.role;
  };
  const expectedOwners = (b) =>
    b.createdBy && b.memberUids.includes(b.createdBy) ? [b.createdBy] : [];

  const authorless = boards.filter((b) => !b.createdBy);
  const needBackfill = boards.filter((b) => (b.boardOwnerUids ?? []).length === 0);
  const wouldOrphan = needBackfill.filter((b) => b.createdBy && !b.memberUids.includes(b.createdBy));
  const unqualified = [
    ...new Set(needBackfill.flatMap(expectedOwners)),
  ].filter((uid) => !ADMINISTERS.includes(effectiveRole(uid) ?? ''));
  const holdManager = accounts.filter(
    (a) => a.claim.role === 'manager' || a.doc.role === 'manager',
  );
  const claimless = accounts.filter((a) => a.hasAuth && !a.claim.role && !a.claim.status);

  // ---- R4: the backfill ------------------------------------------------------
  console.log('backfill-board-owners');
  {
    const dry = run('backfill-board-owners.mjs');
    if (authorless.length > 0) {
      // The shape says production has a board with no author, so the runbook
      // stops here and the rest of this replay cannot mean anything.
      check('ABORTS on the authorless board(s) this database contains', dry.code === 1);
      check(
        'so the migration cannot proceed until they are fixed — read the abort',
        dry.out.includes('ABORT'),
      );
      return;
    }
    if (unqualified.length > 0) {
      check(
        'ABORTS because a would-be owner could not administer a board today',
        dry.code === 1,
        unqualified.join(', '),
      );
      return;
    }
    check('dry run accepts this database', dry.code === 0, dry.out.slice(-400));
    check(
      'and names every board that will be left without an owner',
      wouldOrphan.every((b) => dry.out.includes(b.id)),
    );

    const apply = run('backfill-board-owners.mjs', '--apply');
    check('apply exits clean', apply.code === 0, apply.out.slice(-400));
  }

  {
    // Every board, checked against what the shape says it should become.
    const wrong = [];
    for (const b of boards) {
      const got = (await db.doc(`boards/${b.id}`).get()).data()?.boardOwnerUids;
      const want = (b.boardOwnerUids ?? []).length > 0 ? b.boardOwnerUids : expectedOwners(b);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        wrong.push(`${b.id}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
      }
    }
    check('every board ends with exactly the owners the shape predicts', wrong.length === 0, wrong.slice(0, 3).join(' | '));

    const ownerless = (await db.collection('boards').get()).docs.filter(
      (d) => (d.data()?.boardOwnerUids ?? []).length === 0,
    );
    check(
      `the boards left ownerless are exactly the ones whose creator had left (${wouldOrphan.length})`,
      ownerless.length === wouldOrphan.length,
      `${ownerless.length} vs ${wouldOrphan.length}`,
    );
    check(
      'an owner entry is never written for somebody who is not a member',
      (await db.collection('boards').get()).docs.every((d) => {
        const data = d.data() ?? {};
        return (data.boardOwnerUids ?? []).every((u) => (data.memberUids ?? []).includes(u));
      }),
    );
  }

  // ---- R7b: the rename -------------------------------------------------------
  console.log('\nrename-manager-role');
  if (holdManager.length === 0) {
    // A shape taken AFTER the migration has nothing to rename, and that is a
    // perfectly ordinary thing to replay — re-running the dump later, or
    // rehearsing a restore. The rename says so and exits clean; there is then no
    // manifest, so there is nothing to revert either, and asserting against one
    // would fail for a reason that is not a fault.
    const r = run('rename-manager-role.mjs', '--manifest', manifest, '--apply');
    check('nothing to rename — this shape was taken after the migration', r.code === 0);
    check('and it says so rather than doing something', r.out.includes('Nothing to do'));
  } else {
    const r = run('rename-manager-role.mjs', '--manifest', manifest, '--apply');
    check('exits clean', r.code === 0, r.out.slice(-400));

    const stillManager = [];
    for (const a of accounts) {
      const claims = (await auth.getUser(a.uid).catch(() => null))?.customClaims ?? {};
      const doc = (await db.doc(`users/${a.uid}`).get()).data() ?? {};
      if (claims.role === 'manager' || doc.role === 'manager') stillManager.push(a.uid);
    }
    check(
      `no account holds the retired role any more (${holdManager.length} did)`,
      stillManager.length === 0,
      stillManager.slice(0, 5).join(', '),
    );

    // Nobody is handed access they did not have. The one way this script could
    // grant something is by minting claims for an account that carried none.
    const minted = [];
    for (const a of claimless) {
      const claims = (await auth.getUser(a.uid)).customClaims;
      if (claims && (claims.role || claims.status)) minted.push(a.uid);
    }
    check(
      `no account was handed claims it did not have (${claimless.length} had none)`,
      minted.length === 0,
      minted.join(', '),
    );
  }

  // ---- R7c: verify -----------------------------------------------------------
  console.log('\nverify-board-owners');
  {
    const r = run('verify-board-owners.mjs', '--expect-boards', String(boards.length));
    // Claimless accounts and ownerless boards are REPORTED conditions, not
    // failures of the migration — but verify treats the first as a failure
    // deliberately, because such an account cannot use the app.
    const shouldPass = claimless.length === 0;
    check(
      shouldPass
        ? 'passes'
        : `fails only because ${claimless.length} account(s) carry no claims, which is the honest answer`,
      shouldPass ? r.code === 0 : r.code === 1 && r.out.includes('carry NO custom claims'),
      r.out.slice(-500),
    );
    check('the board count is unchanged', r.out.includes('matching the manifest'));
    check(
      'every owner is a member of their board',
      r.out.includes('every owner is also a member'),
    );
  }

  // ---- the undo, on this same shape ------------------------------------------
  console.log('\nthe undo paths, on this database');
  if (holdManager.length > 0) {
    const rev = run('rename-manager-role.mjs', '--revert', manifest, '--apply');
    check('revert exits clean', rev.code === 0, rev.out.slice(-400));
    const backToManager = [];
    for (const a of holdManager) {
      const claims = (await auth.getUser(a.uid).catch(() => null))?.customClaims ?? {};
      const doc = (await db.doc(`users/${a.uid}`).get()).data() ?? {};
      if (a.claim.role === 'manager' && claims.role === 'manager') backToManager.push(a.uid);
      else if (a.doc.role === 'manager' && doc.role === 'manager') backToManager.push(a.uid);
    }
    check(
      `every account that held the old role has it back (${holdManager.length})`,
      backToManager.length === holdManager.length,
      `${backToManager.length} of ${holdManager.length}`,
    );
  }

  {
    const un = run('unbackfill-board-owners.mjs', '--apply');
    check('unbackfill exits clean', un.code === 0, un.out.slice(-400));
    const left = (await db.collection('boards').get()).docs.filter(
      (d) => d.data()?.boardOwnerUids !== undefined,
    );
    check('no board carries an owner list any more', left.length === 0);
    check(
      'and every board still exists with its membership intact',
      (await db.collection('boards').get()).size === boards.length,
    );
    for (const b of boards.slice(0, 3)) {
      const got = (await db.doc(`boards/${b.id}`).get()).data()?.memberUids ?? [];
      check(
        `${b.id}: members untouched by the round trip`,
        JSON.stringify(got) === JSON.stringify(b.memberUids),
      );
    }
  }

  // `results` is threaded in so the caller can print one tally for both modes.
  void results;
}
