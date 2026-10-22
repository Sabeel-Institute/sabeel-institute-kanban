import {
  GoogleSignin,
  statusCodes,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { GOOGLE_WEB_CLIENT_ID } from '../firebase-config';
import { auth, functions } from '../firebase';
import type { SignInOutcome } from './outcome';

/**
 * Google sign-in on Android (web sibling: google.web.ts).
 *
 * Uses the native Google Sign-In SDK to obtain an ID token, then exchanges it
 * for a Firebase credential — the same `signInWithCredential` path the emulator
 * dev sign-in exercises, so everything downstream of the session is identical.
 *
 * Requires BOTH of these, or Google returns an opaque `DEVELOPER_ERROR`:
 *  - the debug/release SHA-1 registered on the Firebase Android app, with
 *    `google-services.json` **re-downloaded afterwards** — the re-download is
 *    what adds the `client_type: 1` entry;
 *  - `webClientId` set to the WEB client id, not the Android one.
 */
let configured = false;
function ensureConfigured() {
  if (configured) return;
  // MUST be the *Web* OAuth client id (client_type: 3). Passing the Android id
  // is a classic source of DEVELOPER_ERROR.
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  configured = true;
}

/**
 * Clear the remembered Google account.
 *
 * Without this the next `signIn()` silently reuses the previous account and
 * there is no way to switch users — signing out of the app must also sign out
 * of Google so the account chooser reappears. On a shared or handed-over phone
 * that is the difference between signing out and only appearing to.
 */
export async function googleSignOut(): Promise<void> {
  ensureConfigured();
  await GoogleSignin.signOut();
}

/**
 * Web-only concepts, present here so the seam has one shape.
 *
 * Native has no popup to block and no redirect to fall back to — Play Services
 * shows its own account sheet — so this can never be thrown and the redirect is
 * never reachable. See `google.web.ts` for why the web side needs both.
 */
export class PopupBlockedError extends Error {
  readonly code = 'auth/popup-blocked';
}

export async function signInWithGoogleRedirect(): Promise<SignInOutcome> {
  return signInWithGoogle();
}

const accountExists = httpsCallable<{ idToken: string }, { exists: boolean }>(
  functions,
  'accountExists',
);

/**
 * THIS APP DOES NOT CREATE ACCOUNTS, AND MUST NOT LEARN HOW.
 *
 * `signInWithCredential` is the line that would create one, so nothing may reach
 * it until an account is known to exist. `GoogleSignin.signIn()` above it is
 * pure Google OAuth — it yields a token and touches nothing in this Firebase
 * project — which is the only reason there is a window to check in.
 *
 * There is deliberately no sign-up affordance anywhere in this app, and no
 * message here naming where to get an account. Both stores stop requiring in-app
 * account deletion only while the app neither creates an account nor points at
 * somewhere that does, and "sign in on the website first" is the second of those
 * two triggers stated almost verbatim. The instruction belongs in the onboarding
 * email. See docs/STORE-RELEASE.md before adding anything friendlier here.
 *
 * This file is the NATIVE half of the seam (iOS and Android). `google.web.ts` is
 * the web half and keeps creating accounts, which is why nothing here has to
 * detect a platform.
 */
export async function signInWithGoogle(): Promise<SignInOutcome> {
  ensureConfigured();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) {
      // The account chooser was dismissed. Not an error worth surfacing.
      return 'cancelled';
    }
    const idToken = response.data.idToken;
    if (!idToken) throw new Error('Google sign-in returned no ID token.');

    // Google still remembers the chosen account, and `signIn()` would silently
    // reuse it. After a refusal, or any failed exchange, the next tap must open
    // the chooser again: somebody who picked the wrong account could otherwise
    // never switch, and somebody whose sign-in the server could not answer
    // would retry into the same failure with no chooser to show the tap did
    // anything (2026-10-22, when every function stopped starting).
    try {
      const { data } = await accountExists({ idToken });
      if (!data.exists) {
        await googleSignOut();
        return 'no-account';
      }
      await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    } catch (e) {
      // The failure is the news; one in clearing the account must not hide it.
      await googleSignOut().catch(() => undefined);
      throw e;
    }
    return 'signed-in';
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) {
      return 'cancelled'; // cancelled, or a sign-in is already running
    }
    if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play services are required to sign in.');
    }
    throw e;
  }
}

export const googleSignInAvailable = true;
