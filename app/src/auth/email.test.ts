import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The email door's answers. A refusal a person caused comes back as a reason
 * the screen says in a sentence, unreported; anything else is thrown, for the
 * screen's error path, which reports it. Getting that split wrong either fills
 * Sentry with mistyped passwords or hides a real fault behind "wrong password".
 */
vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: vi.fn() }));
vi.mock('../firebase', () => ({ auth: { name: 'auth' } }));

import { signInWithEmailAndPassword } from 'firebase/auth';
import { EMAIL_SIGN_IN_MESSAGES, signInWithEmail } from './email';

const signIn = signInWithEmailAndPassword as unknown as ReturnType<typeof vi.fn>;
const failWith = (code: string) => signIn.mockRejectedValue(Object.assign(new Error(code), { code }));

beforeEach(() => vi.clearAllMocks());

describe('signInWithEmail', () => {
  it('signs in, trimming the address and never the password', async () => {
    signIn.mockResolvedValue({});
    await expect(signInWithEmail('  someone@oursabeel.com ', ' pass word ')).resolves.toBeNull();
    expect(signIn).toHaveBeenCalledWith({ name: 'auth' }, 'someone@oursabeel.com', ' pass word ');
  });

  it.each([
    ['auth/invalid-credential', 'wrong'],
    ['auth/wrong-password', 'wrong'],
    ['auth/user-not-found', 'wrong'],
    ['auth/missing-password', 'wrong'],
    ['auth/invalid-email', 'invalid-email'],
    ['auth/user-disabled', 'disabled'],
    ['auth/too-many-requests', 'too-many'],
  ])('answers %s with a sentence (%s), not an error', async (code, refusal) => {
    failWith(code);
    await expect(signInWithEmail('a@oursabeel.com', 'x')).resolves.toBe(refusal);
    expect(EMAIL_SIGN_IN_MESSAGES[refusal as keyof typeof EMAIL_SIGN_IN_MESSAGES]).toMatch(/\.$/);
  });

  it('says the same for a wrong password and an unknown address, so it tells a stranger nothing', async () => {
    failWith('auth/wrong-password');
    const a = await signInWithEmail('a@oursabeel.com', 'x');
    failWith('auth/user-not-found');
    expect(await signInWithEmail('b@oursabeel.com', 'x')).toBe(a);
  });

  it('throws anything else, for the screen to report', async () => {
    failWith('auth/network-request-failed');
    await expect(signInWithEmail('a@oursabeel.com', 'x')).rejects.toThrow('auth/network-request-failed');
  });
});
