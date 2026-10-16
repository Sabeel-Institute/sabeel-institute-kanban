import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A first sign-in waits for the profile the server writes (`onUserCreate`).
 * What it promises the person: a GENUINE account is never told "Wrong
 * account", however late the profile is; while it waits it says "setting up",
 * then "still setting up" with Try again; and it gets in once the profile is
 * there, by itself when the profile is heard, through Try again when the write
 * was missed. Only an account the server really refused (deleted, which Auth
 * confirms) is told "Wrong account".
 *
 * The real `session.ts` runs here, with Firebase replaced at its boundary.
 * The listener stand-in can be made to MISS a write, which is what the
 * Firestore emulator was measured doing (docs/PHASE_STATUS.md, 2026-10-16):
 * the profile written while the client's listen for it was being registered,
 * the listener answering "does not exist" and never hearing of it. A fresh
 * connection (Try again) is modelled as what it is on a phone and, through a
 * reload, on the web: new listeners that hear what the server holds. The
 * old session waited ten seconds and showed Wrong account, for good.
 *
 * Not covered here, because it is a browser's: that the web's Try again
 * reloads the page and the reloaded page gets in. scripts/web-e2e.mjs settles
 * every sign-in through the app's own Try again and counts each one.
 */

type Profile = Record<string, unknown>;
interface Snap {
  exists: () => boolean;
  data: () => Profile | undefined;
  metadata: { fromCache: boolean };
}
interface FakeUser {
  uid: string;
  email: string;
  displayName: string;
  getIdToken: () => Promise<string>;
  getIdTokenResult: (force?: boolean) => Promise<{ claims: Profile; signInProvider: string }>;
}

const snap = (profile: Profile | null): Snap => ({
  exists: () => profile !== null,
  data: () => profile ?? undefined,
  metadata: { fromCache: false },
});

/** What the server holds: what a NEW listener hears. */
let serverProfile: Profile | null = null;
/** The trigger refused this account and deleted it; Auth says so. */
let deleted = false;
/** No network: Auth cannot be asked. */
let offline = false;
let lookups = 0;
let freshConnections = 0;
const listeners: { next: (s: Snap) => void; active: boolean }[] = [];
const authCallbacks: ((u: FakeUser | null) => void)[] = [];
const fakeAuth: { currentUser: FakeUser | null } = { currentUser: null };

function setAuthUser(u: FakeUser | null) {
  fakeAuth.currentUser = u;
  authCallbacks.forEach((cb) => cb(u));
}

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: FakeUser | null) => void) => {
    authCallbacks.push(cb);
    return () => undefined;
  },
  signOut: async () => {
    if (fakeAuth.currentUser) setAuthUser(null);
  },
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  // A new listener hears what the server holds NOW; after that it hears only
  // what a test hands it, which is how a missed write is modelled.
  onSnapshot: (_ref: unknown, next: (s: Snap) => void) => {
    const l = { next, active: true };
    listeners.push(l);
    const now = serverProfile;
    queueMicrotask(() => l.active && next(snap(now)));
    return () => {
      l.active = false;
    };
  },
}));
vi.mock('./firebase', () => ({ auth: fakeAuth, db: {} }));
vi.mock('./env', () => ({ IS_DEV: false }));
vi.mock('./auth/google', () => ({ googleSignOut: async () => undefined }));
vi.mock('./notify', () => ({ registerPush: async () => undefined, unregisterPush: async () => undefined }));
vi.mock('./liveQuery', () => ({ clearLiveResultCache: () => undefined }));
vi.mock('./stats', () => ({ clearStatsCache: () => undefined }));
vi.mock('./auth/accountLookup', () => ({
  lookUpAccount: async () => {
    lookups += 1;
    return offline ? 'unknown' : deleted ? 'deleted' : 'exists';
  },
}));
vi.mock('./freshConnection', () => ({
  freshConnection: async () => {
    freshConnections += 1;
  },
}));

const PROFILE: Profile = {
  displayName: 'Faisal',
  email: 'faisal@oursabeel.com',
  status: 'pending',
  role: 'member',
};

function user(uid = 'u1'): FakeUser {
  return {
    uid,
    email: 'faisal@oursabeel.com',
    displayName: 'Faisal',
    getIdToken: async () => 'token',
    getIdTokenResult: async () => ({
      claims: { role: 'member', status: 'pending' },
      signInProvider: 'google.com',
    }),
  };
}

