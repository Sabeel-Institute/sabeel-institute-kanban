#!/usr/bin/env node
/**
 * Does Apple accept this project's push key, for this app?
 *
 *     npm run check:apple-push
 *
 * The iPhone half of the send path, proved without a phone. A push goes to a
 * device token that cannot exist (64 hex characters), through the functions'
 * own sender (`functions/src/apns.ts`), to both of Apple's services. Apple
 * checks the provider token before the device token, so an answer about the
 * TOKEN means it accepted the key, its id, the team and the app id; and that
 * answer arriving as "dead" means the sender prunes on what Apple really says.
 *
 * The key is the one the deployed functions read — Secret Manager's APNS_KEY,
 * through gcloud, never printed — or the file APNS_KEY_FILE names, on a machine
 * that keeps the `.p8` and not the project's credentials. Its id and the team
 * id come from `functions/.env.<project>`, as the deployed functions read them.
 *
 * What it cannot prove is a banner on a phone: that is
 * `scripts/send-test-push.mjs`, to a simulator or a TestFlight install.
 *
 * Reads and writes nothing in Firestore, and reaches no real device.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sendToApns } from '../functions/src/apns.ts';

const ROOT = resolve(import.meta.dirname, '..');
const projectId = JSON.parse(readFileSync(resolve(ROOT, '.firebaserc'), 'utf8')).projects.default;
const params = Object.fromEntries(
  readFileSync(resolve(ROOT, 'functions', `.env.${projectId}`), 'utf8')
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

let key = '';
let from = '';
if (process.env.APNS_KEY_FILE) {
  key = readFileSync(process.env.APNS_KEY_FILE, 'utf8');
  from = 'APNS_KEY_FILE';
} else {
  try {
    key = execFileSync(
      'gcloud',
      ['secrets', 'versions', 'access', 'latest', '--secret=APNS_KEY', `--project=${projectId}`],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString();
    from = 'Secret Manager';
  } catch {
    key = '';
  }
}
if (!key) {
  console.log(`  FAIL  no APNS_KEY: not readable from Secret Manager in ${projectId}, and APNS_KEY_FILE is not set`);
  process.exit(1);
}

console.log(`Apple push for ${projectId}: key ${params.APNS_KEY_ID} (from ${from}), team ${params.APPLE_TEAM_ID}\n`);
const probe = 'ab'.repeat(32);
let failed = false;
for (const apnsEnvironment of ['production', 'development']) {
  const out = await sendToApns(
    [{ token: probe, apnsEnvironment, message: { title: 'reachability probe', body: 'never delivered', data: {} } }],
    { key, keyId: params.APNS_KEY_ID, teamId: params.APPLE_TEAM_ID },
  );
  if (out.dead.includes(probe)) {
    console.log(`  ok    ${apnsEnvironment}: Apple accepted the key, team and app, and refused the bogus token as dead`);
  } else {
    failed = true;
    console.log(`  FAIL  ${apnsEnvironment}: ${out.failed[0]?.reason ?? 'the bogus token was ACCEPTED'}`);
  }
}
if (failed) {
  console.log('\n  InvalidProviderToken: the key, its id or the team id is wrong;');
  console.log('  TopicDisallowed or BadTopic: the key is not for this app.');
}
console.log(failed ? '\nthe iPhone send path is NOT ready' : '\nthe iPhone send path is ready; a banner is still a device check');
process.exit(failed ? 1 : 0);
