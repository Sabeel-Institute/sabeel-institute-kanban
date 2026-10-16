import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every place this checkout states an emulator or dev-server port agrees.
 *
 * Three Sabeel repos share one machine, and every one of them used to pin the
 * same ports — so whichever suite started second SIGTERMed the other's
 * Firestore, and both sessions spent real time diagnosing symptoms that belonged
 * to the other process. Each checkout now owns a disjoint block.
 *
 * The ports cannot live in one file. Six consumers need six representations:
 *
 *   firebase.json               JSON   what the emulators actually bind
 *   app/src/env.ts              TS     inlined into the client bundle
 *   scripts/lib/ports.mjs       ESM    read by scripts/*.mjs
 *   scripts/dev.sh              shell  the kill list
 *   scripts/e2e.sh              shell  the web dev-server port
 *   package.json                JSON   the `dev:web` command line
 *
 * So the goal is not one copy, it is copies that cannot drift. A mismatch is
 * otherwise silent until something connects to a port nobody is serving — or,
 * far worse, to a port a SIBLING REPO is serving, which reads and writes
 * happily and passes.
 *
 * Same reasoning as `suite-coverage.test.ts` next door: a unit test that asserts
 * about repo files rather than about functions.
 */
// Paths resolve from the functions workspace, which is vitest's cwd here — the
// same convention `suite-coverage.test.ts` and the rules suites already use
// (`readFileSync('../firestore.rules')`). The meta-property form is unavailable:
// this workspace compiles as commonjs.
const REPO = resolve('..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');

/** `firebase.json` — what the emulator suite binds. */
function portsFromFirebaseJson(): Record<string, number> {
  const emulators = JSON.parse(read('firebase.json')).emulators as Record<
    string,
    { port?: number; websocketPort?: number }
  >;
  const out: Record<string, number> = {};
  for (const [service, cfg] of Object.entries(emulators)) {
    if (cfg && typeof cfg.port === 'number') out[service] = cfg.port;
    if (cfg && typeof cfg.websocketPort === 'number') {
      out.firestoreWebsocket = cfg.websocketPort;
    }
  }
  return out;
}

/**
 * The client's copy. Parsed rather than imported: `app/src/env.ts` imports
 * `react-native`, which will not load under the functions workspace's vitest.
 */
function portsFromClient(): Record<string, number> {
  const block = read('app/src/env.ts').match(/EMULATOR_PORTS\s*=\s*\{([^}]*)\}/)?.[1];
  if (!block) throw new Error('EMULATOR_PORTS not found in app/src/env.ts');
  return Object.fromEntries(
    [...block.matchAll(/(\w+)\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]),
  );
}

/** The scripts' copy. */
async function portsFromScripts(): Promise<{
  emulator: Record<string, number>;
  web: Record<string, number>;
  shared: Record<string, number>;
}> {
  const mod = await import(resolve(REPO, 'scripts/lib/ports.mjs'));
  return { emulator: mod.EMULATOR_PORTS, web: mod.WEB_PORTS, shared: SHARED_PORTS };
}

/**
 * Ports that are machine-wide by nature and CANNOT move into a per-repo block:
 * Metro (the Android emulator reaches the host directly at 10.0.2.2:8081, so
 * `adb reverse` cannot redirect it and the port cannot change without rebuilding
 * the native app) and idb.
 *
 * Other checkouts on the same machine hold them, so `dev.sh` must never free
 * them: they sit in its `SHARED_PORTS`, which `status` reads and nothing stops.
 * Stated here rather than exported from `scripts/lib/ports.mjs` because no
 * script imports them, and an export nothing imports is exactly what the
 * dead-code check exists to flag.
 */
const SHARED_PORTS: Record<string, number> = { metro: 8081, idb: 10882 };

/** A `NAME=(…)` list of numbers in `dev.sh`. */
function listFromDevSh(name: string): number[] {
  const line = read('scripts/dev.sh').match(new RegExp(`^${name}=\\(([^)]*)\\)`, 'm'))?.[1];
  if (!line) throw new Error(`${name}=(…) not found in scripts/dev.sh`);
  return line.trim().split(/\s+/).map(Number);
}

