import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PASSWORD_SIGN_IN_EMAIL } from '@sabeel/shared';
import { actorOf } from '../../src/actor';

/**
 * Every role-checking callable sees the caller through `actorOf`, so the
 * password door's two locks hold for all of them at once: a password session
 * for any address but the one has no access, and the one is a member whatever
 * its claims say. The rules apply the same (`isSignedIn`, `role()`).
 *
 * The scan is what makes "every" true: a callable that read the claims itself
 * would skip both locks, and nothing else would notice.
 *
 * Paths resolve from the functions workspace, vitest's cwd here.
 */

const token = (over: Record<string, unknown>) =>
  ({ uid: 'u1', token: { role: 'admin', status: 'active', ...over } }) as unknown as Parameters<typeof actorOf>[0];

describe('actorOf', () => {
  it('takes the claims of a Google session', () => {
    expect(actorOf(token({ email: 'a@oursabeel.com', firebase: { sign_in_provider: 'google.com' } }))).toEqual({
      uid: 'u1',
      role: 'admin',
      status: 'active',
    });
  });

  it('holds the one password address to a member', () => {
    expect(actorOf(token({ email: PASSWORD_SIGN_IN_EMAIL, firebase: { sign_in_provider: 'password' } }))).toEqual({
      uid: 'u1',
      role: 'member',
      status: 'active',
    });
  });

  it('gives a password session for any other address nothing', () => {
    expect(actorOf(token({ email: 'a@oursabeel.com', firebase: { sign_in_provider: 'password' } }))).toMatchObject({
      status: 'disabled',
    });
  });
});

describe('no callable reads the claims itself', () => {
  const SRC = resolve('src');
  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

  it('reads auth.token in actor.ts and nowhere else', () => {
    const readers = files.filter((f) => f !== 'actor.ts' && /\bauth\.token\b/.test(readFileSync(resolve(SRC, f), 'utf8')));
    expect(readers).toEqual([]);
  });

  it('is actually used — the scan cannot pass by finding no callables', () => {
    const uses = files
      .filter((f) => f !== 'actor.ts')
      .reduce((n, f) => n + (readFileSync(resolve(SRC, f), 'utf8').match(/\bactorOf\(auth\)/g) ?? []).length, 0);
    expect(uses).toBeGreaterThanOrEqual(8);
  });
});