/**
 * The module, fresh for every test: it keeps the session in module state and
 * registers its auth listener on import. Taken apart by name so the dead-code
 * audit sees which of its exports these tests use.
 */
let session: Pick<
  typeof import('./session'),
  'sessionNow' | 'retryProvisioning' | 'signOut' | 'PROVISIONING_PATIENCE_MS'
>;

/** Sign in, and let the first listener answer: the profile is not there yet. */
async function signInBeforeTheProfile() {
  setAuthUser(user());
  await vi.advanceTimersByTimeAsync(0);
  expect(session.sessionNow()).toMatchObject({ state: 'provisioning', slow: false });
}

/** The trigger writes the profile, and the listener MISSES it. */
function profileWrittenUnheard() {
  serverProfile = { ...PROFILE };
}

/** The trigger writes the profile, and the listener hears it, as it normally does. */
function profileWrittenAndHeard() {
  serverProfile = { ...PROFILE };
  listeners.filter((l) => l.active).forEach((l) => l.next(snap(serverProfile)));
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  serverProfile = null;
  deleted = false;
  offline = false;
  lookups = 0;
  freshConnections = 0;
  listeners.length = 0;
  authCallbacks.length = 0;
  fakeAuth.currentUser = null;
  const { sessionNow, retryProvisioning, signOut, PROVISIONING_PATIENCE_MS } = await import('./session');
  session = { sessionNow, retryProvisioning, signOut, PROVISIONING_PATIENCE_MS };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a genuine first sign-in waiting for its profile', () => {
  it('goes straight in when the profile is heard on time', async () => {
    await signInBeforeTheProfile();
    profileWrittenAndHeard();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.sessionNow()).toMatchObject({ state: 'signed-in', user: { uid: 'u1', status: 'pending' } });
  });

  it('is never told Wrong account when the write is missed, says "still setting up", and Try again lets it in', async () => {
    await signInBeforeTheProfile();
    profileWrittenUnheard();
    await vi.advanceTimersByTimeAsync(10_000);
    // Still within the wait: the plain "setting up" spinner.
    expect(session.sessionNow()).toMatchObject({ state: 'provisioning', slow: false });
    await vi.advanceTimersByTimeAsync(session.PROVISIONING_PATIENCE_MS);
    expect(session.sessionNow()).toMatchObject({ state: 'provisioning', slow: true });
    // A minute on, Auth still asked and still no refusal.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.sessionNow()).toMatchObject({ state: 'provisioning', slow: true });
    expect(lookups).toBeGreaterThan(5);

    await session.retryProvisioning();
    await vi.advanceTimersByTimeAsync(0);
    expect(freshConnections).toBe(1);
    expect(session.sessionNow()).toMatchObject({ state: 'signed-in', user: { uid: 'u1' } });
  });

  it('a slow server: "still setting up", never Wrong account, and in by itself once the profile is heard', async () => {
    await signInBeforeTheProfile();
    await vi.advanceTimersByTimeAsync(session.PROVISIONING_PATIENCE_MS + 6_000);
    expect(session.sessionNow()).toMatchObject({ state: 'provisioning', slow: true });
    profileWrittenAndHeard();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.sessionNow()).toMatchObject({ state: 'signed-in' });
    expect(freshConnections).toBe(0);
  });

  it('with no network to ask Auth, is still setting up, never refused', async () => {
    await signInBeforeTheProfile();
    offline = true;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(session.sessionNow()).toMatchObject({ state: 'provisioning', slow: true });
  });

  it('Try again starts the wait over: "setting up" again before "still setting up"', async () => {
    await signInBeforeTheProfile();
    await vi.advanceTimersByTimeAsync(session.PROVISIONING_PATIENCE_MS + 6_000);
    expect(session.sessionNow()).toMatchObject({ slow: true });
    await session.retryProvisioning();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.sessionNow()).toMatchObject({ state: 'provisioning', slow: false });
  });
});

describe('an account the server refused', () => {
  it('is told Wrong account within seconds of Auth saying it is gone, and stays told', async () => {
    await signInBeforeTheProfile();
    deleted = true;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(session.sessionNow()).toEqual({ state: 'not-provisioned', uid: 'u1' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.sessionNow()).toEqual({ state: 'not-provisioned', uid: 'u1' });
  });

  it('Sign out from the refusal reaches the sign-in screen', async () => {
    await signInBeforeTheProfile();
    deleted = true;
    await vi.advanceTimersByTimeAsync(4_000);
    await session.signOut();
    expect(session.sessionNow()).toEqual({ state: 'signed-out' });
  });
});
