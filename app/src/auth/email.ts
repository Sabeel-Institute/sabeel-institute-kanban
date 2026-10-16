import { signInWithEmailAndPassword } from 'firebase/auth';
import { SIGN_IN_REFUSED } from '@sabeel/shared';
import { auth } from '../firebase';

/**
 * The email door: an email-and-password sign-in, for accounts an administrator
 * made in the Firebase console or through the Admin API. Decided by Faisal on
 * 2026-10-15, and for ONE address (`PASSWORD_SIGN_IN_EMAIL`): the server
 * refuses a password sign-in for any other, and a session through here acts as
 * a member whatever its claims say (`sessionAccess`). Nothing here needs to
 * know either: the screen offers a plain email sign-in, and a refusal reads
 * exactly like a wrong password.
 *
 * It CANNOT make an account: `signInWithEmailAndPassword` fails when there is
 * none, and the app has no sign-up call on any surface. So, unlike Google
 * sign-in on a phone (`accountExists`), it needs no gate before it to stay out
 * of the stores' account-creation rule.
 *
 * Same on every surface: the Firebase JS SDK, no native module.
 */

/** The answers a person caused, and can act on. Not faults: not reported. */
export type EmailSignInRefusal = 'wrong' | 'invalid-email' | 'disabled' | 'too-many';

export const EMAIL_SIGN_IN_MESSAGES: Record<EmailSignInRefusal, string> = {
  // Firebase answers a wrong password and an unknown address alike
  // (`auth/invalid-credential`, with email enumeration protection on), and so
  // does this: saying which would tell a stranger which addresses have accounts.
  wrong: 'That email and password do not match an account.',
  'invalid-email': 'That is not an email address.',
  disabled: 'This account has been turned off. Contact your administrator.',
  'too-many': 'Too many tries. Wait a few minutes, then try again.',
};

const REFUSALS: Record<string, EmailSignInRefusal> = {
  'auth/invalid-credential': 'wrong',
  'auth/wrong-password': 'wrong',
  'auth/user-not-found': 'wrong',
  'auth/missing-password': 'wrong',
  'auth/invalid-email': 'invalid-email',
  'auth/user-disabled': 'disabled',
  'auth/too-many-requests': 'too-many',
};

/**
 * Sign in, or say why not. Null means signed in; the session then takes over
 * as for any sign-in. Anything that is not a person's own mistake is thrown,
 * for the screen's error path to report.
 */
export async function signInWithEmail(email: string, password: string): Promise<EmailSignInRefusal | null> {
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
    return null;
  } catch (e) {
    const refusal = REFUSALS[(e as { code?: string }).code ?? ''];
    if (refusal) return refusal;
    // The server's refusal of a password sign-in for an address that may not
    // use one (functions/src/signUpGate.ts). It arrives as an internal error
    // carrying the marker, and is said exactly like a wrong password.
    if (e instanceof Error && e.message.includes(SIGN_IN_REFUSED)) return 'wrong';
    throw e;
  }
}
