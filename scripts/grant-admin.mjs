#!/usr/bin/env node
/**
 * Bootstrap the first admin.
 *
 * There is a chicken-and-egg problem after the first deploy: only an admin can
 * promote anyone, and there is no admin yet. This script breaks it using the
 * Admin SDK, which bypasses rules and the callable.
 *
 * Everyone AFTER the first admin should be promoted in-app — that path is
 * audited (accessChangedBy) and refuses self-changes. Reach for this script only
 * to create the first admin, or to recover if every admin is locked out.
 *
 * Usage:
 *   # against production (needs gcloud ADC or GOOGLE_APPLICATION_CREDENTIALS)
 *   GCLOUD_PROJECT=<project-id> node scripts/grant-admin.mjs you@oursabeel.com
 *
 *   # against the running emulators (their project and ports from ci-tools)
 *   npm run grant-admin -- you@oursabeel.com
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { isAllowedEmail } from '@sabeel/shared';

const email = process.argv[2];
if (!email) {
  console.error('usage: node scripts/grant-admin.mjs <email>');
  process.exit(1);
}

const projectId = process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error('Set GCLOUD_PROJECT to the target project id.');
  process.exit(1);
}

// The same domain rule the trigger applies. Promoting an outside address would
// create exactly the account the whole access model exists to prevent.
if (!isAllowedEmail(email, true)) {
  console.error(`Refusing: ${email} is not on the org domain.`);
  process.exit(1);
}

const usingEmulators = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
console.log(
  `Project ${projectId}${usingEmulators ? ' (EMULATORS)' : ' (PRODUCTION)'}`,
);

initializeApp({ projectId });

let user;
try {
  user = await getAuth().getUser(
    (await getAuth().getUserByEmail(email)).uid,
  );
} catch {
  console.error(
    `No account for ${email}. Sign in through the app once first — the ` +
      'auth-create trigger provisions the user, then re-run this.',
  );
  process.exit(1);
}

await getAuth().setCustomUserClaims(user.uid, { role: 'admin', status: 'active' });

// Mirror to the doc AND bump claimsUpdatedAt, so a client already signed in
// picks the change up live instead of waiting for its token to expire.
await getFirestore()
  .doc(`users/${user.uid}`)
  .set(
    {
      role: 'admin',
      status: 'active',
      claimsUpdatedAt: FieldValue.serverTimestamp(),
      accessChangedBy: 'grant-admin-script',
    },
    { merge: true },
  );

console.log(`${email} (${user.uid}) is now an active admin.`);
console.log('If they are signed in, the app will update within a second.');
process.exit(0);