/** `dev.sh`'s own block: what `stop` verifies and `status` reports. */
const portsFromDevSh = () => listFromDevSh('PORTS');

/** `e2e.sh`'s web dev-server port, set in shell before Node ever sees it. */
function webPortFromE2eSh(): number {
  const m = read('scripts/e2e.sh').match(/^WEB_PORT=(\d+)/m);
  if (!m) throw new Error('WEB_PORT not found in scripts/e2e.sh');
  return Number(m[1]);
}

/**
 * `npm run dev:web`'s port — a SIXTH representation, and the one that got away.
 *
 * The port move updated the five files listed above and missed this, because
 * nothing here reads `package.json`. It served on the abandoned 8086 while
 * `dev.sh web` waited on 61210 and `seed-dev.mjs` fetched 61210, so the
 * documented web dev loop could not complete at all — three minutes of waiting
 * and a "web NEVER CAME UP", with a dev server left on a port `dev.sh stop`
 * does not sweep. Same failure as the `dev.sh` readiness waits below, one file
 * further out.
 */
function webPortFromDevWebScript(): number {
  const script = JSON.parse(read('package.json')).scripts['dev:web'] as string;
  const m = script.match(/--port (\d+)/);
  if (!m) throw new Error('--port not found in package.json scripts["dev:web"]');
  return Number(m[1]);
}

/**
 * This checkout's block. Bases are 100 apart, one per repo on this machine.
 *
 * 61200+ because the ephemeral range here is 32768-60999
 * (`/proc/sys/net/ipv4/ip_local_port_range`) so nothing above it is handed out
 * at random, and Firebase's own defaults top out at 9499
 * (`firebase-tools/lib/emulator/constants.js`) so the block collides with
 * nothing the CLI would choose for itself.
 *
 * Metro (8081) and idb (10882) are deliberately OUTSIDE it: the Android
 * emulator reaches the host directly at 10.0.2.2:8081, so that port cannot be
 * redirected or moved. They are machine-wide and shared by agreement, not by
 * allocation.
 */
const BLOCK_START = 61200;
const BLOCK_END = BLOCK_START + 99;

describe('emulator ports agree across every file that states them', () => {
  it('every allocated port is inside this checkout\u2019s block', async () => {
    const { emulator, web } = await portsFromScripts();
    const all = { ...emulator, ...web };
    expect(Object.keys(all).length).toBeGreaterThan(0);

    for (const [service, port] of Object.entries(all)) {
      expect(
        port >= BLOCK_START && port <= BLOCK_END,
        `${service}=${port} is outside ${BLOCK_START}-${BLOCK_END} — that is another checkout's territory`,
      ).toBe(true);
    }
  });

  it('no two services claim the same port', async () => {
    const { emulator, web, shared } = await portsFromScripts();
    expect(Object.keys(emulator).length).toBeGreaterThan(0);

    const all = [...Object.values(emulator), ...Object.values(web), ...Object.values(shared)];
    expect(new Set(all).size, 'two services claim the same port').toBe(all.length);
  });

  it('firebase.json matches scripts/lib/ports.mjs', async () => {
    const { emulator } = await portsFromScripts();
    const config = portsFromFirebaseJson();

    // Guard the guard: an empty parse would make every comparison below
    // trivially true, which is the failure mode this whole file exists to stop.
    expect(Object.keys(config).length).toBeGreaterThan(0);

    for (const [service, port] of Object.entries(config)) {
      expect(emulator[service], `firebase.json ${service}=${port}`).toBe(port);
    }
  });

  it('the client bundle uses the same ports as the scripts', async () => {
    const { emulator } = await portsFromScripts();
    const client = portsFromClient();
    expect(Object.keys(client).length).toBeGreaterThan(0);

    for (const [service, port] of Object.entries(client)) {
      expect(emulator[service], `app/src/env.ts ${service}=${port}`).toBe(port);
    }
  });

  it('dev.sh claims exactly this checkout’s ports, and nothing else', async () => {
    const { emulator, web, shared } = await portsFromScripts();
    const listed = portsFromDevSh();
    expect(listed.length).toBeGreaterThan(0);

    const owned = new Set([...Object.values(emulator), ...Object.values(web)]);

    // Every port we bind must be swept…
    for (const [service, port] of Object.entries({ ...emulator, ...web })) {
      expect(listed, `${service}=${port} is not in dev.sh's PORTS`).toContain(port);
    }
    // …and nothing else, or the sweep reaches into another checkout's block.
    // That is not hypothetical: on 2026-08-27 a port-based sweep killed a
    // sibling repo's running emulator.
    for (const port of listed) {
      expect(owned.has(port), `dev.sh sweeps ${port}, which this checkout does not own`).toBe(true);
    }
    // The machine-wide ports are listed apart, for `status` only. Freeing them
    // killed another checkout's Metro and every session's idb_companion.
    expect(listFromDevSh('SHARED_PORTS').sort()).toEqual(Object.values(shared).sort());
  });

  it('e2e.sh and the scripts agree on the web port', async () => {
    const { web } = await portsFromScripts();
    expect(webPortFromE2eSh(), 'e2e.sh WEB_PORT vs WEB_PORTS.e2e').toBe(web.e2e);
  });

  it('npm run dev:web serves the port dev.sh and the seed wait on', async () => {
    const { web } = await portsFromScripts();
    expect(webPortFromDevWebScript(), 'package.json dev:web --port vs WEB_PORTS.e2e').toBe(
      web.e2e,
    );
  });
});

