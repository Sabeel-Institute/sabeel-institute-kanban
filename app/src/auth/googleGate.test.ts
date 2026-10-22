import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * THE COMPLIANCE CLAIM, AS A TEST.
 *
 * `docs/STORE-RELEASE.md` rests on one property: the native app never causes an
 * account to come into existence. `signInWithCredential` is the only line that
 * would, so the property is really about ORDER — it must be unreachable when no
 * account exists.
 *
 * That is not something the emulator suite can see (it tests the callable, not
 * the caller) and not something the e2e suites can see (they drive the web
 * build, whose whole job is to create accounts). So it is asserted here, where
 * it is cheap and where it will keep being asserted long after everyone has
 * forgotten why it matters.
 *
 * If this file goes red, Apple 5.1.1(v) applies again and the app owes an in-app
 * account deletion flow.
 */

const signInWithCredential = vi.fn();
const googleSignIn = vi.fn();
const googleSignOutNative = vi.fn();
const callable = vi.fn();

vi.mock('firebase/auth', () => ({
  signInWithCredential: (...a: unknown[]) => signInWithCredential(...a),
  GoogleAuthProvider: { credential: (t: string) => ({ token: t }) },
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => (input: unknown) => callable(input),
}));
vi.mock('../firebase', () => ({ auth: {}, functions: {} }));
// Mocked for its IMPORT GRAPH, not its value: firebase-config reaches `env`,
// which reaches react-native, which vitest cannot parse (it ships Flow). The
// client id itself is irrelevant here — the callable is mocked.
vi.mock('../firebase-config', () => ({ GOOGLE_WEB_CLIENT_ID: 'test.apps.googleusercontent.com' }));
vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: vi.fn(),
    hasPlayServices: vi.fn().mockResolvedValue(true),
    signIn: (...a: unknown[]) => googleSignIn(...a),
    signOut: (...a: unknown[]) => googleSignOutNative(...a),
  },
  statusCodes: { SIGN_IN_CANCELLED: '12501', IN_PROGRESS: '12502', PLAY_SERVICES_NOT_AVAILABLE: '12503' },
  isSuccessResponse: (r: unknown) => (r as { ok?: boolean }).ok === true,
}));

const chose = (idToken: string) => ({ ok: true, data: { idToken } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

async function signIn() {
  const { signInWithGoogle } = await import('./google');
  return signInWithGoogle();
}

describe('the native sign-in gate', () => {
  it('NEVER reaches signInWithCredential when no account exists', async () => {
    googleSignIn.mockResolvedValue(chose('tok'));
    callable.mockResolvedValue({ data: { exists: false } });

    await expect(signIn()).resolves.toBe('no-account');

    // The single most important assertion in the codebase's test suite.
    expect(signInWithCredential).not.toHaveBeenCalled();
  });

  it('signs out of Google on refusal, so a wrong account can be swapped', async () => {
    googleSignIn.mockResolvedValue(chose('tok'));
    callable.mockResolvedValue({ data: { exists: false } });

    await signIn();

    // Google remembers the chosen account and silently reuses it next time;
    // without this the refusal is a dead end rather than a retry.
    expect(googleSignOutNative).toHaveBeenCalled();
  });

  it('does not throw on refusal — an un-provisioned colleague is not an error', async () => {
    googleSignIn.mockResolvedValue(chose('tok'));
    callable.mockResolvedValue({ data: { exists: false } });

    // Throwing would route this through toUserMessage -> captureError, filing a
    // Sentry issue every time somebody signs in before being set up.
    await expect(signIn()).resolves.toBe('no-account');
  });

  it('signs out of Google when the server cannot answer, so a retry opens the chooser', async () => {
    googleSignIn.mockResolvedValue(chose('tok'));
    googleSignOutNative.mockResolvedValue(undefined);
    callable.mockRejectedValue(Object.assign(new Error('internal'), { code: 'functions/internal' }));

    await expect(signIn()).rejects.toMatchObject({ code: 'functions/internal' });
    expect(signInWithCredential).not.toHaveBeenCalled();
    expect(googleSignOutNative).toHaveBeenCalledTimes(1);
  });

  it('signs out of Google when the exchange itself fails, and keeps its error', async () => {
    googleSignIn.mockResolvedValue(chose('tok'));
    googleSignOutNative.mockRejectedValue(new Error('sign-out failed'));
    callable.mockResolvedValue({ data: { exists: true } });
    signInWithCredential.mockRejectedValueOnce(Object.assign(new Error('network'), { code: 'auth/network-request-failed' }));

    await expect(signIn()).rejects.toMatchObject({ code: 'auth/network-request-failed' });
    expect(googleSignOutNative).toHaveBeenCalledTimes(1);
  });

  it('signs in normally when the account exists', async () => {
    googleSignIn.mockResolvedValue(chose('tok'));
    callable.mockResolvedValue({ data: { exists: true } });

    await expect(signIn()).resolves.toBe('signed-in');
    expect(signInWithCredential).toHaveBeenCalledTimes(1);
  });

  it('asks before it signs in, never after', async () => {
    const order: string[] = [];
    googleSignIn.mockResolvedValue(chose('tok'));
    callable.mockImplementation(() => {
      order.push('asked');
      return Promise.resolve({ data: { exists: true } });
    });
    signInWithCredential.mockImplementation(() => {
      order.push('signed-in');
      return Promise.resolve({});
    });

    await signIn();

    // Checking the status AFTER signing in and then signing out is the obvious
    // implementation, and it creates the account before it discovers it should
    // not have. Order is the whole design.
    expect(order).toEqual(['asked', 'signed-in']);
  });

  it('creates nothing when the chooser is dismissed', async () => {
    googleSignIn.mockResolvedValue({ ok: false });

    await expect(signIn()).resolves.toBe('cancelled');
    expect(callable).not.toHaveBeenCalled();
    expect(signInWithCredential).not.toHaveBeenCalled();
  });
});
