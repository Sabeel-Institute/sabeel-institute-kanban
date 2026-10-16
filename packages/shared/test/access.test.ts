import { describe, it, expect } from 'vitest';
import {
  ROLES,
  USER_STATUSES,
  NEW_USER_ACCESS,
  canAccessBoard,
  canAdministerUsers,
  canCreateBoards,
  canCurateLabels,
  canManageBoard,
  canSeeEveryBoard,
  canUnseatCreator,
  canUseApp,
  canViewStats,
  checkAccessChange,
  sessionAccess,
  isRole,
  isUserStatus,
} from '../src/access';
import { PASSWORD_SIGN_IN_EMAIL } from '../src/constants';
import type { Role, UserStatus } from '../src/types';

describe('new user defaults', () => {
  it('never provisions an active account', () => {
    // Every account — org domain included — waits for an admin.
    expect(NEW_USER_ACCESS.status).toBe('pending');
    expect(NEW_USER_ACCESS.role).toBe('member');
    expect(canUseApp(NEW_USER_ACCESS)).toBe(false);
  });
});

describe('capability checks across the full role x status matrix', () => {
  const cases: Array<{
    role: Role;
    status: UserStatus;
    useApp: boolean;
    create: boolean;
    labels: boolean;
    stats: boolean;
    admin: boolean;
  }> = [
    { role: 'member', status: 'pending', useApp: false, create: false, labels: false, stats: false, admin: false },
    { role: 'member', status: 'active', useApp: true, create: false, labels: false, stats: false, admin: false },
    { role: 'member', status: 'rejected', useApp: false, create: false, labels: false, stats: false, admin: false },
    { role: 'member', status: 'disabled', useApp: false, create: false, labels: false, stats: false, admin: false },
    { role: 'organizer', status: 'pending', useApp: false, create: false, labels: false, stats: false, admin: false },
    // The whole of what `organizer` grants: creating boards. Nothing else.
    { role: 'organizer', status: 'active', useApp: true, create: true, labels: false, stats: false, admin: false },
    { role: 'organizer', status: 'rejected', useApp: false, create: false, labels: false, stats: false, admin: false },
    { role: 'organizer', status: 'disabled', useApp: false, create: false, labels: false, stats: false, admin: false },
    { role: 'admin', status: 'pending', useApp: false, create: false, labels: false, stats: false, admin: false },
    { role: 'admin', status: 'active', useApp: true, create: true, labels: true, stats: true, admin: true },
    { role: 'admin', status: 'rejected', useApp: false, create: false, labels: false, stats: false, admin: false },
    { role: 'admin', status: 'disabled', useApp: false, create: false, labels: false, stats: false, admin: false },
  ];

  it('covers every combination', () => {
    expect(cases).toHaveLength(ROLES.length * USER_STATUSES.length);
  });

  for (const c of cases) {
    it(`${c.role}/${c.status}`, () => {
      expect(canUseApp(c)).toBe(c.useApp);
      expect(canCreateBoards(c)).toBe(c.create);
      expect(canCurateLabels(c)).toBe(c.labels);
      expect(canViewStats(c)).toBe(c.stats);
      expect(canAdministerUsers(c)).toBe(c.admin);
    });
  }

  it('a non-active admin has no powers at all', () => {
    // Disabling an admin must actually disable them — role alone grants nothing.
    for (const status of USER_STATUSES.filter((s) => s !== 'active')) {
      expect(canAdministerUsers({ role: 'admin', status })).toBe(false);
      expect(canCreateBoards({ role: 'admin', status })).toBe(false);
      expect(canCurateLabels({ role: 'admin', status })).toBe(false);
      expect(canViewStats({ role: 'admin', status })).toBe(false);
    }
  });

  /**
   * Curating labels is ADMIN-only, and this is the assertion that keeps it so.
   *
   * `canCurateLabels` was `return canManageBoards(actor)` — an alias under a
   * docblock arguing it should not be one. Had it stayed, a member promoted to
   * own a single board would have inherited the power to strip a label off every
   * card in the organisation.
   */
  it('label curation does not follow board authority', () => {
    expect(canCurateLabels({ role: 'organizer', status: 'active' })).toBe(false);
    expect(canCreateBoards({ role: 'organizer', status: 'active' })).toBe(true);
  });
});

