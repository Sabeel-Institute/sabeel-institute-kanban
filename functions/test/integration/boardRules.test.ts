import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  doc,
  collection,
  query,
  where,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { EMULATOR_PROJECT_ID, PASSWORD_SIGN_IN_EMAIL } from '@sabeel/shared';
import { firestoreHostPort } from './emulatorHosts';

/**
 * Board access, under the per-board ownership model (2026-08-16).
 *
 * Two separate questions, and they used to be one. SEEING a board is membership —
 * you are on it, or you are an admin, and there is no third case. ADMINISTERING
 * one is `boardOwnerUids`.
 *
 * The actors below are chosen to keep those apart. `owner1` administers a board
 * while holding the plain `member` role, which is the whole point of the change:
 * ownership is orthogonal to rank, so running one board grants nothing anywhere
 * else. `org1` is an organizer on no board at all — able to create boards, and
 * otherwise no better off than anyone.
 *
 * Every denial is paired with a positive control. `assertFails` passes when an
 * operation fails for ANY reason, so a suite of bare denials proves nothing.
 */
let env: RulesTestEnvironment;

function ctx(uid: string, role: string, status = 'active') {
  return env
    .authenticatedContext(uid, {
      email: `${uid}@oursabeel.com`,
      email_verified: true,
      role,
      status,
    })
    .firestore();
}

const baseBoard = (over: Record<string, unknown> = {}) => ({
  name: 'Fundraising',
  description: '',
  archived: false,
  columns: [{ id: 'c1', name: 'To Do' }],
  // Flat mirror of the column ids. Rules cannot search a list of maps, so card
  // writes are validated against this — it must always accompany `columns`.
  columnIds: ['c1'],
  memberUids: ['owner1', 'member1'],
  boardOwnerUids: ['owner1'],
  createdAt: 1,
  createdBy: 'owner1',
  ...over,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: {
      rules: readFileSync('../firestore.rules', 'utf8'),
      ...firestoreHostPort(),
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'boards/b_member'), baseBoard());
    await setDoc(
      doc(db, 'boards/b_other'),
      baseBoard({
        name: 'Private Ops',
        memberUids: ['someone_else'],
        boardOwnerUids: ['someone_else'],
        createdBy: 'someone_else',
      }),
    );
    // Two owners, for the creator-protection cases.
    await setDoc(
      doc(db, 'boards/b_two'),
      baseBoard({
        memberUids: ['owner1', 'second1'],
        boardOwnerUids: ['owner1', 'second1'],
        createdBy: 'owner1',
      }),
    );
    // The creator already demoted BY AN ADMIN — the state a value-shaped
    // creator rule would have bricked forever.
    await setDoc(
      doc(db, 'boards/b_demoted'),
      baseBoard({
        memberUids: ['owner1', 'second1'],
        boardOwnerUids: ['second1'],
        createdBy: 'owner1',
      }),
    );
    // A board written before the field existed: an aborted backfill, or a
    // restore from before the migration.
    const legacy: Record<string, unknown> = baseBoard();
    delete legacy.boardOwnerUids;
    await setDoc(doc(db, 'boards/b_legacy'), legacy);
  });
});

describe('reading a board', () => {
  it('a member reads their own board', async () => {
    await assertSucceeds(getDoc(doc(ctx('member1', 'member'), 'boards/b_member')));
  });

  it('a member CANNOT read a board they are not on', async () => {
    await assertFails(getDoc(doc(ctx('member1', 'member'), 'boards/b_other')));
  });

  it('an ORGANIZER cannot read a board they are not on', async () => {
    // The headline of the change. This used to succeed: the role carried sight
    // of every board in the organisation.
    await assertFails(getDoc(doc(ctx('org1', 'organizer'), 'boards/b_other')));
    // Only the membership was in the way — an organizer on the board reads it.
    await assertSucceeds(getDoc(doc(ctx('member1', 'organizer'), 'boards/b_member')));
  });

  it('an admin reads any board', async () => {
    await assertSucceeds(getDoc(doc(ctx('admin1', 'admin'), 'boards/b_other')));
  });

  it('a pending or disabled user reads nothing', async () => {
    for (const status of ['pending', 'rejected', 'disabled']) {
      await assertFails(getDoc(doc(ctx('member1', 'member', status), 'boards/b_member')));
      await assertFails(getDoc(doc(ctx('admin1', 'admin', status), 'boards/b_member')));
    }
  });
});

