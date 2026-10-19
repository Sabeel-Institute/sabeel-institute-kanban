import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kanban-publisher-'));
  fixtures.push(root);
  const put = (path: string, content: string, mode = 0o644) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, { mode });
  };
  put('scripts/publish-apk.sh', '');
  copyFileSync(resolve(import.meta.dirname, '../../../scripts/publish-apk.sh'), join(root, 'scripts/publish-apk.sh'));
  put('bin/node', '#!/usr/bin/env bash\nif [ "$1" = -p ]; then echo 1.2.3; elif [[ "$1" = *deploy-notes.mjs ]]; then echo "Release notes"; fi\n', 0o755);
  put('bin/gh', '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$GH_TEST_LOG"\nif [ "$2" = view ]; then exit 1; fi\n', 0o755);
  put('sdk/build-tools/test/apksigner', '#!/usr/bin/env bash\necho "Signer #1 certificate DN: ${TEST_SIGNER:-CN=Sabeel Institute}"\n', 0o755);
  put('docs/USER-MANUAL.md', 'Manual');
  put('docs/USER-MANUAL.pdf', 'Rendered manual');
  for (const abi of ['arm64-v8a', 'armeabi-v7a', 'universal', 'x86_64']) {
    put(`app/android/app/build/outputs/apk/release/app-${abi}-release.apk`, 'APK fixture');
  }
  const log = join(root, 'github-commands.log');
  const run = (args: string[] = [], signer?: string) => execFileSync('bash', [join(root, 'scripts/publish-apk.sh'), ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, ANDROID_HOME: join(root, 'sdk'), GH_TEST_LOG: log, ...(signer ? { TEST_SIGNER: signer } : {}) },
  });
  return { root, log, run };
}

describe('APK publishing', () => {
  it('checks without invoking GitHub', () => {
    const test = fixture();
    expect(test.run(['--check'])).toContain('nothing published');
    expect(existsSync(test.log)).toBe(false);
  });

  it('publishes versioned APKs and the manual only to the Institute app repository', () => {
    const test = fixture();
    test.run();
    const commands = readFileSync(test.log, 'utf8').trim().split('\n');
    expect(commands.every((command) => command.includes('--repo Sabeel-Institute/sabeel-institute-kanban'))).toBe(true);
    expect(commands.join('\n')).toContain('release create v1.2.3');
    expect(commands.join('\n')).toContain('docs/USER-MANUAL.pdf');
    expect(commands.join('\n')).not.toMatch(/github\.io|kanban-latest/);
  });

  it('refuses a debug signature before contacting GitHub', () => {
    const test = fixture();
    expect(() => test.run([], 'CN=Android Debug')).toThrow();
    expect(existsSync(test.log)).toBe(false);
  });

  it('checks that every ABI is present before contacting GitHub', () => {
    const test = fixture();
    rmSync(join(test.root, 'app/android/app/build/outputs/apk/release/app-x86_64-release.apk'));
    expect(() => test.run(['--check'])).toThrow();
    expect(existsSync(test.log)).toBe(false);
  });
});
