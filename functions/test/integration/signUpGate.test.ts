import { describe, it, expect, afterAll } from 'vitest';
import { ALLOWED_EMAIL_DOMAIN, PASSWORD_SIGN_IN_EMAIL, SIGN_IN_REFUSED, SIGN_UP_REFUSED } from '@sabeel/shared';
import { adminAuth, shutdown } from './emulatorClient';

/*
 * THE DOOR HOLDS BEFORE ANY ACCOUNT EXISTS (functions/src/signUpGate.ts).
 * Driven the way an outsider would: the public Auth REST API with the site's
 * key, against the Auth emulator, which calls the blocking function the
 * Functions emulator runs. The promise is in what is left behind, not in an
 * error code: a refused sign-up leaves no account at all, and a colleague's
 * first Google sign-in still makes one.
 */

const AUTH = () => `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

async function rest(method: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${AUTH()}/${method}?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { error?: { message?: string } };
  return { ok: res.ok, message: json.error?.message ?? '' };
}

const PASSWORD = 'correct-horse-battery-staple';

const passwordSignUp = (email: string) =>
  rest('accounts:signUp', { email, password: PASSWORD, returnSecureToken: true });

/** A first Google sign-in as the emulator takes one: an unsigned ID token. */
const googleSignIn = (email: string, verified: boolean) =>
  rest('accounts:signInWithIdp', {
    requestUri: 'http://localhost',
    postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `g-${email}`, email, email_verified: verified }))}&providerId=google.com`,
    returnSecureToken: true,
    returnIdpCredential: true,
  });

const accountFor = (email: string) =>
  adminAuth()
    .getUserByEmail(email)
    .then(
      (u) => u.uid,
      () => null,
    );

afterAll(async () => {
  await shutdown();
});

describe('the sign-up gate', () => {
  it('refuses a password sign-up, even on the org domain, and no account is made', async () => {
    for (const email of [`stranger-${Date.now()}@example.com`, `someone-${Date.now()}@${ALLOWED_EMAIL_DOMAIN}`]) {
      const res = await passwordSignUp(email);
      expect({ email, ok: res.ok }).toEqual({ email, ok: false });
      expect(res.message).toContain(SIGN_UP_REFUSED);
      expect(await accountFor(email)).toBeNull();
    }
  });

  it('refuses a Google account whose address is not verified, and no account is made', async () => {
    const email = `unverified-${Date.now()}@${ALLOWED_EMAIL_DOMAIN}`;
    const res = await googleSignIn(email, false);
    expect(res.ok).toBe(false);
    expect(res.message).toContain(SIGN_UP_REFUSED);
    expect(await accountFor(email)).toBeNull();
  });

  it('refuses a Google account off the org domain, and no account is made', async () => {
    const email = `outsider-${Date.now()}@gmail.com`;
    const res = await googleSignIn(email, true);
    expect(res.ok).toBe(false);
    expect(res.message).toContain(SIGN_UP_REFUSED);
    expect(await accountFor(email)).toBeNull();
  });

  it('lets a colleague’s first Google sign-in make their account', async () => {
    const email = `colleague-${Date.now()}@${ALLOWED_EMAIL_DOMAIN}`;
    const res = await googleSignIn(email, true);
    expect(res).toMatchObject({ ok: true, message: '' });
    expect(await accountFor(email)).not.toBeNull();
  });

  it('does not stand in the way of an admin making an email account (the Admin SDK runs no blocking function)', async () => {
    const email = `admin-made-${Date.now()}@${ALLOWED_EMAIL_DOMAIN}`;
    await adminAuth().createUser({ email, password: PASSWORD, emailVerified: true });
    expect(await accountFor(email)).not.toBeNull();
  });
});

/*
 * THE SIGN-IN GATE (signUpGate.ts beforeSignIn): a password sign-in for the
 * one address only (Faisal, 2026-10-15: "should only accept that one email").
 */
describe('the sign-in gate', () => {
  const passwordSignIn = (email: string) => rest('accounts:signInWithPassword', { email, password: PASSWORD, returnSecureToken: true });

  it('refuses a password sign-in for an admin-made account at any other address', async () => {
    const email = `admin-made-other-${Date.now()}@${ALLOWED_EMAIL_DOMAIN}`;
    await adminAuth().createUser({ email, password: PASSWORD, emailVerified: true });
    const res = await passwordSignIn(email);
    expect(res.ok).toBe(false);
    expect(res.message).toContain(SIGN_IN_REFUSED);
  });

  it('lets the one address sign in with its password', async () => {
    await adminAuth()
      .getUserByEmail(PASSWORD_SIGN_IN_EMAIL)
      .then((u) => adminAuth().deleteUser(u.uid))
      .catch(() => undefined);
    await adminAuth().createUser({ email: PASSWORD_SIGN_IN_EMAIL, password: PASSWORD, emailVerified: true });
    expect(await passwordSignIn(PASSWORD_SIGN_IN_EMAIL)).toMatchObject({ ok: true, message: '' });
  });
});
