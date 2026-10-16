import { PASSWORD_SIGN_IN_EMAIL } from './constants';
import type { Role, UserStatus } from './types';

/**
 * Access-control decisions, as pure functions.
 *
 * These live in shared rather than in the callable so the app can grey out
 * actions using the SAME logic the server enforces — a disabled button and a
 * rejected write should never disagree. The server is still the authority; the
 * client copy is only for affordance.
 */

export const ROLES: readonly Role[] = ['member', 'organizer', 'admin'];
export const USER_STATUSES: readonly UserStatus[] = [
  'pending',
  'active',
  'rejected',
  'disabled',
];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isUserStatus(value: unknown): value is UserStatus {
  return (
    typeof value === 'string' && (USER_STATUSES as readonly string[]).includes(value)
  );
}

/** Firebase's name for an email-and-password sign-in, in a token and in providerData. */
export const PASSWORD_PROVIDER = 'password';

/**
 * What a SESSION may do, from its token: its claims, as the way it signed in
 * allows. firestore.rules (`isSignedIn`, `role()`), storage.rules (`isActive`)
 * and every callable (`actorOf` in functions) apply this same rule, and the
 * app uses it so its controls match.
 *
 * A password sign-in (Faisal, 2026-10-15) is accepted for ONE address,
 * `PASSWORD_SIGN_IN_EMAIL`; any other has no access at all, here as status
 * `disabled`. The one it is accepted for is a member whatever its claims say:
 * "sign in thru email should never be able to be an admin or manager. Just a
 * member." A password is the weaker credential — no Workspace second factor,
 * no Google login challenge — so the session decides, not the account, and
 * `checkAccessChange` refuses to give a password-only account another role.
 * An unknown claim is a member, an unknown status pending.
 */
export function sessionAccess(
  claims: { role?: unknown; status?: unknown },
  session: { signInProvider?: string | null; email?: string | null },
): { role: Role; status: UserStatus } {
  if (session.signInProvider === PASSWORD_PROVIDER) {
    if (session.email !== PASSWORD_SIGN_IN_EMAIL) return { role: 'member', status: 'disabled' };
    return { role: 'member', status: isUserStatus(claims.status) ? claims.status : 'pending' };
  }
  return {
    role: isRole(claims.role) ? claims.role : 'member',
    status: isUserStatus(claims.status) ? claims.status : 'pending',
  };
}

/** What a brand-new account gets. Never active — an admin must approve. */
export const NEW_USER_ACCESS = {
  status: 'pending' as UserStatus,
  role: 'member' as Role,
};

/** Only an active admin administers accounts. */
export function canAdministerUsers(actor: {
  role: Role;
  status: UserStatus;
}): boolean {
  return actor.status === 'active' && actor.role === 'admin';
}

/**
 * Who may START a board. The whole of what `organizer` grants.
 *
 * RENAMED from `canManageBoards`, deliberately, rather than quietly narrowed.
 * That name meant three things at once — create a board, administer any board,
 * see every board — and two of them have moved. Renaming forces every one of its
 * call sites to be looked at instead of silently inheriting a changed meaning,
 * which is exactly how `canCurateLabels` below came to say something nobody
 * intended.
 */
export function canCreateBoards(actor: { role: Role; status: UserStatus }): boolean {
  return actor.status === 'active' && (actor.role === 'organizer' || actor.role === 'admin');
}

/**
 * Who sees a board they were NOT added to — the row `docs/PERMISSIONS.md` states
 * as "See a board you were not added to: admin only".
 *
 * It decides the SHAPE of the boards query, not just an affordance: an admin may
 * ask for the whole collection, and everyone else must carry
 * `where('memberUids','array-contains', uid)` or Firestore rejects the query
 * outright rather than filtering it. So this has to agree with the `isAdmin()`
 * arm of the board read rule exactly — including its ACTIVE half, which the two
 * inline `role === 'admin'` checks it replaces quietly omitted.
 */
export function canSeeEveryBoard(actor: { role: Role; status: UserStatus }): boolean {
  return actor.status === 'active' && actor.role === 'admin';
}

/**
 * Who may ADMINISTER one particular board.
 *
 * The client mirror of `ownsBoard()` in firestore.rules, and the predicate the
 * attachment callables need in TypeScript because Cloud Storage rules cannot
 * read Firestore. If the two drift, someone sees a control that then fails — or,
 * worse, the inverse.
 *
 * Membership AND ownership, never ownership alone. `removeBoardMember` clears
 * both, but the pairing is what makes a leftover entry inert rather than a
 * standing grant, and it is what lets the rules skip a subset check that would
 * otherwise make an ordinary member removal brick the board.
 */
export function canManageBoard(
  actor: { uid: string; role: Role; status: UserStatus },
  /** Nullable so a screen can ask while its board is still loading. */
  board:
    | { memberUids?: readonly string[]; boardOwnerUids?: readonly string[] }
    | null
    | undefined,
): boolean {
  if (actor.status !== 'active') return false;
  if (actor.role === 'admin') return true;
  return (
    (board?.memberUids ?? []).includes(actor.uid) &&
    (board?.boardOwnerUids ?? []).includes(actor.uid)
  );
}

/**
 * Who may take the person who CREATED a board off it — out of
 * `boardOwnerUids`, or out of `memberUids`, which unseats them just as
 * completely because authority is the pair.
 *
 * The client mirror of `keepsCreator()` in firestore.rules, and the check
 * `removeBoardMember` repeats in TypeScript because that callable is an Admin
 * SDK batch no rule ever sees. Three enforcement points for one sentence, which
 * is exactly why the sentence has a name: expressed inline as
 * `user.role !== 'admin'` at each of them, nothing connects the disabled toggle
 * on screen to the rule that would refuse the write behind it.
 *
 * Its own body, like every other predicate here. It is not "administers
 * accounts" and it is not "curates labels"; it happens to require the same role
 * today and must be free to stop.
 */
