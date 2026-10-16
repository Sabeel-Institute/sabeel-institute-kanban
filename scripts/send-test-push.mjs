#!/usr/bin/env node
/**
 * Send one real push to one device.
 *
 *     node scripts/send-test-push.mjs --apple <development|production> <iphone-token> [boardId [cardId]]
 *     node scripts/send-test-push.mjs <fcm-token> [boardId [cardId]]
 *
 * The device check no emulator can do: FCM has no emulator, Apple's service
 * has none either, and the functions emulator sends nothing
 * (functions/src/messaging.ts), so "a push is shown, and a tap opens its card"
 * is proved only by a real message reaching a device. With a board (and card)
 * id the tap opens that board (or card); without, it opens the app.
 *
 * The message is built by the functions' own code (`functions/src/apns.ts`,
 * `functions/src/fcm.ts`), run from source, so this sends what a notification
 * sends, routing data and all.
 *
 * An iPhone's token goes to the Apple service it came from: `development` for
 * a debug build — an Apple-silicon simulator receives these, which is how a
 * local build is tested — and `production` for TestFlight and the App Store.
 * The token is the id of the device's row under `users/<uid>/pushTokens`, and
 * the row's `apnsEnvironment` names the service. The key is read from
 * APNS_KEY_FILE (default `~/.apns/AuthKey_<APNS_KEY_ID>.p8`); its id and the
 * team id from `functions/.env.<project>`.
 *
 * An FCM send authenticates as Application Default Credentials, or as
 * CHECK_ACCESS_TOKEN when set (a user token for the project's owner).
 *
 * Writes nothing: no Firestore document and no inbox entry, so a tap marks
 * nothing read.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { sendToApns } from '../functions/src/apns.ts';
import { fcmMessage } from '../functions/src/fcm.ts';

const ROOT = resolve(import.meta.dirname, '..');
const USAGE = `usage: send-test-push.mjs --apple <development|production> <iphone-token> [boardId [cardId]]
       send-test-push.mjs <fcm-token> [boardId [cardId]]`;

const projectId = JSON.parse(readFileSync(resolve(ROOT, '.firebaserc'), 'utf8')).projects.default;

/** The routing data a real notification carries (`notify` in functions/src/notifications.ts). */
function message(boardId, cardId) {
  return {
    title: 'Sabeel Kanban',
    body: 'Test push from scripts/send-test-push.mjs. Safe to dismiss.',
    data: {
      ...(boardId ? { type: 'assigned', boardId } : {}),
      ...(boardId && cardId ? { cardId } : {}),
    },
  };
}

const args = process.argv.slice(2);

if (args[0] === '--apple') {
  const [, environment, token, boardId, cardId] = args;
  if (environment !== 'development' && environment !== 'production') {
    console.error(`--apple needs the service the token came from: development or production\n${USAGE}`);
    process.exit(2);
  }
  if (!token || !/^[0-9a-f]{64,200}$/i.test(token)) {
    console.error(`an iPhone's token is hex, at least 64 characters\n${USAGE}`);
    process.exit(2);
  }
  const env = Object.fromEntries(
    readFileSync(resolve(ROOT, 'functions', `.env.${projectId}`), 'utf8')
      .split('\n')
      .map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  const keyFile = process.env.APNS_KEY_FILE || resolve(homedir(), '.apns', `AuthKey_${env.APNS_KEY_ID}.p8`);
  let key;
  try {
    key = readFileSync(keyFile, 'utf8');
  } catch {
    console.error(`no push key at ${keyFile} (set APNS_KEY_FILE)`);
    process.exit(2);
  }
  const out = await sendToApns(
    [{ token, apnsEnvironment: environment, message: message(boardId, cardId) }],
    { key, keyId: env.APNS_KEY_ID, teamId: env.APPLE_TEAM_ID },
  );
  if (out.delivered.length) console.log(`accepted by Apple (${environment})`);
  else if (out.dead.length) console.log('Apple says this token will never work (the other service, another app, or the app was removed)');
  else console.log(`not delivered: ${out.failed[0]?.reason}`);
  process.exit(out.delivered.length ? 0 : 1);
}

const [token, boardId, cardId] = args;
if (!token || token.length < 100) {
  console.error(`an FCM token is ~150 characters\n${USAGE}`);
  process.exit(2);
}
const require = createRequire(resolve(ROOT, 'functions', 'package.json'));
const admin = require('firebase-admin');
const accessToken = process.env.CHECK_ACCESS_TOKEN;
admin.initializeApp({
  projectId,
  ...(accessToken
    ? { credential: { getAccessToken: async () => ({ access_token: accessToken, expires_in: 3000 }) } }
    : {}),
});
const id = await admin.messaging().send(fcmMessage(token, message(boardId, cardId)));
console.log(`sent ${id}`);
process.exit(0);
