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
 * The senders are FOUND, not listed: every exported function that reaches
 * `send(`, the one way a push leaves (`messaging.ts`), through any number of
 * helpers. Followed through one helper only, the scan missed `noticeSweep`
 * (`runNoticeSweep` → `deliver` → `notify` → `send`), and removing its
 * secrets failed no test. A list would have to be remembered by whoever adds
 * the next one, which is the failure this exists to catch.
 */

// Paths resolve from the functions workspace, vitest's cwd here — the same
// convention suite-coverage.test.ts uses.
const SRC = resolve('src');

type Fn = { calls: Set<string>; deployed: boolean; importsSend: boolean };

/**
 * Each top-level function in src, by name: what it calls, whether it is a
 * deployed export, and whether its file imports `send` from messaging (other
 * files have their own `send`, such as the report's mail sender).
 */
function functions(): Map<string, Fn> {
  const out = new Map<string, Fn>();
  for (const file of readdirSync(SRC).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(resolve(SRC, file), 'utf8');
    const importsSend = /import \{[^}]*\bsend\b[^}]*\} from '\.\/messaging'/.test(text);
    let current: string | null = null;
    for (const line of text.split('\n')) {
      const fn = /^(?:export )?(?:async )?function (\w+)/.exec(line);
      const deployed = /^export const (\w+) = /.exec(line);
      const constFn = /^(?:export )?const (\w+) = (?:async )?\(/.exec(line);
      const name = fn?.[1] ?? deployed?.[1] ?? constFn?.[1];
      if (name) {
        current = name;
        out.set(name, { calls: new Set(), deployed: Boolean(deployed), importsSend });
      } else if (/^(?:export )?(?:const|let|interface|type|class) /.test(line)) {
        current = null;
      }
      const code = line.trim();
      if (!current || code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) continue;
      for (const m of line.matchAll(/\b(\w+)\(/g)) out.get(current)!.calls.add(m[1]);
    }
  }
  return out;
}

/** The deployed exports that reach `send(`, through any depth of helpers. */
function senders(): string[] {
  const fns = functions();
  const reaches = new Set<string>(
    [...fns].filter(([, f]) => f.importsSend && f.calls.has('send')).map(([name]) => name),
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, { calls }] of fns) {
      if (!reaches.has(name) && [...calls].some((c) => reaches.has(c))) {
        reaches.add(name);
        grew = true;
      }
    }
  }
  return [...fns].filter(([name, f]) => f.deployed && reaches.has(name)).map(([name]) => name).sort();
}

describe('push senders', () => {
  it('are found, so the scan cannot pass by finding nothing', () => {
    // The ones that send today. A new sender joins this list by being found;
    // one that stops sending leaves it. Either way this line is updated
    // knowingly, and the next test covers whatever is found.
    expect(senders()).toEqual(['dueSoonReminders', 'noticeSweep', 'onCardNotify', 'onCommentNotify', 'onUserPending']);
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
