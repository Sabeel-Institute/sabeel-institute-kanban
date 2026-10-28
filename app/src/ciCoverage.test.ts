import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every end-to-end suite on disk is actually RUN by CI.
 *
 * The sibling of `functions/test/unit/suite-coverage.test.ts`, and it exists for
 * the same reason that one does: a suite that is never invoked is not coverage,
 * it is a file. `scripts/stats-e2e.mjs` — 271 checks across nine viewport widths
 * — sat green on a laptop and absent from CI for a full release, and nothing
 * anywhere would have said so. The totals do not move, because they were never
 * counted.
 *
 * CI runs its browser suites by name, one runner each: the npm scripts in
 * `ci-tools.json`'s `ci.browserSuites`, which `sabeel-ci workflows` renders
 * into the browser job's matrix (`sabeel-ci check-app` fails a stale render).
 * The emulator job runs `npm run test:emulator`, whose rules pass starts with
 * the migration rehearsal. The list cannot be globbed and has to be kept in
 * step by hand. This is what keeps it honest.
 *
 * Lives in `app/` because that workspace is the one with a test runner wired to
 * plain `.ts`; it asserts about repo files, not about the app.
 */

// Anchored to THIS FILE, not to the working directory. cwd is the app
// workspace under `npm test` and the repo root under `vitest --root app`, and a
// relative path silently resolves to a different place in each.
const repo = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(repo, path), 'utf8');

/** What CI runs, as the commands the npm scripts amount to. */
function ciCommands(): string {
  const scripts: Record<string, string> = JSON.parse(read('package.json')).scripts;
  const functions: Record<string, string> = JSON.parse(read('functions/package.json')).scripts;
  const suites: string[] = JSON.parse(read('ci-tools.json')).ci.browserSuites;
  return [
    ...suites.map((suite) => scripts[suite] ?? ''),
    functions['test:emulator:rules'],
    functions['test:emulator:functions'],
  ].join('\n');
}

const onDisk = () => readdirSync(resolve(repo, 'scripts')).filter((f) => f.endsWith('-e2e.mjs'));

describe('CI e2e coverage', () => {
  it('names an npm script for every browser suite', () => {
    const scripts: Record<string, string> = JSON.parse(read('package.json')).scripts;
    const suites: string[] = JSON.parse(read('ci-tools.json')).ci.browserSuites;
    expect(suites.filter((suite) => !scripts[suite])).toEqual([]);
  });

  it('runs every scripts/*-e2e.mjs suite', () => {
    // Guard the guard: if the glob ever matches nothing, "all of them are in CI"
    // is trivially true and this test would pass while proving nothing.
    expect(onDisk().length).toBeGreaterThan(0);

    const ci = ciCommands();
    const missing = onDisk()
      .filter((f) => !LOCAL_ONLY.has(f))
      .filter((f) => !ci.includes(`scripts/${f}`));
    expect(missing, `e2e suites on disk but not run by CI: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  /**
   * The exemption is itself checked, because an allowlist nobody verifies is how
   * "temporarily local-only" becomes permanent. If one of these ever DOES get a
   * CI step, this fails and the entry must be deleted — the list cannot quietly
   * outlive its reason.
   */
  it('keeps the local-only list honest', () => {
    const ci = ciCommands();
    const present = new Set(onDisk());
    for (const f of LOCAL_ONLY) {
      expect(present.has(f), `${f} is listed local-only but no longer exists`).toBe(true);
      expect(
        ci.includes(`scripts/${f}`),
        `${f} is now run by CI — delete it from LOCAL_ONLY`,
      ).toBe(false);
    }
  });
});

/**
 * Suites that CANNOT run in CI, with the reason. Everything else must have a CI
 * step; see the test above.
 *
 * `screens-ios-e2e.mjs` drives a booted iOS SIMULATOR through Maestro. That
 * needs macOS with Xcode, a simulator runtime, a debug build installed on it and
 * Metro serving — none of which exist on the Linux runner this project's CI
 * uses, and adding a macOS runner to boot a simulator and build the app for
 * every push is a cost this repo has not chosen to pay. It is run by hand on a
 * Mac with Xcode: `bash scripts/dev.sh ios && node scripts/screens-ios-e2e.mjs`.
 *
 * This is a deliberate hole, declared rather than hidden. The alternative was
 * naming the file something the glob misses, which would have been the same hole
 * with nothing to read.
 */
const LOCAL_ONLY = new Set(['screens-ios-e2e.mjs']);
