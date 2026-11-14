import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every failure a person reads goes through `toUserMessage` (or `errorText`),
 * the one place that knows which libraries' messages are sentences and which
 * are machine text. A screen that shows `e.message` itself skips that: when
 * firebase 13 began ending every callable's message with its HTTP status, the
 * People screen showed "… [403]" and "internal [0]", and none of those
 * failures reached Sentry either.
 */
const SRC = join(__dirname);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('error text', () => {
  it('reaches the screen only through toUserMessage', () => {
    const raw = sources(SRC).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${relative(SRC, path)}:${i + 1}` }))
        .filter(({ line }) => /set\w*Error\([^)]*\.message\b/.test(line))
        .map(({ at }) => at),
    );
    expect(raw).toEqual([]);
  });
});
