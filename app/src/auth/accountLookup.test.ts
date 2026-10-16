import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Only Auth saying the account is gone is a "deleted": the refusal screen
 * hangs on this answer, so anything Auth did not say (an error, no network,
 * an empty answer) must come back `unknown`, which keeps the person waiting
 * rather than turning them away. The real round trip, against the Auth
 * emulator with an account the trigger deleted, is in scripts/web-e2e.mjs.
 */

vi.mock('../env', () => ({ USE_EMULATORS: false, EMULATOR_HOST: '127.0.0.1', EMULATOR_PORTS: { auth: 61202 } }));
vi.mock('../firebase-config', () => ({ firebaseConfig: { apiKey: 'the-web-key' } }));

const user = { getIdToken: async () => 'id-token-1' } as unknown as import('firebase/auth').User;

function answer(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lookUpAccount', () => {
  it('asks Identity Toolkit about the session’s own account, with its ID token', async () => {
    const fetch = answer(200, { users: [{ localId: 'u1' }] });
    vi.stubGlobal('fetch', fetch);
    const { lookUpAccount } = await import('./accountLookup');
    await expect(lookUpAccount(user)).resolves.toBe('exists');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=the-web-key');
    expect(JSON.parse(String(init.body))).toEqual({ idToken: 'id-token-1' });
  });

  it('is "deleted" only when Auth answers USER_NOT_FOUND', async () => {
    vi.stubGlobal('fetch', answer(400, { error: { code: 400, message: 'USER_NOT_FOUND' } }));
    const { lookUpAccount } = await import('./accountLookup');
    await expect(lookUpAccount(user)).resolves.toBe('deleted');
  });

  it.each([
    ['another refusal', 400, { error: { message: 'INVALID_ID_TOKEN' } }],
    ['a server error', 503, { error: { message: 'UNAVAILABLE' } }],
    ['an answer with no account in it', 200, {}],
  ])('is "unknown" for %s', async (_what, status, body) => {
    vi.stubGlobal('fetch', answer(status, body));
    const { lookUpAccount } = await import('./accountLookup');
    await expect(lookUpAccount(user)).resolves.toBe('unknown');
  });

  it('is "unknown" with no network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const { lookUpAccount } = await import('./accountLookup');
    await expect(lookUpAccount(user)).resolves.toBe('unknown');
  });
});
