import { initializeApp, getApps } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';
import { EMULATOR_STORAGE_BUCKET, STORAGE_BUCKET } from '@sabeel/shared';
import { isEmulatorProject } from './env';

/**
 * One Admin SDK app for the whole codebase, and the shared deploy options.
 *
 * `invoker: 'public'` is required for callables: the Cloud Run layer would
 * otherwise reject unauthenticated HTTP before our code runs, and Firebase
 * callables authenticate inside the function body, not at the transport.
 * See docs/INHERITED-STACK.md lesson 2 for how this failed in the sibling
 * project — and note the binding is only applied on the function CREATE path,
 * so a first deploy that fails to build leaves callables permanently 403. In
 * this project's organization it fails on create as well, refused by
 * domain-restricted sharing, so every NEW callable is bound by hand after its
 * first deploy (docs/DEPLOY.md § Known traps, "A new callable answers 403").
 */
setGlobalOptions({
  region: 'us-central1',
  invoker: 'public',
  maxInstances: 10,
});

/**
 * The bucket is named explicitly rather than inferred.
 *
 * Neither environment supplies a usable one. The functions emulator supplies
 * nothing at all, so the Admin SDK throws "Bucket name not specified" the first
 * time anything touches Storage; and `FIREBASE_CONFIG.storageBucket` has been
 * seen to carry a legacy `<project>.appspot.com` name on projects using the
 * modern default-bucket naming — pointing at a bucket that does not exist.
 *
 * This lives here, not in `index.ts`, because every module starts with
 * `import './setup'` — so nothing can get in front of it to initialise first.
 */
if (getApps().length === 0) {
  initializeApp({
    storageBucket: isEmulatorProject() ? EMULATOR_STORAGE_BUCKET : STORAGE_BUCKET,
  });
}
