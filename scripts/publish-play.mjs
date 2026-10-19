/**
 * Upload the release AAB to the Play internal testing track, without a browser.
 *
 *   node scripts/publish-play.mjs --check      # every gate + the Play permission
 *   node scripts/publish-play.mjs --internal   # publish; the testers get it
 *   node scripts/publish-play.mjs --help
 *
 * The destination must be NAMED. Publishing is a release to the whole tester
 * list, so a bare invocation prints help and refuses rather than guessing.
 *
 * Use the internal testing track for Android distribution.
 */
import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const require = createRequire(import.meta.url);
const { GoogleAuth } = require('google-auth-library');

const ROOT = resolve(import.meta.dirname, '..');
const AAB = resolve(ROOT, 'app/android/app/build/outputs/bundle/release/app-release.aab');
// Named for the DEVELOPER ACCOUNT (sabeel), not for this app: one service
// account publishes every app on the account, scoped per-app by Play Console
// permissions, so a second app needs a tick box rather than a new credential.
// Every sibling repo defaults to this same path with no configuration.
// (The upload KEYSTORE is the opposite — one per app — hence
// `sabeel-kanban-upload.jks` beside it.)
const KEY = process.env.SK_PLAY_KEY ?? join(homedir(), 'keys', 'sabeel-play-publisher.json');
const API = 'https://androidpublisher.googleapis.com';

const args = process.argv.slice(2);
const check = args.includes('--check');
const publish = args.includes('--internal');
const app = JSON.parse(await readFile(resolve(ROOT, 'app/app.json'), 'utf8')).expo;
const pkg = app.android.package;
const version = app.version;

const die = (m) => {
  console.error(`\n${m}\n`);
  process.exit(1);
};

// Anything that is not a recognised flag must NOT fall through to publishing.
// Collapsing the two destinations into one briefly made the publish path
// unconditional, so `--dry-run` — or any typo — would have released to the
// testers. Lint caught it as an unused variable, which is a thin thread.
const known = ['--check', '--internal', '--help'];
const unknown = args.filter((a) => !known.includes(a));
if (unknown.length) {
  console.error(`\nUnrecognised: ${unknown.join(' ')}`);
}
if (args.includes('--help') || args.length === 0 || unknown.length) {
  console.log(`
  --check      run every gate and prove the Play permission; upload nothing
  --internal   publish to the internal testing track; the testers get it
`);
  process.exit(args.includes('--help') && !unknown.length ? 0 : 1);
}


// ---- gates, before anything leaves this machine ----------------------------

// Same two `build-aab.sh` holds, repeated here because a bundle built last week
// can be published today: the version must be store-legal, and the deploy log
// must already describe this release (it becomes the release notes).
execFileSync('node', [resolve(ROOT, 'scripts/check-version.mjs')], { stdio: 'inherit' });
try {
  execFileSync('node', [resolve(ROOT, 'scripts/deploy-notes.mjs'), version, '--title'], {
    stdio: 'pipe',
  });
} catch {
  die(`docs/PHASE_STATUS.md has no deploy-log entry for ${version} — write it before publishing.`);
}

const aab = await stat(AAB).catch(() => null);
// In --check the artifact is ADVISORY: the point of --check is to prove the
// credentials and permissions work, which must be answerable before a bundle
// has ever been built. Refusing here made it useless for exactly that.
if (!aab && !check) die(`No bundle at ${AAB}\nRun: npm run build:aab`);

/**
 * REFUSE A BUNDLE THAT IS NOT THIS VERSION — by reading what is INSIDE it.
 *
 * The first version of this gate compared mtimes, and it was defeated the first
 * time it was tested: copying the file back after an experiment refreshed its
 * timestamp, and a bundle whose contents said 0.7.4 then passed as 0.7.5. A
 * timestamp describes the file, not the build.
 *
 * The versionName survives in the base manifest as a plain string, so the
 * bundle can be asked what it actually is. mtime stays as a secondary hint,
 * because a bundle older than the source is worth mentioning even when the
 * version happens to match.
 */