/**
 * The client mirror of `ownsBoard()` in firestore.rules. If the two disagree,
 * someone is shown a control that then fails — or, worse, the inverse.
 */
describe('canManageBoard', () => {
  const board = { memberUids: ['owner1', 'member1'], boardOwnerUids: ['owner1'] };
  const active = (uid: string, role: Role) => ({ uid, role, status: 'active' as UserStatus });

  it('an owner who is a member administers it', () => {
    expect(canManageBoard(active('owner1', 'member'), board)).toBe(true);
  });

  it('a member who is not an owner does not', () => {
    expect(canManageBoard(active('member1', 'member'), board)).toBe(false);
  });

  it('ownership is orthogonal to org role — a plain member can own', () => {
    // The whole point of the model: owning one board grants nothing elsewhere,
    // and needs nothing elsewhere.
    expect(canManageBoard(active('owner1', 'member'), board)).toBe(true);
    expect(canCreateBoards(active('owner1', 'member'))).toBe(false);
  });

  it('an organizer who is not on the board does not administer it', () => {
    expect(canManageBoard(active('outsider', 'organizer'), board)).toBe(false);
  });

  it('an admin administers a board they are not even a member of', () => {
    expect(canManageBoard(active('outsider', 'admin'), board)).toBe(true);
  });

  /**
   * Membership AND ownership, never ownership alone. A leftover entry — one
   * `removeBoardMember` failed to clear — must be inert, because that is what
   * lets the rules skip a subset check that would otherwise make an ordinary
   * member removal brick the board.
   */
  it('an owner entry for a non-member grants nothing', () => {
    expect(
      canManageBoard(active('ghost', 'member'), {
        memberUids: ['member1'],
        boardOwnerUids: ['ghost'],
      }),
    ).toBe(false);
  });

  it('a board with no owner list is admin-only, not everyone-only', () => {
    // Boards written before this field existed, and any restore from before the
    // migration. Nobody inherits them; an admin repairs them.
    expect(canManageBoard(active('member1', 'organizer'), { memberUids: ['member1'] })).toBe(
      false,
    );
    expect(canManageBoard(active('a1', 'admin'), { memberUids: [] })).toBe(true);
  });

  it('status gates it, as everywhere else', () => {
    for (const status of USER_STATUSES.filter((s) => s !== 'active')) {
      expect(canManageBoard({ uid: 'owner1', role: 'admin', status }, board)).toBe(false);
    }
  });
});

/**
 * The row PERMISSIONS.md states as "See a board you were not added to: admin
 * only" — and the one predicate here that decides a QUERY SHAPE rather than an
 * affordance, since everyone else's boards query must carry an array-contains
 * constraint or Firestore rejects it outright.
 */
describe('canSeeEveryBoard', () => {
  it('is an admin and nobody else', () => {
    expect(canSeeEveryBoard({ role: 'admin', status: 'active' })).toBe(true);
    expect(canSeeEveryBoard({ role: 'organizer', status: 'active' })).toBe(false);
    expect(canSeeEveryBoard({ role: 'member', status: 'active' })).toBe(false);
  });

  it('checks status too, which the inline checks it replaced did not', () => {
    for (const status of USER_STATUSES.filter((s) => s !== 'active')) {
      expect(canSeeEveryBoard({ role: 'admin', status })).toBe(false);
    }
  });
});

/**
 * One sentence, three enforcement points: `keepsCreator()` in firestore.rules,
 * the repeat inside `removeBoardMember` (an Admin SDK batch no rule sees), and
 * the disabled controls on the creator's row in Board settings.
 */
