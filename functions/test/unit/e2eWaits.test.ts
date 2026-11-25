import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A SIGNED-IN PAGE NEVER GOES IDLE.
 *
 * The app holds Firestore's listen channel open for as long as anyone is
 * signed in, so Playwright's `networkidle` never arrives on a reload: the wait
 * runs out its timeout and the suite fails at a step that has nothing wrong
 * with it. `web-e2e.mjs` learnt this and said so in a comment, which the next
 * suite (`board-colours-e2e.mjs`, 2026-11-25) never read and walked into. A
 * reload, and a load-state wait, are only ever made signed in, so neither may
 * wait for `networkidle`; a first `goto`, before sign-in, still may. A `goto`
 * made after sign-in would hang the same way, and is not caught here: nothing
 * in a script's text says whether its context is signed in yet.
 *
 * Paths resolve from the functions workspace, vitest's cwd here.
 */
const root = resolve('..', 'scripts');
const scripts = [root, join(root, 'tutorials')].flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => join(dir, f)),
);

describe('no browser script waits for a signed-in page to go idle', () => {
  it('finds the scripts', () => {
    expect(scripts.some((f) => f.endsWith('web-e2e.mjs'))).toBe(true);
  });

  it.each(scripts.map((f) => [f.slice(root.length + 1), f]))('%s', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/\.reload\(\s*\{[^}]*networkidle/);
    expect(text).not.toMatch(/waitForLoadState\(\s*['"]networkidle/);
  });
});