function bundleVersion() {
  try {
    const manifest = execFileSync('unzip', ['-p', AAB, 'base/manifest/AndroidManifest.xml'], {
      maxBuffer: 32 * 1024 * 1024,
    });
    // Binary protobuf; the versionName is stored as a readable string in it.
    const found = [...manifest.toString('latin1').matchAll(/\d+\.\d+\.\d+/g)].map((m) => m[0]);
    return [...new Set(found)];
  } catch {
    return [];
  }
}

async function newestSource(dir, newest = 0) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'build' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    newest = e.isDirectory()
      ? await newestSource(p, newest)
      : Math.max(newest, (await stat(p)).mtimeMs);
  }
  return newest;
}
// Any artifact gate that WOULD refuse. In --check these are advisory, so the
// credentials can still be proved while the bundle is absent, stale or wrong.
let artifactNote = false;
const srcNewest = Math.max(
  await newestSource(resolve(ROOT, 'app/src')),
  await newestSource(resolve(ROOT, 'packages/shared/src')),
  // Native config decides what the bundle IS — minSdk, signing, the version
  // code. `newestSource` skips any `build` directory, so the bundle's own
  // output folder cannot make this always-stale.
  await newestSource(resolve(ROOT, 'app/android')),
);
if (aab) {
  const inside = bundleVersion();
  const problem = !inside.length
    ? `Could not read a version out of ${AAB}.`
    : !inside.includes(version)
      ? `That bundle is NOT ${version}.\n  app.json says: ${version}\n  bundle carries: ${inside.join(', ')}`
      : null;
  if (problem) {
    const msg = `${problem}\nRebuild: npm run build:aab`;
    if (!check) die(msg);
    artifactNote = true;
    console.log(`\nNOTE — would refuse to upload:\n${msg}`);
  } else {
    console.log(`bundle carries version ${version} (read from the manifest)`);
  }
}

if (aab && srcNewest > aab.mtimeMs) {
  const stale =
    `The bundle is OLDER than the source.\n` +
    `  bundle: ${new Date(aab.mtimeMs).toISOString()}\n` +
    `  source: ${new Date(srcNewest).toISOString()}\n` +
    `Rebuild with: npm run build:aab`;
  if (!check) die(stale);
  artifactNote = true;
  console.log(`\nNOTE — would refuse to upload:\n${stale}`);
}

/*
 * REFUSE A DEBUG-SIGNED BUNDLE, independently of how it was built.
 *
 * `build-aab.sh` checks this at build time, but this script uploads whatever
 * sits at the path — and the staleness gate above only compares timestamps, so
 * an old debug-signed bundle with no source changes since would sail through.
 * Play would reject a wrong upload key on the track, but failing here names the
 * problem instead of making Play do it.
 *
 * An AAB is a signed jar, so this is jarsigner, not apksigner.
 */
if (aab) {
  let signer = '';
  try {
    signer = execFileSync(
      'jarsigner',
      ['-verify', '-verbose:summary', '-certs', AAB],
      { encoding: 'utf8' },
    ).match(/Signed by "(.*)"/)?.[1] ?? '';
  } catch {
    signer = '';
  }
  const sigProblem = !signer
    ? `Could not read a signature from ${AAB}.`
    : /CN=Android Debug/i.test(signer)
      ? `That bundle is signed with the DEBUG key (${signer}).`
      : null;
  if (sigProblem) {
    const msg = `${sigProblem}\nRebuild with the upload key: npm run build:aab`;
    if (!check) die(`REFUSING: ${msg}`);
    artifactNote = true;
    console.log(`\nNOTE — would refuse to upload:\n${msg}`);
  } else {
    console.log(`signed by ${signer}`);
  }
}

const keyFile = await stat(KEY).catch(() => null);
if (!keyFile) {
  die(
    `No Play service-account key at ${KEY}\n` +
      `Put the JSON there (never in the repo — it is public), or set SK_PLAY_KEY.\n` +
      `See docs/DEPLOY.md § Publishing from the command line.`,
  );
}