describe('listing boards', () => {
  it('a member may list ONLY with an array-contains constraint on themselves', async () => {
    const db = ctx('member1', 'member');
    await assertSucceeds(
      getDocs(
        query(collection(db, 'boards'), where('memberUids', 'array-contains', 'member1')),
      ),
    );
  });

  it('a member cannot list all boards', async () => {
    // Without the constraint the query could return boards they may not read,
    // so Firestore must reject it outright.
    await assertFails(getDocs(collection(ctx('member1', 'member'), 'boards')));
  });

  it('a member cannot list boards by claiming to be someone else', async () => {
    await assertFails(
      getDocs(
        query(
          collection(ctx('member1', 'member'), 'boards'),
          where('memberUids', 'array-contains', 'someone_else'),
        ),
      ),
    );
  });

  it('an ORGANIZER cannot list every board unconstrained', async () => {
    // The client change that matters most: `useMyBoards` must carry the
    // array-contains constraint for everyone except an admin, or the whole
    // Boards screen fails for them.
    await assertFails(getDocs(collection(ctx('org1', 'organizer'), 'boards')));
    await assertSucceeds(
      getDocs(
        query(collection(ctx('org1', 'organizer'), 'boards'), where('memberUids', 'array-contains', 'org1')),
      ),
    );
  });

  it('an admin may list every board unconstrained', async () => {
    // `isAdmin()` does not depend on document data, so this is provably safe.
    await assertSucceeds(getDocs(collection(ctx('admin1', 'admin'), 'boards')));
  });
});

describe('creating a board', () => {
  const newBoard = (over: Record<string, unknown> = {}) =>
    baseBoard({
      createdBy: 'org1',
      memberUids: ['org1'],
      boardOwnerUids: ['org1'],
      ...over,
    });

  it('an organizer can create one', async () => {
    await assertSucceeds(
      setDoc(doc(ctx('org1', 'organizer'), 'boards/new1'), newBoard()),
    );
  });

  /*
   * A PASSWORD SESSION IS A MEMBER, whatever its claims say (Faisal,
   * 2026-10-15). The control is the same claims through Google: only the way
   * the session signed in differs.
   */
  it('an organizer signed in with a password cannot, and the same organizer through Google can', async () => {
    // The one address the password door admits, so only the member lock is tested.
    const as = (sign_in_provider: 'password' | 'google.com') =>
      env
        .authenticatedContext('org1', {
          email: PASSWORD_SIGN_IN_EMAIL,
          email_verified: true,
          role: 'organizer',
          status: 'active',
          firebase: { sign_in_provider },
        })
        .firestore();
    await assertFails(setDoc(doc(as('password'), 'boards/new_pw'), newBoard()));
    await assertSucceeds(setDoc(doc(as('google.com'), 'boards/new_pw'), newBoard()));
  });

  it('a member cannot create one', async () => {
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), 'boards/new2'),
        newBoard({ createdBy: 'member1', memberUids: ['member1'], boardOwnerUids: ['member1'] }),
      ),
    );
  });

  it('the creator must include themselves as a member', async () => {
    // Otherwise the board is born invisible to its own author.
    await assertFails(
      setDoc(doc(ctx('org1', 'organizer'), 'boards/new3'), newBoard({ memberUids: ['someone_else'] })),
    );
  });

  /**
   * The refusal that turns a silent, permanent stranding into a loud one.
   *
   * An app build too old to know about ownership emits no `boardOwnerUids`. The
   * board it made would be administrable by nobody but an admin — its own author
   * could not rename it — and nothing would say why. Requiring the field means
   * such a client fails at creation instead, which reads as "your app is out of
   * date".
   */
  it('a board cannot be created without naming its creator as owner', async () => {
    const noOwners: Record<string, unknown> = newBoard();
    delete noOwners.boardOwnerUids;
    await assertFails(setDoc(doc(ctx('org1', 'organizer'), 'boards/new4'), noOwners));

    await assertFails(
      setDoc(doc(ctx('org1', 'organizer'), 'boards/new5'), newBoard({ boardOwnerUids: [] })),
    );
    // Nor may it hand ownership straight to somebody else.
    await assertFails(
      setDoc(doc(ctx('org1', 'organizer'), 'boards/new6'), newBoard({ boardOwnerUids: ['admin1'] })),
    );
    // Only that was in the way.
    await assertSucceeds(
      setDoc(doc(ctx('org1', 'organizer'), 'boards/new7'), newBoard()),
    );
  });

  it('the creator cannot forge authorship', async () => {
    await assertFails(
      setDoc(doc(ctx('org1', 'organizer'), 'boards/new8'), newBoard({ createdBy: 'admin1' })),
    );
  });

  it('a board cannot be born archived', async () => {
    await assertFails(
      setDoc(doc(ctx('org1', 'organizer'), 'boards/new9'), newBoard({ archived: true })),
    );
  });

  it('rejects an empty or over-long name', async () => {
    for (const name of ['', 'x'.repeat(121)]) {
      await assertFails(
        setDoc(doc(ctx('org1', 'organizer'), 'boards/new10'), newBoard({ name })),
      );
    }
  });

  it('rejects a memberProfiles that is not a map', async () => {
    // The update rule already required this. A create rule laxer than its update
    // rule leaves exactly one document state whose shape was never guaranteed —
    // the same hole the comment `mentionUids` check had.
    await assertFails(
      setDoc(doc(ctx('org1', 'organizer'), 'boards/b_shape'), {
        ...baseBoard({ memberUids: ['org1'], boardOwnerUids: ['org1'], createdBy: 'org1' }),
        memberProfiles: 'not a map',
      }),
    );
    // Only the shape was in the way.
    await assertSucceeds(
      setDoc(doc(ctx('org1', 'organizer'), 'boards/b_shape2'), {
        ...baseBoard({ memberUids: ['org1'], boardOwnerUids: ['org1'], createdBy: 'org1' }),
        memberProfiles: {},
      }),
    );
  });

  it('rejects an unknown field on the board', async () => {
    await assertFails(
      setDoc(doc(ctx('org1', 'organizer'), 'boards/new11'), newBoard({ smuggled: 'x' })),
    );
  });
});

