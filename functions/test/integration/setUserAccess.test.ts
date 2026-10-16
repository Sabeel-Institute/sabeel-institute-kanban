import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import {
  adminAuth,
  adminDb,
  callFunction,
  idTokenFor,
  makeUser,
  passwordIdToken,
  shutdown,
} from './emulatorClient';
import { PASSWORD_SIGN_IN_EMAIL } from '@sabeel/shared';

/**
 * The real setUserAccess callable, invoked over HTTP with real ID tokens.
 *
 * The pure logic is covered exhaustively in @sabeel/shared's access tests; what
 * these prove is the wiring — that the callable reads the actor's role from the
 * TOKEN, applies the checks, and actually moves both the claims and the mirror.
 */

beforeEach(async () => {
  const { users } = await adminAuth().listUsers(1000);
  await Promise.all(users.map((u) => adminAuth().deleteUser(u.uid).catch(() => {})));
  const docs = await adminDb().collection('users').listDocuments();
  await Promise.all(docs.map((d) => d.delete()));

  await makeUser({
    uid: 'admin1',
    email: 'admin1@oursabeel.com',
    role: 'admin',
    status: 'active',
  });
  await makeUser({
    uid: 'manager1',
    email: 'manager1@oursabeel.com',
    role: 'organizer',
    status: 'active',
  });
  await makeUser({
    uid: 'member1',
    email: 'member1@oursabeel.com',
    role: 'member',
    status: 'active',
  });
  await makeUser({ uid: 'pending1', email: 'pending1@oursabeel.com' });
});

afterAll(async () => {
  await shutdown();
});

describe('authorisation', () => {
  it('rejects an unauthenticated call', async () => {
    const r = await callFunction('setUserAccess', {
      uid: 'pending1',
      role: 'member',
      status: 'active',
    });
    expect(r.body.error?.status).toBe('UNAUTHENTICATED');
  });

  it('rejects a member', async () => {
    const r = await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'member', status: 'active' },
      await idTokenFor('member1'),
    );
    expect(r.body.error?.status).toBe('PERMISSION_DENIED');
  });

  it('rejects an organizer — boards are theirs, accounts are not', async () => {
    const r = await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'member', status: 'active' },
      await idTokenFor('manager1'),
    );
    expect(r.body.error?.status).toBe('PERMISSION_DENIED');
  });

  it('rejects a member trying to make THEMSELVES an admin', async () => {
    // The escalation this design exists to stop.
    const r = await callFunction(
      'setUserAccess',
      { uid: 'member1', role: 'admin', status: 'active' },
      await idTokenFor('member1'),
    );
    expect(r.body.error?.status).toBe('PERMISSION_DENIED');

    const u = await adminAuth().getUser('member1');
    expect(u.customClaims?.role).toBe('member');
  });

  it('rejects an admin whose status is not active', async () => {
    await adminAuth().setCustomUserClaims('admin1', {
      role: 'admin',
      status: 'disabled',
    });
    const r = await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'member', status: 'active' },
      await idTokenFor('admin1'),
    );
    expect(r.body.error?.status).toBe('PERMISSION_DENIED');
  });

  it('rejects an admin changing their own access', async () => {
    const r = await callFunction(
      'setUserAccess',
      { uid: 'admin1', role: 'member', status: 'disabled' },
      await idTokenFor('admin1'),
    );
    expect(r.body.error?.status).toBe('PERMISSION_DENIED');
  });
});

describe('input validation', () => {
  it('rejects an unknown role', async () => {
    const r = await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'superadmin', status: 'active' },
      await idTokenFor('admin1'),
    );
    expect(r.body.error?.status).toBe('INVALID_ARGUMENT');
  });

  it('rejects an unknown status', async () => {
    const r = await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'member', status: 'approved' },
      await idTokenFor('admin1'),
    );
    expect(r.body.error?.status).toBe('INVALID_ARGUMENT');
  });

  it('rejects a missing uid', async () => {
    const r = await callFunction(
      'setUserAccess',
      { role: 'member', status: 'active' },
      await idTokenFor('admin1'),
    );
    expect(r.body.error?.status).toBe('INVALID_ARGUMENT');
  });

  it('rejects an unknown target', async () => {
    const r = await callFunction(
      'setUserAccess',
      { uid: 'ghost', role: 'member', status: 'active' },
      await idTokenFor('admin1'),
    );
    expect(r.body.error?.status).toBe('NOT_FOUND');
  });
});

