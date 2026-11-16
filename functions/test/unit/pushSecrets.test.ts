import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every function that can send a notification is given Apple's key.
 *
 * A secret that is not bound to a function reads as empty inside it, so a
 * sender added without `PUSH_SECRETS` would deliver to Android phones and
 * browsers and refuse every iPhone — reported to Sentry, and silent to the
 * person who was meant to hear. Nothing else would show it: the emulator never
 * sends, and no other test reaches Apple.
 *
 * The senders are FOUND, not listed: every exported function whose body calls
 * `notify(`, the one way a push leaves `notifications.ts`, or calls a function
 * that does — a schedule's body lives in a `run…` function so a test can call
 * it, as `runDueSoonReminders` does. A list would have to be remembered by
 * whoever adds the next one, which is the failure this exists to catch.
 */

// Paths resolve from the functions workspace, vitest's cwd here — the same
// convention suite-coverage.test.ts uses.
const SRC = resolve('src');

const sources = () =>
  readdirSync(SRC)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(resolve(SRC, f), 'utf8').split('\n'));

/** Top-level function declarations whose body calls `notify(`: the helpers a sender may call. */
function helpers(): Set<string> {
  const found = new Set<string>();
  for (const lines of sources()) {
    let current: string | null = null;
    for (const line of lines) {
      const start = /^(?:export )?(?:async )?function (\w+)/.exec(line);
      if (start) current = start[1];
      else if (/^export const |^const \w+ = /.test(line)) current = null;
      if (current && /\bnotify\(/.test(line) && !line.startsWith(`export async function ${current}`))
        found.add(current);
    }
  }
  return found;
}

/**
 * The exported functions (deployed ones are `export const X = on…(`) that call
 * `notify(`, directly or through one of `helpers()`.
 */
function senders(): string[] {
  const via = [...helpers()];
  const calls = (line: string) =>
    /\bnotify\(/.test(line) || via.some((h) => new RegExp(`\\b${h}\\(`).test(line));
  const found = new Set<string>();
  for (const lines of sources()) {
    let current: string | null = null;
    for (const line of lines) {
      const start = /^export const (\w+) = /.exec(line);
      if (start) current = start[1];
      else if (/^(export )?(async )?function |^const \w+ = /.test(line)) current = null;
      if (current && calls(line)) found.add(current);
    }
  }
  return [...found].sort();
}

describe('push senders', () => {
  it('are found, so the scan cannot pass by finding nothing', () => {
    // The ones that send today. A new sender joins this list by being found;
    // one that stops sending leaves it. Either way this line is updated
    // knowingly, and the next test covers whatever is found.
    expect(senders()).toEqual(['dueSoonReminders', 'onCardNotify', 'onCommentNotify', 'onUserPending']);
  });

  it('are each bound to APNS_KEY', async () => {
    const fns = (await import('../../src/index')) as unknown as Record<
      string,
      { __endpoint?: { secretEnvironmentVariables?: { key: string }[] } }
    >;
    for (const name of senders()) {
      const keys = fns[name]?.__endpoint?.secretEnvironmentVariables?.map((s) => s.key) ?? [];
      expect({ name, keys }).toEqual({ name, keys: expect.arrayContaining(['APNS_KEY']) });
    }
  });
});