describe('updating a board', () => {
  it('an OWNER can rename it and change its columns', async () => {
    const db = ctx('owner1', 'member');
    await assertSucceeds(
      updateDoc(doc(db, 'boards/b_member'), {
        name: 'Renamed',
        columns: [
          { id: 'c1', name: 'To Do' },
          { id: 'c2', name: 'Doing' },
        ],
        columnIds: ['c1', 'c2'],
        createdBy: 'owner1',
      }),
    );
  });

  it('ownership is orthogonal to org role — the owner above is a plain member', async () => {
    // Stated as its own assertion because it is the point of the model: running
    // one board takes no rank, and confers none.
    await assertSucceeds(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), { name: 'Still fine' }),
    );
  });

  it('a MEMBER of the board who is not an owner cannot edit it', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'boards/b_member'), { name: 'Hijacked' }),
    );
    // Only ownership was in the way.
    await assertSucceeds(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), { name: 'Hijacked' }),
    );
  });

  it('an ORGANIZER who is not on the board cannot edit it', async () => {
    await assertFails(
      updateDoc(doc(ctx('org1', 'organizer'), 'boards/b_other'), { name: 'Nope' }),
    );
  });

  it('an admin edits a board they are not a member of', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('admin1', 'admin'), 'boards/b_other'), { name: 'Admin renamed' }),
    );
  });

  it('an owner entry for a NON-member grants nothing', async () => {
    // Authority is membership AND ownership. This is what makes a leftover entry
    // inert, and it is why the rules need no subset check — one would be broken
    // routinely by removeBoardMember, which bypasses rules entirely.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'boards/b_ghost'),
        baseBoard({ memberUids: ['member1'], boardOwnerUids: ['ghost1'] }),
      );
    });
    await assertFails(
      updateDoc(doc(ctx('ghost1', 'member'), 'boards/b_ghost'), { name: 'Nope' }),
    );
  });

  // `update` used to validate far less than `create`, which means the shape was
  // only ever guaranteed for a board's FIRST write. Same trap as the comment
  // mentionUids check, which was enforced on new comments and skippable by
  // editing one.
  it('the card count is trigger-owned and cannot be written by a client', async () => {
    // onCardBoardCount maintains it via the Admin SDK, which bypasses rules.
    // A client that could set it would make the Boards list disagree with the
    // board it is describing.
    await assertFails(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), {
        activeCardCount: 999,
      }),
    );
  });

  it('createdAt cannot be rewritten', async () => {
    await assertFails(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), { createdAt: 999 }),
    );
  });

  it('archived must be a boolean', async () => {
    await assertFails(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), { archived: 'yes' }),
    );
  });

  it('authorship cannot be rewritten', async () => {
    await assertFails(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), {
        createdBy: 'owner1_impostor',
      }),
    );
  });

  it('archiving is an update, and owners may do it', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), { archived: true }),
    );
  });

  it('an ORGANIZER can no longer join a board by adding their own uid', async () => {
    // This used to be the Join button, and it was the membership half of
    // "managers may see and join every board". Both halves are gone: an
    // organizer cannot even read `b_other`, let alone write themselves onto it.
    await assertFails(
      updateDoc(doc(ctx('org1', 'organizer'), 'boards/b_other'), {
        memberUids: ['someone_else', 'org1'],
        createdBy: 'someone_else',
      }),
    );
  });

  it('a member cannot add themselves to a board they are not on', async () => {
    // The escalation path this model has to close.
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'boards/b_other'), {
        memberUids: ['someone_else', 'member1'],
      }),
    );
  });

  it('a member cannot remove themselves either', async () => {
    // Looks like leaving, but would strand their card assignments — that is what
    // the removeBoardMember callable is for.
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'boards/b_member'), {
        memberUids: ['owner1'],
      }),
    );
  });

  it('an inactive owner cannot update', async () => {
    await assertFails(
      updateDoc(doc(ctx('owner1', 'member', 'disabled'), 'boards/b_member'), {
        name: 'Nope',
      }),
    );
  });
});

