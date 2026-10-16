import type { CallableRequest } from 'firebase-functions/v2/https';
import { sessionAccess, type Role, type UserStatus } from '@sabeel/shared';

/**
 * Who is calling, as every role-checking callable sees them.
 *
 * Read from the TOKEN, never from the user doc: the doc is a mirror, and a
 * stale or tampered mirror must not be able to grant anything. And read as the
 * SESSION allows (`sessionAccess`): a password sign-in for any address but the
 * one has no access, and the one is a member whatever its claims say — the same
 * rule firestore.rules applies. One helper so no callable can read the claims
 * directly; `actor.test.ts` fails on one that does.
 */
export function actorOf(auth: NonNullable<CallableRequest['auth']>): { uid: string; role: Role; status: UserStatus } {
  return {
    uid: auth.uid,
    ...sessionAccess(
      { role: auth.token.role, status: auth.token.status },
      { signInProvider: auth.token.firebase?.sign_in_provider, email: auth.token.email },
    ),
  };
}
