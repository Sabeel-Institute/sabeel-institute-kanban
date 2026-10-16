import { NEW_USER_ACCESS, PASSWORD_PROVIDER, PASSWORD_SIGN_IN_EMAIL, isAllowedEmail } from '@sabeel/shared';
import type { Role, UserStatus } from '@sabeel/shared';

/**
 * The decision half of new-user provisioning, kept pure so it can be tested
 * exhaustively without an emulator or the Admin SDK. `auth.ts` performs the
 * effects.
 */

export type ProvisionDecision =
  | { action: 'reject'; reason: 'bad-domain'; email: string | null }
  | {
      action: 'provision';
      claims: { role: Role; status: UserStatus };
      profile: { email: string; displayName: string; photoUrl: string | null };
    };

export function decideProvision(user: {
  email?: string | null;
  emailVerified?: boolean;
  displayName?: string | null;
  photoURL?: string | null;
}): ProvisionDecision {
  const { email, emailVerified = false } = user;

  // The domain gate, and since 2026-07-19 the only one: the consent screen is
  // External, so Google will happily hand us any Google account. Only the client
  // `hd` hint sits in front of this, and that is trivially bypassed. This check
  // must hold entirely on its own.
  if (!isAllowedEmail(email, emailVerified)) {
    return { action: 'reject', reason: 'bad-domain', email: email ?? null };
  }

  return {
    action: 'provision',
    claims: { ...NEW_USER_ACCESS },
    profile: {
      email: email as string,
      // Fall back to the local part rather than showing an empty row in the
      // admin's approval list — they approve people by name and address.
      displayName: user.displayName?.trim() || (email as string).split('@')[0],
      photoUrl: user.photoURL ?? null,
    },
  };
}

/** Why a sign-up made from a client is refused before any account exists. */
export type SignUpRefusal = 'self-signup' | 'unsupported-provider' | 'bad-domain';

/**
 * THE DOOR, BEFORE ANY ACCOUNT EXISTS: what the blocking `beforeSignUp`
 * (signUpGate.ts) asks of every sign-up made from a client. Exactly one is
 * legitimate here, a colleague's first Google sign-in on the org domain, made
 * on the web. An email-and-password account is made by an admin through the
 * Admin SDK or the Firebase console, which no blocking function sees, so a
 * password sign-up from a client is always someone holding the site's public
 * API key. Null lets it in.
 *
 * `decideProvision` stays behind the door for anything that gets past it.
 */
export function refusedSignUp(
  providerId: string | null,
  email: string | null | undefined,
  emailVerified: boolean,
): SignUpRefusal | null {
  if (providerId === 'password') return 'self-signup';
  if (providerId !== 'google.com') return 'unsupported-provider';
  if (!isAllowedEmail(email, emailVerified)) return 'bad-domain';
  return null;
}

/**
 * THE DOOR AT EVERY SIGN-IN: what the blocking `beforeSignIn` asks. A password
 * sign-in is accepted for ONE address (`PASSWORD_SIGN_IN_EMAIL`; Faisal,
 * 2026-10-15: "should only accept that one email"), so an account an admin
 * made with a password for any other address cannot sign in at all. Google
 * sign-ins pass: the domain gate and approval already hold those.
 */
export function refusedSignIn(providerId: string | null, email: string | null | undefined): 'other-address' | null {
  if (providerId === PASSWORD_PROVIDER && email !== PASSWORD_SIGN_IN_EMAIL) return 'other-address';
  return null;
}