/*
 * A revoked, replaced or malformed key throws here rather than returning
 * nothing, so this is wrapped: otherwise the most likely real-world failure —
 * someone rotated the key — arrives as a stack trace.
 */
let token;
try {
  const auth = new GoogleAuth({
    keyFile: KEY,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  ({ token } = await (await auth.getClient()).getAccessToken());
} catch (e) {
  die(
    `That key did not authenticate:\n${e.message}\n\n` +
      `If it was rotated or deleted, mint a new one:\n` +
      `  Google Cloud → IAM & Admin → Service Accounts → the publisher\n` +
      `  → Keys → Add key → JSON, then replace ${KEY}`,
  );
}
if (!token) {
  die(
    `No access token came back from ${KEY}.\n` +
      `The file parses but Google issued nothing — replace the key as above.`,
  );
}

const api = async (method, path, payload) => {
  const res = await fetch(`${API}/androidpublisher/v3/applications/${pkg}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status})\n${text}`);
  return text ? JSON.parse(text) : {};
};

console.log(`\npackage   ${pkg}`);
console.log(`version   ${version}`);
console.log(
  `bundle    ${aab ? `${(aab.size / 1024 / 1024).toFixed(1)} MB, built ${new Date(aab.mtimeMs).toISOString()}` : 'none built yet'}`,
);
console.log(`key       ${KEY}`);
console.log('target    internal TESTING track (the testers get this)');

if (check) {
  /*
   * PROVE AUTHORIZATION, not just authentication.
   *
   * A service-account key mints an access token whether or not Play Console has
   * granted it anything, so "we got a token" would report success for a setup
   * that fails at the first upload with a 403. Inserting an edit and deleting it
   * exercises the exact permission the real run needs and leaves nothing behind.
   */
  let probe;
  try {
    probe = await api('POST', '/edits');
    await api('DELETE', `/edits/${probe.id}`);
  } catch (e) {
    die(
      `The key authenticates, but Play refused the operation:\n${e.message}\n\n` +
        `Most likely the service account has not been granted\n` +
        `"Release apps to testing tracks" on this app in Play Console.`,
    );
  }
  const verdict = artifactNote
    ? '--check: the service account can release to this app, but a real run\nwould refuse the bundle for the reason noted above.'
    : '--check: gates pass, and the service account really can release to this\napp (an edit was created and discarded).';
  console.log(`\n${verdict}\nNothing was uploaded.\n`);
  process.exit(0);
}

const body = await readFile(AAB);
const upload = async (url) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body,
    // Uploading tens of megabytes; the API docs ask for a raised timeout.
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Upload failed (${res.status})\n${text}`);
  return JSON.parse(text);
};

if (!publish) {
  die('Nothing to do. Pass --internal to publish, or --check to test the setup.');
}

let committed = false;
{
  console.log('\nUploading to the internal testing track…');
  const edit = await api('POST', '/edits');
  /*
   * Anything that throws from here must DISCARD the edit, not merely mention
   * it. The first version of this logged from a `process.on('exit')` handler,
   * which cannot await — so it announced a cleanup it was incapable of doing,
   * and `die()` called process.exit before any catch could run anyway.
   */
  try {
  const bundle = await upload(
    `${API}/upload/androidpublisher/v3/applications/${pkg}/edits/${edit.id}/bundles?uploadType=media`,
  );
  console.log(`  uploaded versionCode ${bundle.versionCode}`);
  await api('PUT', `/edits/${edit.id}/tracks/internal`, {
    track: 'internal',
    releases: [{ versionCodes: [String(bundle.versionCode)], status: 'completed' }],
  });
  await api('POST', `/edits/${edit.id}:commit`);
  committed = true;
  console.log(`\nDone. v${version} (code ${bundle.versionCode}) is on the internal testing track.`);
  console.log('Testers get it from Play; propagation takes a few minutes.\n');
  } catch (e) {
    if (!committed) {
      await api('DELETE', `/edits/${edit.id}`).catch(() => {});
      console.error(`\nDiscarded the unfinished edit ${edit.id}; nothing was released.`);
    }
    die(e.message);
  }
}
