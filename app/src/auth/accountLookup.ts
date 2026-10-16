import type { User } from 'firebase/auth';
import { firebaseConfig } from '../firebase-config';
import { EMULATOR_HOST, EMULATOR_PORTS, USE_EMULATORS } from '../env';

/**
 * Does the signed-in account still exist on the server?
 *
 * While a new account waits for its profile, two very different things look
 * the same from the client: the onUserCreate trigger has not finished (a cold
 * start can take tens of seconds), or it has DELETED the account (an address
 * outside the institute). Only the second may be told **Wrong account**, and
 * only Auth can say which it is.
 *
 * Asked of Identity Toolkit's `accounts:lookup` directly, with the session's
 * current ID token (still valid for a deleted account: nothing revokes it),
 * rather than through `user.reload()` or a forced token refresh. Those ask the
 * same thing, but in production Firebase signs the person out on the answer,
 * taking away the screen that would tell them why, and on the Auth emulator
 * the refresh fails differently and signs nobody out. A deleted account
 * answers `USER_NOT_FOUND` in production and on the emulator alike. The same
 * module as the sibling time tracker's.
 *
 * `unknown` when the question could not be answered (offline, a server
 * error): never read as a refusal.
 */
type AccountState = 'exists' | 'deleted' | 'unknown';

const IDENTITY_TOOLKIT = USE_EMULATORS
  ? `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}/identitytoolkit.googleapis.com`
  : 'https://identitytoolkit.googleapis.com';

export async function lookUpAccount(user: User): Promise<AccountState> {
  try {
    const idToken = await user.getIdToken();
    const res = await fetch(`${IDENTITY_TOOLKIT}/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const body = (await res.json().catch(() => null)) as {
      users?: unknown[];
      error?: { message?: string };
    } | null;
    if (res.ok) return body?.users?.length ? 'exists' : 'unknown';
    return body?.error?.message?.startsWith('USER_NOT_FOUND') ? 'deleted' : 'unknown';
  } catch {
    return 'unknown';
  }
}
