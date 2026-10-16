import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PASSWORD_SIGN_IN_EMAIL } from '@sabeel/shared';
import { refusedSignIn, refusedSignUp } from '../../src/provision';

/**
 * THE PASSWORD DOOR (Faisal, 2026-10-15): "should only accept that one email",
 * and that one "Just a member". The address is one shared constant, which
 * firestore.rules and storage.rules must restate because rules cannot import;
 * this is what keeps the three the same address.
 *
 * Paths resolve from the functions workspace, vitest's cwd here.
 */

const literalIn = (file: string) => {
  const rules = readFileSync(resolve('..', file), 'utf8');
  return [...rules.matchAll(/request\.auth\.token\.get\('email', ''\) == '([^']+)'/g)].map((m) => m[1]);
};

describe('the one address', () => {
  it('is a real address, not an undefined import', () => {
    expect(PASSWORD_SIGN_IN_EMAIL).toMatch(/^[^@\s]+@oursabeel\.com$/);
  });

  it.each(['firestore.rules', 'storage.rules'])('is the address %s admits a password session for, and the only one', (file) => {
    expect(literalIn(file)).toEqual([PASSWORD_SIGN_IN_EMAIL]);
  });
});

describe('refusedSignIn — every sign-in (signUpGate.ts beforeSignIn)', () => {
  it('lets a password sign-in through for the one address', () => {
    expect(refusedSignIn('password', PASSWORD_SIGN_IN_EMAIL)).toBeNull();
  });

  it('refuses a password sign-in for any other address', () => {
    for (const email of ['someone@oursabeel.com', 'APP-REVIEW@oursabeel.com', '', null, undefined]) {
      expect(refusedSignIn('password', email)).toBe('other-address');
    }
  });

  it('leaves a Google sign-in to the domain gate and approval', () => {
    expect(refusedSignIn('google.com', 'someone@oursabeel.com')).toBeNull();
  });
});

describe('refusedSignUp — every sign-up made from a client (signUpGate.ts beforeSignUp)', () => {
  it('refuses a password sign-up, the one address included: accounts are made by an admin', () => {
    expect(refusedSignUp('password', PASSWORD_SIGN_IN_EMAIL, true)).toBe('self-signup');
    expect(refusedSignUp('password', 'someone@oursabeel.com', true)).toBe('self-signup');
  });

  it('refuses any provider but Google', () => {
    expect(refusedSignUp('apple.com', 'someone@oursabeel.com', true)).toBe('unsupported-provider');
    expect(refusedSignUp(null, 'someone@oursabeel.com', true)).toBe('unsupported-provider');
  });

  it('refuses Google off the domain or unverified, and lets a colleague in', () => {
    expect(refusedSignUp('google.com', 'someone@gmail.com', true)).toBe('bad-domain');
    expect(refusedSignUp('google.com', 'someone@oursabeel.com', false)).toBe('bad-domain');
    expect(refusedSignUp('google.com', 'someone@oursabeel.com', true)).toBeNull();
  });
});
