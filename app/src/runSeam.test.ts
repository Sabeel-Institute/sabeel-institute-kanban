import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `useAction`'s `run` resolves on failure too, having shown the error. A
 * statement after a bare `await run(...)` therefore runs whether or not the
 * write landed: that is how a refused lane or column name was cleared from its
 * field as if it had been added. What should follow only a success goes inside
 * the callback after the write, or uses the boolean `run` returns
 * (`if (await run(...))`, `return run(...)`).
 */
const ROOT = decodeURIComponent(new URL('.', import.meta.url).pathname);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * Each `run(...)` used as a statement (awaited, fired with `void`, or called
 * on an object such as `cloneAction.run(`), and the statement after it.
 */
export function actsAfterRun(source: string): { line: number; next: string }[] {
  const found: { line: number; next: string }[] = [];
  const re = /(^|[;{}\n]\s*)(?:await\s+|void\s+)?(?:\w+\.)?run\(/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let i = m.index + m[0].length;
    // `run()` with nothing to run is some other function: `useAction`'s takes
    // the work.
    if (source[i] === ')') continue;
    for (let depth = 1; depth > 0 && i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
    }
    const next = source.slice(i).replace(/^[\s;]*/, '').split('\n')[0].trim();
    // A chained `.finally(...)` runs either way, which is what it is for.
    if (next && !/^[})]/.test(next) && !next.startsWith('.')) {
      found.push({ line: source.slice(0, m.index).split('\n').length + 1, next });
    }
  }
  return found;
}

describe('acting after run', () => {
  it('finds a statement after a bare await run, and lets the boolean through', () => {
    expect(actsAfterRun('async () => {\n  await run(() => save(x));\n  setName("");\n}')).toHaveLength(1);
    expect(actsAfterRun('async () => {\n  await run(() => save(x));\n}')).toEqual([]);
    expect(actsAfterRun('async () => {\n  if (await run(() => save(x))) setName("");\n}')).toEqual([]);
    expect(actsAfterRun('async () => {\n  return run(() => save(x));\n}')).toEqual([]);
    expect(actsAfterRun('async () => {\n  await cloneAction.run(() => save(x));\n  close();\n}')).toHaveLength(1);
    expect(actsAfterRun('() => {\n  void run(() => save(x));\n  close();\n}')).toHaveLength(1);
  });

  it('happens nowhere in the app', () => {
    const offenders = sources(ROOT).flatMap((file) =>
      actsAfterRun(readFileSync(file, 'utf8')).map((f) => `${relative(ROOT, file)}:${f.line}: ${f.next}`),
    );
    expect(offenders).toEqual([]);
  });
});
