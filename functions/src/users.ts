import './setup';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { guarded, sentryDsn } from './sentry';
import { logger } from 'firebase-functions/v2';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  ACCESS_CHANGE_MESSAGES,
  PASSWORD_PROVIDER,
  canAdministerUsers,
  checkAccessChange,
} from '@sabeel/shared';
import { actorOf } from './actor';

/**
 * Does this account sign in with an email and password and nothing else?
 * Such an account is a member, always (`sessionAccess`). Fails CLOSED: only
 * "no such account" answers no — the user-doc check below then says not-found
 * — and any other failure to ask is thrown rather than read as permission.
 */
async function signsInWithPasswordOnly(uid: string): Promise<boolean> {
  try {
    const { providerData } = await getAuth().getUser(uid);
    return providerData.length > 0 && providerData.every((p) => p.providerId === PASSWORD_PROVIDER);
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/user-not-found') return false;
    throw e;
  }
}

/**
 * The ONLY way role or status ever changes. Clients cannot write these fields —
 * firestore.rules denies all writes to users/* — so this callable is the single
 * chokepoint, and every access decision in the app traces back to it.
 *
 * Claims are the authority; the user doc is a mirror kept for display and for
 * admin screens that need to list people the caller has never met.
 */
export const setUserAccess = onCall({ secrets: [sentryDsn] }, guarded(async (request: CallableRequest<{ uid?: unknown; role?: unknown; status?: unknown }>) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }

  const actor = actorOf(auth);

  const targetUid = request.data?.uid;
  const nextRole = request.data?.role;
  const nextStatus = request.data?.status;

  if (typeof targetUid !== 'string' || targetUid.length === 0) {
    throw new HttpsError('invalid-argument', 'A target uid is required.');
  }

  // Only an admin's request can get past checkAccessChange, so only theirs pays
  // for the lookup.
  const targetPasswordOnly = canAdministerUsers(actor) && (await signsInWithPasswordOnly(targetUid));

  const verdict = checkAccessChange({ actor, targetUid, targetPasswordOnly, nextRole, nextStatus });
  if (!verdict.ok) {
    logger.warn('Rejected setUserAccess', {
      actorUid: actor.uid,
      actorRole: actor.role,
      targetUid,
      reason: verdict.reason,
    });
    // permission-denied for authorisation failures, invalid-argument for
    // malformed input — the client shows the message either way, but the
    // distinction matters when reading logs after an incident.
    const code =
      verdict.reason === 'invalid-role' || verdict.reason === 'invalid-status'
        ? 'invalid-argument'
        : 'permission-denied';
    throw new HttpsError(code, ACCESS_CHANGE_MESSAGES[verdict.reason]);
  }

  // The NARROWED values come back with the verdict, and this writes those rather
  // than re-narrowing the raw input here. One place decides what a valid role and
  // status are; this writes what that place approved.
  const { role: nextRoleChecked, status: nextStatusChecked } = verdict;

  const db = getFirestore();
  const userRef = db.doc(`users/${targetUid}`);
  const snap = await userRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'No such user.');
  }

  await getAuth().setCustomUserClaims(targetUid, {
    role: nextRoleChecked,
    status: nextStatusChecked,
  });

  // `claimsUpdatedAt` is what the client watches to know it must force-refresh
  // its ID token. Without it an approved user would sit on a stale `pending`
  // token until it expired (up to an hour) or they signed out and in —
  // which reads as "the admin approved me and nothing happened".
  await userRef.update({
    role: nextRoleChecked,
    status: nextStatusChecked,
    claimsUpdatedAt: FieldValue.serverTimestamp(),
    accessChangedBy: actor.uid,
  });

  // Revoking refresh tokens on the way OUT is what makes disabling immediate:
  // otherwise a disabled user keeps a valid token until it expires.
  if (nextStatusChecked === 'disabled' || nextStatusChecked === 'rejected') {
    await getAuth().revokeRefreshTokens(targetUid);
  }

  logger.info('Access changed', {
    actorUid: actor.uid,
    targetUid,
    role: nextRoleChecked,
    status: nextStatusChecked,
  });

  return { ok: true, uid: targetUid, role: nextRoleChecked, status: nextStatusChecked };
}));