describe('a valid admin change', () => {
  it('approves a pending user in both the claims and the mirror', async () => {
    const r = await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'member', status: 'active' },
      await idTokenFor('admin1'),
    );
    expect(r.body.error).toBeUndefined();

    const u = await adminAuth().getUser('pending1');
    expect(u.customClaims).toMatchObject({ role: 'member', status: 'active' });

    const snap = await adminDb().doc('users/pending1').get();
    expect(snap.data()).toMatchObject({ role: 'member', status: 'active' });
  });

  it('stamps claimsUpdatedAt so clients know to refresh their token', async () => {
    // Without this the approved user sits on a stale `pending` token until it
    // expires — which reads as "the admin approved me and nothing happened".
    const before = (await adminDb().doc('users/pending1').get()).data()
      ?.claimsUpdatedAt;

    await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'member', status: 'active' },
      await idTokenFor('admin1'),
    );

    const after = (await adminDb().doc('users/pending1').get()).data()
      ?.claimsUpdatedAt;
    expect(after).toBeDefined();
    expect(after?.toMillis?.()).toBeGreaterThan(before?.toMillis?.() ?? 0);
  });

  it('records who made the change', async () => {
    await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'organizer', status: 'active' },
      await idTokenFor('admin1'),
    );
    const snap = await adminDb().doc('users/pending1').get();
    expect(snap.data()?.accessChangedBy).toBe('admin1');
  });

  it('promotes to organizer and to admin', async () => {
    for (const role of ['organizer', 'admin']) {
      const r = await callFunction(
        'setUserAccess',
        { uid: 'member1', role, status: 'active' },
        await idTokenFor('admin1'),
      );
      expect(r.body.error).toBeUndefined();
      const u = await adminAuth().getUser('member1');
      expect(u.customClaims?.role).toBe(role);
    }
  });


  // A user who has never had tokens revoked has NO tokensValidAfterTime at all,
  // so "before" is undefined rather than an earlier time — treat it as epoch 0.
  const revokedAtMs = async (uid: string): Promise<number> => {
    const t = (await adminAuth().getUser(uid)).tokensValidAfterTime;
    return t ? new Date(t).getTime() : 0;
  };

  it('revokes refresh tokens when disabling, so access ends immediately', async () => {
    // Without revocation a disabled user keeps working until their token
    // expires — up to an hour of access after being locked out.
    const before = await revokedAtMs('member1');
    await new Promise((r) => setTimeout(r, 1100)); // second-resolution timestamp

    const r = await callFunction(
      'setUserAccess',
      { uid: 'member1', role: 'member', status: 'disabled' },
      await idTokenFor('admin1'),
    );
    expect(r.body.error).toBeUndefined();

    expect(await revokedAtMs('member1')).toBeGreaterThan(before);
  });

  it('revokes refresh tokens when rejecting too', async () => {
    const before = await revokedAtMs('pending1');
    await new Promise((r) => setTimeout(r, 1100));

    const r = await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'member', status: 'rejected' },
      await idTokenFor('admin1'),
    );
    expect(r.body.error).toBeUndefined();

    expect(await revokedAtMs('pending1')).toBeGreaterThan(before);
  });

  it('does NOT revoke tokens on a plain approval', async () => {
    // Approving someone must not knock them out of the session they are sitting
    // in — the client refreshes its token via claimsUpdatedAt instead.
    const before = await revokedAtMs('pending1');
    await new Promise((r) => setTimeout(r, 1100));

    await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'member', status: 'active' },
      await idTokenFor('admin1'),
    );

    expect(await revokedAtMs('pending1')).toBe(before);
  });
});

/**
 * THE EMAIL DOOR IS A MEMBER'S DOOR (Faisal, 2026-10-15: "sign in thru email
 * should never be able to be an admin or manager. Just a member."). Two locks:
 * a password SESSION acts as a member whatever its claims say, and a
 * password-only ACCOUNT can be given no other role.
 */
describe('an email-and-password account', () => {
  const PASSWORD = 'correct-horse-battery-staple';

  it('acts as a member when it signs in with its password, whatever its claims say', async () => {
    // The one address the password door admits, so only the member lock is tested.
    await makeUser({ uid: 'pwadmin', email: PASSWORD_SIGN_IN_EMAIL, password: PASSWORD, role: 'admin', status: 'active' });
    const asPassword = await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'member', status: 'active' },
      await passwordIdToken(PASSWORD_SIGN_IN_EMAIL, PASSWORD),
    );
    expect(asPassword.body.error?.status).toBe('PERMISSION_DENIED');
    expect(asPassword.body.error?.message).toBe('Only an admin can change who has access.');

    // The control: the same account, the same claims, any other kind of session.
    const asOther = await callFunction(
      'setUserAccess',
      { uid: 'pending1', role: 'member', status: 'active' },
      await idTokenFor('pwadmin'),
    );
    expect(asOther.body.error).toBeUndefined();
  });

  it('cannot be given any role but member, and can be approved as one', async () => {
    await makeUser({ uid: 'pwonly', email: 'pwonly@oursabeel.com', password: PASSWORD });
    const admin = await idTokenFor('admin1');
    for (const role of ['organizer', 'admin']) {
      const r = await callFunction('setUserAccess', { uid: 'pwonly', role, status: 'active' }, admin);
      expect(r.body.error?.status).toBe('PERMISSION_DENIED');
      expect(r.body.error?.message).toBe('An account that signs in with an email and password can only be a member.');
    }
    expect((await adminAuth().getUser('pwonly')).customClaims).toMatchObject({ role: 'member', status: 'pending' });

    const approved = await callFunction('setUserAccess', { uid: 'pwonly', role: 'member', status: 'active' }, admin);
    expect(approved.body.error).toBeUndefined();
    expect((await adminAuth().getUser('pwonly')).customClaims).toMatchObject({ role: 'member', status: 'active' });
  });

  it('an account without a password may still be promoted: the lock is on password-ONLY accounts', async () => {
    // Its password sessions would still act as a member (the test above).
    const r = await callFunction('setUserAccess', { uid: 'member1', role: 'organizer', status: 'active' }, await idTokenFor('admin1'));
    expect(r.body.error).toBeUndefined();
  });
});