/**
 * The ports module has to be COMMITTED, not merely present.
 *
 * `.gitignore` carried a bare `lib/`, which matches a directory of that name at
 * any depth — so `scripts/lib/` was silently ignored while sitting happily on
 * disk. Every check above passed locally and would have failed for anyone else,
 * because the file the suite imports was never in the repo. An ignored-but-
 * present file is indistinguishable from a committed one on the machine that
 * wrote it, which is why this is asserted rather than eyeballed.
 */
describe('the ports module is committed, not just present on disk', () => {
  it('git tracks scripts/lib/ports.mjs', () => {
    const tracked = execFileSync('git', ['ls-files', '--', 'scripts/lib/ports.mjs'], {
      cwd: REPO,
      encoding: 'utf8',
    }).trim();
    expect(tracked, 'scripts/lib/ports.mjs is not tracked — check .gitignore').toBe(
      'scripts/lib/ports.mjs',
    );
  });
});

/**
 * No script still points at a port this checkout gave up.
 *
 * The port move updated firebase.json, the client, ports.mjs and the sweep
 * lists — and MISSED `dev.sh`'s readiness waits, which are live code, plus the
 * copy-paste instructions at the top of eleven operator scripts. `dev.sh` is the
 * main developer entry point; it would have hung waiting on a Firestore that had
 * moved. Nothing caught it, because no suite runs `dev.sh` and a comment cannot
 * fail a test.
 *
 * Matching `host:port` and `--port N` rather than the bare number on purpose:
 * 4000 and 8000 also appear as millisecond timeouts, and a check that cries wolf
 * gets deleted. `--port` was added after `package.json` was found still serving
 * `dev:web` on 8086 — the abandoned port was there in plain sight, in the one
 * form this scan did not read, in the one file it did not open.
 */
const ABANDONED_PORTS = [8080, 9099, 5001, 9199, 9150, 4000, 4400, 4500, 8086, 8083];

function scriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(REPO, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(resolve(REPO, rel)).isDirectory()) out.push(...scriptFiles(rel));
    else if (/\.(mjs|sh|js|ts)$/.test(entry)) out.push(rel);
  }
  return out;
}

describe('no script points at a port this checkout gave up', () => {
  it('nothing in scripts/ or package.json points at an abandoned port', () => {
    const files = [...scriptFiles('scripts'), 'package.json'];
    expect(files.length, 'found no scripts to scan — the walk is broken').toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of files) {
      const text = read(file);
      for (const port of ABANDONED_PORTS) {
        const re = new RegExp(`((127\\.0\\.0\\.1|localhost):|--port )${port}\\b`);
        if (re.test(text)) offenders.push(`${file} -> :${port}`);
      }
    }
    expect(offenders, `stale port references:\n  ${offenders.join('\n  ')}`).toEqual([]);
  });
});