describe('canUnseatCreator', () => {
  it('is an admin and nobody else', () => {
    expect(canUnseatCreator({ role: 'admin', status: 'active' })).toBe(true);
    expect(canUnseatCreator({ role: 'organizer', status: 'active' })).toBe(false);
    expect(canUnseatCreator({ role: 'member', status: 'active' })).toBe(false);
  });

  it('status gates it', () => {
    for (const status of USER_STATUSES.filter((s) => s !== 'active')) {
      expect(canUnseatCreator({ role: 'admin', status })).toBe(false);
    }
  });

  /**
   * Owning the board is NOT enough, which is the whole point: the creator has to
   * be safe from the people they delegated to, or delegating is a one-way door.
   */
  it('does not follow board ownership', () => {
    const board = { memberUids: ['owner1'], boardOwnerUids: ['owner1'] };
    const owner = { uid: 'owner1', role: 'member' as Role, status: 'active' as UserStatus };
    expect(canManageBoard(owner, board)).toBe(true);
    expect(canUnseatCreator(owner)).toBe(false);
  });
});

/**
 * The ONLY gate on downloading an attachment — `storage.rules` denies reads
 * outright, so this decides it in TypeScript. It must match the board read rule
 * exactly.
 */
describe('canAccessBoard', () => {
  const board = { memberUids: ['member1'] };

  it('a member sees it; an admin sees it', () => {
    expect(canAccessBoard({ uid: 'member1', role: 'member', status: 'active' }, board)).toBe(
      true,
    );
    expect(canAccessBoard({ uid: 'nobody', role: 'admin', status: 'active' }, board)).toBe(
      true,
    );
  });

  it('an organizer who is not a member does NOT', () => {
    // This short-circuited on the board-creation predicate, which would have let
    // every organizer mint a signed URL for any file on any board.
    expect(
      canAccessBoard({ uid: 'org1', role: 'organizer', status: 'active' }, board),
    ).toBe(false);
  });

  it('status gates it', () => {
    expect(
      canAccessBoard({ uid: 'member1', role: 'member', status: 'disabled' }, board),
    ).toBe(false);
  });
});

describe('checkAccessChange', () => {
  const admin = { uid: 'admin1', role: 'admin' as Role, status: 'active' as UserStatus };

  it('lets an active admin approve someone else', () => {
    expect(
      checkAccessChange({
        actor: admin,
        targetUid: 'someone',
        targetPasswordOnly: false,
        nextRole: 'member',
        nextStatus: 'active',
      }),
    ).toEqual({ ok: true, role: 'member', status: 'active' });
  });

  it('lets an admin promote someone else to admin', () => {
    expect(
      checkAccessChange({
        actor: admin,
        targetUid: 'someone',
        targetPasswordOnly: false,
        nextRole: 'admin',
        nextStatus: 'active',
      }).ok,
    ).toBe(true);
  });

  it('refuses a member trying to escalate themselves', () => {
    expect(
      checkAccessChange({
        actor: { uid: 'u1', role: 'member', status: 'active' },
        targetUid: 'u2',
        targetPasswordOnly: false,
        nextRole: 'admin',
        nextStatus: 'active',
      }),
    ).toEqual({ ok: false, reason: 'not-admin' });
  });

  it('refuses an organizer administering users', () => {
    // Organizers start boards; only admins decide who is in the org.
    expect(
      checkAccessChange({
        actor: { uid: 'o1', role: 'organizer', status: 'active' },
        targetUid: 'u2',
        targetPasswordOnly: false,
        nextRole: 'member',
        nextStatus: 'active',
      }),
    ).toEqual({ ok: false, reason: 'not-admin' });
  });

  it('refuses a pending admin — status gates the role', () => {
    expect(
      checkAccessChange({
        actor: { uid: 'a1', role: 'admin', status: 'pending' },
        targetUid: 'u2',
        targetPasswordOnly: false,
        nextRole: 'member',
        nextStatus: 'active',
      }),
    ).toEqual({ ok: false, reason: 'not-admin' });
  });

  it('refuses an admin changing their own access', () => {
    // Guards against an admin locking themselves out, and against the shape of
    // a self-escalation bug if the actor check ever weakens.
    expect(
      checkAccessChange({
        actor: admin,
        targetUid: admin.uid,
        targetPasswordOnly: false,
        nextRole: 'member',
        nextStatus: 'disabled',
      }),
    ).toEqual({ ok: false, reason: 'self-change' });
  });

  it('rejects unknown roles and statuses rather than coercing them', () => {
    expect(
      checkAccessChange({
        actor: admin,
        targetUid: 'u2',
        targetPasswordOnly: false,
        nextRole: 'superadmin',
        nextStatus: 'active',
      }),
    ).toEqual({ ok: false, reason: 'invalid-role' });

    expect(
      checkAccessChange({
        actor: admin,
        targetUid: 'u2',
        targetPasswordOnly: false,
        nextRole: 'member',
        nextStatus: 'approved',
      }),
    ).toEqual({ ok: false, reason: 'invalid-status' });
  });

  it('rejects non-string junk', () => {
    for (const junk of [null, undefined, 1, {}, [], true]) {
      expect(
        checkAccessChange({
          actor: admin,
          targetUid: 'u2',
          targetPasswordOnly: false,
          nextRole: junk,
          nextStatus: 'active',
        }).ok,
      ).toBe(false);
    }
  });
});

