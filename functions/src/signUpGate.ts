import { beforeUserCreated, beforeUserSignedIn, HttpsError } from 'firebase-functions/v2/identity';
import { logger } from 'firebase-functions/v2';
import { SIGN_IN_REFUSED, SIGN_UP_REFUSED } from '@sabeel/shared';
import { refusedSignIn, refusedSignUp } from './provision';

/**
 * REFUSED BEFORE THE ACCOUNT EXISTS. `onUserCreate` (auth.ts) refuses the same
 * sign-ups, but only after Firebase has made the account: for a moment it
 * existed, holding no claims and so reading nothing, and was then deleted.
 * Here nothing is made.
 *
 * It matters from the day email-and-password sign-in exists (2026-10-15, for
 * the store reviewers' account): with that provider on, anyone holding the
 * web app's public API key can ask Identity Toolkit to make an account, app or
 * no app. Accounts with a password are made by an admin through the Admin SDK
 * or the Firebase console, which no blocking function sees.
 *
 * Needs the project on Identity Platform (it is, since 2026-10-15); a blocking
 * function will not deploy to one that is not. And it must be DEPLOYED, and
 * registered as the project's beforeCreate trigger, BEFORE the Email/Password
 * provider is switched on, or there is a window with no door.
 *
 * WHAT IT DOES NOT CLOSE: a sign-up for an address that already has an
 * account is answered "already exists" before any function runs, so anyone
 * holding the public key can still ask whether an address has an account.
 * Closing that would mean switching sign-up off, which also stops a
 * colleague's first Google sign-in on the web.
 */
export const beforeSignUp = beforeUserCreated((event) => {
  const refused = refusedSignUp(
    event.additionalUserInfo?.providerId ?? null,
    event.data?.email,
    event.data?.emailVerified ?? false,
  );
  if (!refused) return;
  logger.warn('Refused sign-up', { reason: refused, email: event.data?.email ?? null });
  throw new HttpsError('permission-denied', `${SIGN_UP_REFUSED}: ${refused}`);
});

/**
 * REFUSED AT EVERY SIGN-IN: a password sign-in for any address but the one
 * (`refusedSignIn`). `beforeSignUp` stops anyone making a password account
 * from a client; this stops an account an admin made with a password, for any
 * other address, from ever signing in. firestore.rules and storage.rules give
 * such a session nothing even if one got past (`isSignedIn`, `isActive`).
 *
 * The refusal reads like a wrong password on the sign-in screen
 * (app/src/auth/email.ts), so it says nothing about which address is the one.
 */
export const beforeSignIn = beforeUserSignedIn((event) => {
  const refused = refusedSignIn(event.additionalUserInfo?.providerId ?? null, event.data?.email);
  if (!refused) return;
  logger.warn('Refused sign-in', { reason: refused, uid: event.data?.uid ?? null });
  throw new HttpsError('permission-denied', `${SIGN_IN_REFUSED}: ${refused}`);
});
