import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE DEV SCRIPTS STOP ONLY WHAT THEY STARTED.
 *
 * `e2e.sh` left its web server running after every run, because its last line
 * `exec`ed firebase and took the EXIT trap with it. It now records what it
 * starts, by pid, and signals only that, through `scripts/lib/procs.sh`.
 *
 * No suite runs the script end to end (it checks its own cleanup on every CI
 * run), so this holds the shape that makes the behaviour possible.
 *
 * Paths resolve from the functions workspace, vitest's cwd here.
 */

const read = (file: string) => readFileSync(resolve('..', file), 'utf8');
/** The script without its comments, which explain the rules by naming them. */
const code = (file: string) =>
  read(file)
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

const SCRIPTS = ['scripts/e2e.sh', 'scripts/lib/procs.sh'];

describe('no script stops a process by name', () => {
  it.each(SCRIPTS)('%s matches no process by pattern', (file) => {
    expect(code(file)).not.toMatch(/\b(pkill|killall)\b|\bpgrep\s+(-\w*\s+)*-\w*f/);
  });

  it.each(['scripts/e2e.sh'])('%s signals only through procs.sh', (file) => {
    // Every kill goes through `terminate`, which is given recorded pids.
    expect(code(file)).not.toMatch(/(^|[;&|\s])kill\s/m);
    expect(code(file)).toMatch(/^\. .*lib\/procs\.sh"?$/m);
  });
});

describe('e2e.sh leaves nothing running', () => {
  const e2e = code('scripts/e2e.sh');

  it('runs firebase as a child, so its EXIT trap survives', () => {
    expect(e2e).not.toMatch(/\bexec\s+firebase\b/);
    expect(e2e).toMatch(/trap cleanup EXIT/);
  });

  it('stops the server it started, and the whole tree under it', () => {
    expect(e2e).toMatch(/exec npx expo start --web/);
    expect(e2e).toMatch(/WEB_PID=\$!/);
    expect(e2e).toMatch(/pid_tree "\$WEB_PID"/);
  });
});
