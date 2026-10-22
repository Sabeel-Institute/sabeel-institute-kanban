import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * functions/package-lock.json is what Cloud Build installs from.
 *
 * A deploy uploads the functions directory alone, and without a lockfile in it
 * the Node buildpack generates one with `npm install --package-lock-only`. Its
 * npm crashes doing that here — "Cannot read properties of null (reading
 * 'edgesOut')", in arborist's peer resolution of vitest's optional peers — so
 * every function with no cached build layer failed to deploy (2026-10-15).
 * With the lockfile the buildpack runs `npm ci`, which resolves nothing.
 *
 * `npm ci` refuses a lockfile whose root block disagrees with package.json,
 * and that refusal would arrive at deploy time, after everything else passed:
 * `npx sabeel-ci check-app` (in CI) holds the root block to the manifest, and
 * this holds the lockfile to resolving what it declares. Regenerating the
 * lockfile: docs/DEPLOY.md.
 *
 * Paths resolve from the functions workspace, vitest's cwd here.
 */
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'));

describe('the functions lockfile', () => {
  it('resolves every runtime dependency', () => {
    for (const name of Object.keys(pkg.dependencies)) {
      expect({ name, version: lock.packages[`node_modules/${name}`]?.version }).toEqual({
        name,
        version: expect.stringMatching(/^\d+\.\d+\.\d+/),
      });
    }
  });
});