describe('type guards', () => {
  it('accepts known values', () => {
    expect(ROLES.every(isRole)).toBe(true);
    expect(USER_STATUSES.every(isUserStatus)).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isRole('owner')).toBe(false);
    expect(isUserStatus('approved')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  /**
   * `manager` is not a role any more, and nothing accepts it — not as a stored
   * value and not as input. A clean cut: an account still carrying the old claim
   * gets nothing from it, and the claims migration is what puts that right.
   */
  it('does not recognise the retired role', () => {
    expect(isRole('manager')).toBe(false);
  });
});

/**
 * THE PASSWORD DOOR (Faisal, 2026-10-15): one address only — "should only
 * accept that one email" — and that one a member — "never be able to be an
 * admin or manager. Just a member." firestore.rules, storage.rules and every
 * callable apply this same rule.
 */
describe('sessionAccess', () => {
  const claims = { role: 'admin', status: 'active' };

  it('takes the claims of any session that did not use a password', () => {
    for (const signInProvider of ['google.com', 'custom', undefined]) {
      expect(sessionAccess(claims, { signInProvider, email: 'someone@oursabeel.com' })).toEqual(claims);
    }
  });

  it('holds the one password address to a member, whatever its claims say', () => {
    expect(sessionAccess(claims, { signInProvider: 'password', email: PASSWORD_SIGN_IN_EMAIL })).toEqual({
      role: 'member',
      status: 'active',
    });
    expect(sessionAccess({ role: 'organizer', status: 'pending' }, { signInProvider: 'password', email: PASSWORD_SIGN_IN_EMAIL })).toEqual({
      role: 'member',
      status: 'pending',
    });
  });

  it('gives a password session for any other address no access at all', () => {
    for (const email of ['someone@oursabeel.com', 'APP-REVIEW@oursabeel.com', '', null, undefined]) {
      expect(sessionAccess(claims, { signInProvider: 'password', email })).toEqual({ role: 'member', status: 'disabled' });
    }
  });

  it('reads an unknown claim as a member, and an unknown status as pending', () => {
    expect(sessionAccess({ role: 'owner', status: 'fine' }, { signInProvider: 'google.com', email: 'x@oursabeel.com' })).toEqual({
      role: 'member',
      status: 'pending',
    });
  });

  it('is a real address, not an undefined import', () => {
    expect(PASSWORD_SIGN_IN_EMAIL).toMatch(/^[^@\s]+@oursabeel\.com$/);
  });
});

describe('checkAccessChange, for an account that signs in with a password only', () => {
  const admin = { uid: 'admin', role: 'admin' as Role, status: 'active' as UserStatus };
  const change = (nextRole: string) =>
    checkAccessChange({ actor: admin, targetUid: 'pw', targetPasswordOnly: true, nextRole, nextStatus: 'active' });

  it('refuses every role but member', () => {
    expect(change('organizer')).toEqual({ ok: false, reason: 'password-member-only' });
    expect(change('admin')).toEqual({ ok: false, reason: 'password-member-only' });
  });

  it('approves it as a member', () => {
    expect(change('member')).toEqual({ ok: true, role: 'member', status: 'active' });
  });
});