/**
 * Ownership itself: who may grant and revoke it.
 *
 * The creator is protected against the person they delegated to — the one
 * genuinely bad outcome in a delegation model is a delegate unseating the
 * delegator. Only an admin lifts that, including for the creator themselves.
 */
describe('granting and revoking ownership', () => {
  it('an owner promotes another member', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), {
        boardOwnerUids: ['owner1', 'member1'],
      }),
    );
  });

  it('an owner demotes another owner', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('second1', 'member'), 'boards/b_two'), {
        boardOwnerUids: ['owner1'],
      }),
    );
  });

  it('a plain member cannot promote themselves', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'boards/b_member'), {
        boardOwnerUids: ['owner1', 'member1'],
      }),
    );
  });

  it('another owner cannot demote the CREATOR', async () => {
    await assertFails(
      updateDoc(doc(ctx('second1', 'member'), 'boards/b_two'), {
        boardOwnerUids: ['second1'],
      }),
    );
    // Only the creator's protection was in the way — demoting anyone else works.
    await assertSucceeds(
      updateDoc(doc(ctx('second1', 'member'), 'boards/b_two'), {
        boardOwnerUids: ['owner1'],
      }),
    );
  });

  it('nor remove the creator from the board, which would demote them sideways', async () => {
    // Authority is `member AND owner`, so taking away either one unseats them.
    await assertFails(
      updateDoc(doc(ctx('second1', 'member'), 'boards/b_two'), {
        memberUids: ['second1'],
        boardOwnerUids: ['second1'],
      }),
    );
  });

  /**
   * The door the creator clause used to leave open.
   *
   * It checked the OWNER list alone, on the stated reasoning that dropping the
   * creator from `memberUids` "forces" dropping them from `boardOwnerUids`.
   * Nothing forces that — there is deliberately no subset rule — so this exact
   * write walked through: the creator ends up off the board holding an ownership
   * entry that grants nothing, which is the unseating the clause exists to
   * refuse, reached by the other door.
   */
  it('nor remove the creator from the board while LEAVING them an owner', async () => {
    await assertFails(
      updateDoc(doc(ctx('second1', 'member'), 'boards/b_two'), {
        memberUids: ['second1'],
        boardOwnerUids: ['owner1', 'second1'],
      }),
    );
  });

  it('the creator cannot step down unaided either', async () => {
    // Chosen deliberately: one sentence with no exceptions, at the price of an
    // admin request on the rare handover.
    await assertFails(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_two'), {
        boardOwnerUids: ['second1'],
      }),
    );
  });

  it('an admin can demote the creator', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('admin1', 'admin'), 'boards/b_two'), {
        boardOwnerUids: ['second1'],
      }),
    );
  });

  /**
   * The reason the creator clause is phrased on the CHANGE and not the value.
   *
   * A value-shaped rule — "the creator must be in boardOwnerUids" — would make
   * every board an admin had legitimately demoted a creator on permanently
   * unwritable, because no subsequent write could satisfy it.
   */
  it('a board whose creator was already demoted is still editable', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('second1', 'member'), 'boards/b_demoted'), { name: 'Carries on' }),
    );
  });

  /**
   * The OTHER unsatisfiable state, and the reason the "nothing to protect" arm
   * tests both lists rather than the owner list alone.
   *
   * An owner may legally write a departed creator's uid back into
   * `boardOwnerUids` — inert, since authority needs membership too, and not
   * reachable from the UI. Testing only the owner list would then have the board
   * demand of every later write a membership no non-admin write can restore:
   * `membershipOnlyGrows` forbids shrinking the list, and adding the creator back
   * is a different act nobody may be trying to perform. The board would be frozen
   * for everyone but an admin, by an edit that granted nothing.
   */
  it('a stray owner entry for a departed creator does not freeze the board', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'boards/b_stray'),
        baseBoard({
          memberUids: ['second1'],
          boardOwnerUids: ['second1', 'owner1'],
          createdBy: 'owner1',
        }),
      );
    });
    await assertSucceeds(
      updateDoc(doc(ctx('second1', 'member'), 'boards/b_stray'), { name: 'Still editable' }),
    );
  });
});

