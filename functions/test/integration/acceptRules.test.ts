import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { PASSWORD_SIGN_IN_EMAIL, RULES_VERSION, hasAcceptedRules } from '@sabeel/shared';
import {
  adminAuth,
  adminDb,
  callFunction,
  idTokenFor,
  makeUser,
  passwordIdToken,
  shutdown,
} from './emulatorClient';

/**
 * Accepting the institute's rules, through the deployed callable.
 *
 * The promise: an active account that agrees is recorded as having agreed, at
 * the version it was shown, once, so the rules screen never comes back for it;
 * an account that may not use the app, or a screen showing out-of-date rules,
 * records nothing. That the CLIENT cannot write the record is
 * `rules.test.ts`; that the app shows the screen until it exists is
 * `scripts/web-e2e.mjs`.
 */

const ACTIVE = 'ar_active';
const PENDING = 'ar_pending';
const STALE = 'ar_stale';
const DOOR_PASSWORD = 'accept-rules-test-password-1';
let reviewerUid = '';

const userDoc = async (uid: string) => (await adminDb().doc(`users/${uid}`).get()).data() ?? {};

beforeAll(async () => {
  await makeUser({ uid: ACTIVE, email: 'ar_active@oursabeel.com', role: 'member', status: 'active' });
  await makeUser({ uid: PENDING, email: 'ar_pending@oursabeel.com' });
  await makeUser({ uid: STALE, email: 'ar_stale@oursabeel.com', role: 'member', status: 'active' });
  const existing = await adminAuth().getUserByEmail(PASSWORD_SIGN_IN_EMAIL).catch(() => null);
  if (existing) await adminAuth().deleteUser(existing.uid);
  reviewerUid = 'ar_reviewer';
  await makeUser({ uid: reviewerUid, email: PASSWORD_SIGN_IN_EMAIL, password: DOOR_PASSWORD, role: 'member', status: 'active' });
});

afterAll(async () => {
  await shutdown();
});

describe('acceptRules', () => {
  it('starts every account without acceptance, so the screen shows', async () => {
    expect(hasAcceptedRules(await userDoc(ACTIVE))).toBe(false);
  });

  it('refuses a signed-out caller', async () => {
    const r = await callFunction('acceptRules', { version: RULES_VERSION });
    expect(r.body.error?.status).toBe('UNAUTHENTICATED');
  });

  it('refuses a pending account and records nothing', async () => {
    const r = await callFunction('acceptRules', { version: RULES_VERSION }, await idTokenFor(PENDING));
    expect(r.body.error?.status).toBe('PERMISSION_DENIED');
    expect(await userDoc(PENDING)).not.toHaveProperty('rulesVersion');
    expect(await userDoc(PENDING)).not.toHaveProperty('rulesAcceptedAt');
  });

  it('refuses rules the screen did not show — none, an older or a newer version — and records nothing', async () => {
    const token = await idTokenFor(STALE);
    for (const data of [{}, { version: RULES_VERSION - 1 }, { version: RULES_VERSION + 1 }, { version: String(RULES_VERSION) }]) {
      const r = await callFunction('acceptRules', data, token);
      expect(r.body.error?.status).toBe('FAILED_PRECONDITION');
    }
    expect(hasAcceptedRules(await userDoc(STALE))).toBe(false);
  });

  it('records an active account as having accepted the current rules, in server time', async () => {
    const r = await callFunction('acceptRules', { version: RULES_VERSION }, await idTokenFor(ACTIVE));
    expect(r.body.error).toBeUndefined();
    const d = await userDoc(ACTIVE);
    expect(hasAcceptedRules(d)).toBe(true);
    expect(d.rulesVersion).toBe(RULES_VERSION);
    expect(d.rulesAcceptedAt).toBeInstanceOf(Timestamp);
  });

  it('keeps the first acceptance when it is sent again, from another device', async () => {
    const first = (await userDoc(ACTIVE)).rulesAcceptedAt as Timestamp;
    const r = await callFunction('acceptRules', { version: RULES_VERSION }, await idTokenFor(ACTIVE));
    expect(r.body.error).toBeUndefined();
    expect(((await userDoc(ACTIVE)).rulesAcceptedAt as Timestamp).isEqual(first)).toBe(true);
  });

  it('accepts for the review account signed in through the password door', async () => {
    const r = await callFunction(
      'acceptRules',
      { version: RULES_VERSION },
      await passwordIdToken(PASSWORD_SIGN_IN_EMAIL, DOOR_PASSWORD),
    );
    expect(r.body.error).toBeUndefined();
    expect(hasAcceptedRules(await userDoc(reviewerUid))).toBe(true);
  });
});