export function canUnseatCreator(actor: { role: Role; status: UserStatus }): boolean {
  return actor.status === 'active' && actor.role === 'admin';
}

/**
 * Who may read the org-wide usage counters.
 *
 * Its OWN body rather than an alias of `canAdministerUsers`, even though the two
 * agree today. They answer different questions — "may you see how the whole
 * organisation is working" and "may you change who has access" — and an alias
 * makes one of them move silently when the other is edited. Three identical
 * bodies in this file is the point, not an oversight; see `canCurateLabels`.
 */
export function canViewStats(actor: { role: Role; status: UserStatus }): boolean {
  return actor.status === 'active' && actor.role === 'admin';
}

/** Only an approved account may use the app at all. */
export function canUseApp(actor: { status: UserStatus }): boolean {
  return actor.status === 'active';
}

/**
 * Who may CURATE the org-wide label set — rename, recolour, delete.
 *
 * Creating a label is deliberately not gated beyond `canUseApp`: it happens
 * while someone is looking at a card, and it is cheap and reversible. Deleting
 * is neither, because it strips the label off every card on every board — often
 * boards the deleter is not even a member of. Hence the asymmetry.
 *
 * THIS BODY IS THE POINT OF THE FUNCTION, and it used to be
 * `return canManageBoards(actor)` — an alias, sitting under a docblock arguing
 * at length that it should not be one. The name was separated and the
 * implementation was not, so the moment board authority became per-board it
 * would have followed it: a plain member promoted to run one board would have
 * inherited the power to delete a label off every card in the organisation,
 * with nobody having written a line about labels. Never point this at another
 * predicate, however identical they look on the day.
 */
export function canCurateLabels(actor: { role: Role; status: UserStatus }): boolean {
  return actor.status === 'active' && actor.role === 'admin';
}

/**
 * May this actor see and act on things belonging to a board?
 *
 * The exact predicate `firestore.rules` repeats as `onBoard()` for every card
 * subcollection: active, and either an ADMIN or a listed member. There is no
 * third case — an organizer has no more sight of a board they are not on than
 * anyone else does.
 *
 * It exists as shared code because the attachment callables have to make the
 * same judgement in TypeScript. Cloud Storage rules cannot read Firestore, so
 * downloading, finalizing and removing an attachment are authorized in a
 * function rather than in a rule; if that copy drifted, someone would see a
 * remove button and be told permission denied, or worse, the inverse.
 */
export function canAccessBoard(
  actor: { uid: string; role: Role; status: UserStatus },
  board: { memberUids?: readonly string[] },
): boolean {
  if (actor.status !== 'active') return false;
  // ADMIN, not `canCreateBoards`. This short-circuit used to be
  // `canManageBoards(actor)`, and it is the ONLY gate on `getAttachmentUrl` and
  // `deleteAttachment` — `storage.rules` denies reads outright, so this function
  // IS the download authorization. Left pointing at the board-creation
  // predicate, every organizer could mint a signed URL for any file on any
  // board, including boards Firestore itself now refuses them, with nothing
  // anywhere contradicting it.
  if (actor.role === 'admin') return true;
  return (board.memberUids ?? []).includes(actor.uid);
}

export type AccessChangeRejection =
  | 'not-admin'
  | 'self-change'
  | 'invalid-role'
  | 'invalid-status'
  | 'password-member-only';

/**
 * May `actor` set `target`'s role/status to the requested values?
 *
 * The self-change rule is the important one: an admin editing their own access
 * is how a project ends up with zero admins and no way back in, and it is also
 * the shape of a privilege-escalation bug if the actor check is ever weakened.
 * Admins change other people; the bootstrap script exists for everything else.
 */
export function checkAccessChange(params: {
  actor: { uid: string; role: Role; status: UserStatus };
  targetUid: string;
  /** The target signs in ONLY with an email and password (see `sessionAccess`). */
  targetPasswordOnly: boolean;
  nextRole: unknown;
  nextStatus: unknown;
}):
  | { ok: true; role: Role; status: UserStatus }
  | { ok: false; reason: AccessChangeRejection } {
  const { actor, targetUid, targetPasswordOnly, nextRole, nextStatus } = params;

  if (!canAdministerUsers(actor)) return { ok: false, reason: 'not-admin' };
  if (actor.uid === targetUid) return { ok: false, reason: 'self-change' };
  if (!isRole(nextRole)) return { ok: false, reason: 'invalid-role' };
  if (!isUserStatus(nextStatus)) return { ok: false, reason: 'invalid-status' };
  // Its sessions would act as a member anyway; refusing the claim too keeps
  // the People screen from showing a role the account can never use.
  if (targetPasswordOnly && nextRole !== 'member') return { ok: false, reason: 'password-member-only' };

  // The NARROWED values come back with the verdict, so the caller writes what was
  // actually checked. `setUserAccess` used to re-narrow `nextRole` itself, which
  // meant the coercion above could be validated here and then discarded there.
  return { ok: true, role: nextRole, status: nextStatus };
}


/** Human-readable reason, shared by the callable's error and the UI's message. */
export const ACCESS_CHANGE_MESSAGES: Record<AccessChangeRejection, string> = {
  'not-admin': 'Only an admin can change who has access.',
  'self-change':
    'You cannot change your own role or status. Ask another admin.',
  'invalid-role': 'Unknown role.',
  'invalid-status': 'Unknown status.',
  'password-member-only': 'An account that signs in with an email and password can only be a member.',
};
