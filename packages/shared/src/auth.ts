import { ALLOWED_EMAIL_DOMAIN } from './constants';

/**
 * The server-side domain check. Used by the auth-create Cloud Function to reject
 * accounts outside the Workspace, regardless of what the OAuth consent screen is
 * set to.
 *
 * Deliberately strict:
 *  - an unverified email never passes (Google can hand us an unverified address)
 *  - matching is on the FULL domain after the last `@`, so `evil-oursabeel.com`
 *    and `oursabeel.com.attacker.net` do not slip through a naive `endsWith`
 *  - case-insensitive, since providers vary
 */
export function isAllowedEmail(
  email: string | undefined | null,
  emailVerified: boolean,
): boolean {
  if (!email || !emailVerified) return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return domain === ALLOWED_EMAIL_DOMAIN;
}

/**
 * The marker inside the error a refused sign-up returns (functions/src/
 * signUpGate.ts). It reaches the client as `auth/internal-error` with this in
 * the message, which is how the sign-in screen tells it from any other
 * internal error.
 */
export const SIGN_UP_REFUSED = 'SIGN_UP_REFUSED';

/** The same, for a sign-in `beforeSignIn` refuses (a password, another address). */
export const SIGN_IN_REFUSED = 'SIGN_IN_REFUSED';
