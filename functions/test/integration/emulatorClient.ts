/**
 * Helpers for talking to the running emulators as a real client would.
 *
 * These tests exercise the deployed artefacts — the auth trigger and the
 * callable — rather than their extracted logic, because the logic tests cannot
 * prove the wiring is right.
 */
import { initializeApp, deleteApp, getApps, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMULATOR_PROJECT_ID, EMULATOR_STORAGE_BUCKET } from '@sabeel/shared';

const PROJECT_ID = EMULATOR_PROJECT_ID;

/**
 * READ the emulator hosts; never assign them.
 *
 * Overwriting what `emulators:exec` exported would pin every integration test
 * to one address whatever `firebase.json` says. On a machine where three
 * checkouts run emulators that is the one genuinely dangerous state in this
 * codebase: the suite would connect to whatever sat there — possibly a SIBLING
 * repo's Firestore — read and write happily, and pass.
 *
 * LAZY, not module-load. The two integration passes run against DIFFERENT
 * emulator sets (`sabeel-ci test-emulator`): the rules pass has no Functions
 * emulator, so a host it does not start is legitimately absent there.
 * `concurrentMoves.test.ts` rides along in that pass and imports this module
 * purely for `adminDb()`. Demanding every host at import time broke it — so
 * each host is required at the point of use, and a test pays only for what it
 * actually touches.
 *
 * There is no fallback. `emulators:exec` exports these
 * (`firebase-tools/lib/emulator/env.js`) for whichever emulators it started, so
 * a missing one means either the wrapper was bypassed or that emulator is not in
 * this set. Both are bugs to surface, not cases to default around.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is unset — run via npm run test:emulator, and check this test is in the ` +
        `pass that starts that emulator (test:emulator:functions has them all)`,
    );
  }
  return value;
}

const authHost = () => requireEnv('FIREBASE_AUTH_EMULATOR_HOST');

/**
 * The functions emulator is the exception: firebase-tools exports a host var for
 * Firestore, Auth, Storage, Database, Pub/Sub, Eventarc and Tasks — but NOT for
 * functions. So this one comes from `firebase.json`, which is what the emulator
 * actually bound, rather than from a literal that could disagree with it.
 */
function functionsOrigin(): string {
  const config = JSON.parse(
    // cwd is the functions workspace under vitest, as elsewhere in these suites.
    readFileSync(resolve('..', 'firebase.json'), 'utf8'),
  );
  const port = config?.emulators?.functions?.port;
  if (typeof port !== 'number') {
    throw new Error('firebase.json has no emulators.functions.port');
  }
  return `http://127.0.0.1:${port}/${PROJECT_ID}/us-central1`;
}

process.env.GCLOUD_PROJECT = PROJECT_ID;

let app: App | undefined;

function adminApp(): App {
  if (!app) {
    app = getApps().length
      ? getApps()[0]
      : initializeApp({ projectId: PROJECT_ID, storageBucket: EMULATOR_STORAGE_BUCKET });
  }
  return app;
}

export const adminAuth = () => getAuth(adminApp());
export const adminDb = () => getFirestore(adminApp());
export const adminBucket = () => getStorage(adminApp()).bucket();

export async function shutdown() {
  if (app) {
    await deleteApp(app);
    app = undefined;
  }
}

/** Poll until `check` returns a value, or throw. Triggers are asynchronous. */
export async function waitFor<T>(
  label: string,
  check: () => Promise<T | undefined | null>,
  timeoutMs = 15000,
): Promise<T> {
  const started = Date.now();
  let lastErr: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const v = await check();
      if (v !== undefined && v !== null && v !== false) return v as T;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Timed out waiting for ${label} after ${timeoutMs}ms${lastErr ? ` (last error: ${lastErr})` : ''}`,
  );
}

/** Poll until `check` is true, and throw if it ever becomes false-ish early. */
export async function waitUntilGone(
  label: string,
  stillThere: () => Promise<boolean>,
  timeoutMs = 15000,
): Promise<void> {
  await waitFor(label, async () => ((await stillThere()) ? undefined : true), timeoutMs);
}

/**
 * Mint a real ID token carrying the user's current custom claims, the way a
 * signed-in client would hold one. Custom token → signInWithCustomToken is the
 * only route that produces a token the callable will accept.
 */
export async function idTokenFor(uid: string): Promise<string> {
  const customToken = await adminAuth().createCustomToken(uid);
  const res = await fetch(
    `http://${authHost()}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`custom-token exchange failed: ${await res.text()}`);
  const payload = (await res.json()) as { idToken?: string };
  if (!payload.idToken) throw new Error('custom-token exchange returned no idToken');
  return payload.idToken;
}

/**
 * An ID token from an email-and-password sign-in, the session the email door
 * makes: its `firebase.sign_in_provider` is 'password', which is what holds it
 * to a member whatever its claims say.
 */
export async function passwordIdToken(email: string, password: string): Promise<string> {
  const res = await fetch(
    `http://${authHost()}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`password sign-in failed: ${await res.text()}`);
  const payload = (await res.json()) as { idToken?: string };
  if (!payload.idToken) throw new Error('password sign-in returned no idToken');
  return payload.idToken;
}

export interface CallResult {
  status: number;
  body: { result?: unknown; error?: { status?: string; message?: string } };
}

/** Invoke a callable over HTTP exactly as the client SDK does. */
export async function callFunction(
  name: string,
  data: unknown,
  idToken?: string,
): Promise<CallResult> {
  const res = await fetch(`${functionsOrigin()}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  let body: CallResult['body'] = {};
  try {
    body = (await res.json()) as CallResult['body'];
  } catch {
    // non-JSON error page; leave body empty and let the status speak
  }
  return { status: res.status, body };
}

/**
 * Create a user and wait for the auth trigger to finish provisioning it, then
 * force the claims the test needs. Tests that want an organizer or admin cannot get
 * one from the trigger — everyone starts pending/member by design.
 */
export async function makeUser(opts: {
  uid: string;
  email: string;
  role?: string;
  status?: string;
  displayName?: string;
  /** An email-and-password account, as an admin makes one for the email door. */
  password?: string;
}): Promise<void> {
  await adminAuth().createUser({
    uid: opts.uid,
    email: opts.email,
    emailVerified: true,
    displayName: opts.displayName ?? opts.uid,
    ...(opts.password ? { password: opts.password } : {}),
  });

  await waitFor(`provisioning of ${opts.uid}`, async () => {
    const snap = await adminDb().doc(`users/${opts.uid}`).get();
    return snap.exists ? snap : undefined;
  });

  if (opts.role || opts.status) {
    const role = opts.role ?? 'member';
    const status = opts.status ?? 'pending';
    await adminAuth().setCustomUserClaims(opts.uid, { role, status });
    await adminDb().doc(`users/${opts.uid}`).update({ role, status });
  }
}