/**
 * Boards written before the field existed — an aborted backfill, or a restore
 * from before the migration. `.get('boardOwnerUids', [])` throughout is what
 * keeps these repairable: plain access on a missing field ERRORS, and an
 * erroring rule denies, which would make exactly the boards most in need of
 * repair the ones nobody could repair.
 */
/**
 * Membership changes ONLY through callables, both ways: `addBoardMember` and
 * `removeBoardMember`, both Admin SDK writes these rules never see.
 *
 * Removal has always had to be one. "Assignees are board members" is checked on
 * CARD writes only, so a board write that dropped a member would leave their
 * `assigneeUids` entries behind — and the card read rule has an arm for those,
 * so the person would keep read access to the very cards the removal was meant
 * to take away.
 *
 * Adding joined it for a different reason: rules allow `list` on `users/` to
 * admins alone, so a non-admin owner could never see whom to add even though the
 * write was permitted. Moving it server-side also means the SERVER supplies the
 * profile, which is the only way to stop an owner writing an arbitrary name or
 * address — `memberProfiles` is a free-form map and rules cannot cross-reference
 * `users/`.
 */
describe('membership does not change from a client, in either direction', () => {
  it('an owner cannot ADD one — that is addBoardMember’s job now', async () => {
    // It used to be allowed, and it was useless: rules let only admins `list`
    // users/, so a non-admin owner could never see whom to add. The write was
    // permitted and the read feeding it was not.
    await assertFails(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), {
        memberUids: ['owner1', 'member1', 'second1'],
      }),
    );
  });

  it('nor REMOVE one — that is removeBoardMember’s job', async () => {
    await assertFails(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), {
        memberUids: ['owner1'],
      }),
    );
  });

  it('nor remove THEMSELVES, which would strand their own assignments', async () => {
    await assertFails(
      updateDoc(doc(ctx('second1', 'member'), 'boards/b_two'), {
        memberUids: ['owner1'],
        boardOwnerUids: ['owner1'],
      }),
    );
  });

  it('NOT EVEN AN ADMIN — the old repair exemption is gone', async () => {
    // Deliberate. Both callables gate on canManageBoard, which is true for an
    // admin on any board, so the capability is unchanged; only the direct client
    // write went. A board broken past that is a script's job, not a screen's.
    await assertFails(
      updateDoc(doc(ctx('admin1', 'admin'), 'boards/b_member'), {
        memberUids: ['owner1'],
      }),
    );
  });

  it('nor may a client rewrite memberProfiles — the server owns the profile', async () => {
    // The hole this closes: memberProfiles is validated only as `is map`, and
    // rules cannot cross-reference users/, so while the client supplied it an
    // owner could put any name or address against a uid.
    await assertFails(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), {
        memberProfiles: { member1: { displayName: 'Someone Else', email: 'evil@example.com' } },
      }),
    );
  });

  it('and an ordinary edit that does not touch either list is unaffected', async () => {
    // The positive control that matters: `updateDoc` merges field-by-field, so a
    // rename carries the stored membership through and must not trip this.
    await assertSucceeds(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_member'), { name: 'Renamed' }),
    );
  });
});

describe('a board with no owner list at all', () => {
  it('is administrable by an admin, who can repair it', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('admin1', 'admin'), 'boards/b_legacy'), {
        boardOwnerUids: ['owner1'],
      }),
    );
  });

  it('is administrable by nobody else, including its creator', async () => {
    await assertFails(
      updateDoc(doc(ctx('owner1', 'member'), 'boards/b_legacy'), { name: 'Nope' }),
    );
    await assertFails(
      updateDoc(doc(ctx('org1', 'organizer'), 'boards/b_legacy'), { name: 'Nope' }),
    );
  });

  it('is still READABLE by its members — visibility never depended on ownership', async () => {
    await assertSucceeds(getDoc(doc(ctx('member1', 'member'), 'boards/b_legacy')));
  });
});

describe('deleting a board', () => {
  it('is impossible for everyone, including admins', async () => {
    // Boards archive, never hard-delete: too much accumulated work to expose a
    // destroy button for.
    await assertFails(deleteDoc(doc(ctx('admin1', 'admin'), 'boards/b_member')));
    await assertFails(deleteDoc(doc(ctx('owner1', 'member'), 'boards/b_member')));
  });
});
