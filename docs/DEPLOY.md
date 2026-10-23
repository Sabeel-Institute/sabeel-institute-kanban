# Deploy guide

Automatic platform builds and manual release controls are documented in
[GitHub Actions](GITHUB-ACTIONS.md).

A release needs the access below, the files in `docs/SECRETS.md`, and the order
in § Shipping a release. Store decisions — tracks, testers, App Review, listings
— are in `docs/STORE-RELEASE.md`; the iPhone build is `docs/IOS-BUILD.md`.

## Access

Roles, not people: whoever holds a role today grants it.

| Where | Role | For |
|---|---|---|
| Firebase / Google Cloud project `sabeel-institute-kanban` | Owner | `firebase deploy`, `functions:secrets:set`, and the scripts run with `GCLOUD_PROJECT=…` (gcloud ADC) |
| Google Play Console, the Sabeel developer account | user on this app with **Release apps to testing tracks** and **Manage testing tracks and edit tester lists** | the Testers tab, App content, the app-signing fingerprints |
| App Store Connect, the Sabeel Institute team | **Admin** or **App Manager** on this app; the **Account Holder** files the unlisted-distribution request | TestFlight testers, App Review submissions |
| GitHub `Sabeel-Institute/sabeel-institute-kanban` | write; repository administrators manage Actions secrets | pushing branches and `npx sabeel-ci release`'s pull request (only the organization owner merges into `main` and creates release tags, so `release --ship` is the owner's), `gh workflow run` |
| Sentry, the Sabeel org | member of the three Kanban projects | DSNs, the build token, triage |
| The vault owner | — | every file in `docs/SECRETS.md` § Build and publish credentials |

The Firebase project belongs to Sabeel Institute's `oursabeel.com` Cloud
organization (`833557915874`), with `faisal.shah@oursabeel.com` as Owner
and Institute billing. Authenticate Firebase CLI, gcloud and Application Default
Credentials separately as the Institute account.

Domain-restricted IAM sharing applies. Existing public callable endpoints are
reachable; new public invoker bindings may require an approved policy exception.
OAuth consent is External and published.

Repository: `Sabeel-Institute/sabeel-institute-kanban`. Local clone:
`/home/faisal/repos/Sabeel-Institute/sabeel-institute-kanban`. Secrets are backed up
in `~/.config/secrets-vault/`, with live paths in `sources.tsv`. Copy and
verify secrets when setting up a clone; deleting originals requires express
approval.

## Prerequisites

In place for `sabeel-institute-kanban`; every deploy assumes them:

1. Blaze billing; `.firebaserc` and `app/src/firebase-config.ts` name the
   project. **`EMULATOR_PROJECT_ID` stays as it is** — it is what points local
   development at the emulators.
2. Secret Manager holds **`SENTRY_DSN`** and **`APNS_KEY`**. Every function that
   sends a push binds `APNS_KEY`, so a functions deploy needs it
   (`docs/SECRETS.md`).
3. The project is on **Identity Platform**, with two sign-in providers: Google,
   and Email/Password for the one review address. The door holds only in this
   order, on a new project or whenever the provider is switched back on:
   functions first, so `beforeSignUp` and `beforeSignIn` exist and are
   registered as the project's blocking triggers (`beforeCreate`,
   `beforeSignIn`); then the rules; then the Email/Password provider on; then
   the review account (`docs/STORE-RELEASE.md`). The provider on first leaves a
   window in which anyone holding the public API key can make an account.
4. On the deploying machine, `app/.env.local` (`docs/SECRETS.md`): a hosting
   bundle without its web Sentry DSN reports nothing. The Web workflow's build
   refuses one; a local `firebase deploy` does not.
5. **Report a problem can send mail.** `reportProblem` sends as
   `apps-noreply@oursabeel.com` by domain-wide delegation, keyless: it asks IAM
   Credentials to sign a delegation token as
   `report-mailer@sabeel-institute-kanban.iam.gserviceaccount.com` (named in
   `functions/.env.sabeel-institute-kanban`), trades it for the sender's token,
   and calls the Gmail API. That needs:
   - the **Gmail API** enabled in the project (it is, since 2026-10-16), and
     IAM Credentials, which attachment signing already uses;
   - the Admin console's **Domain-wide delegation** entry for `report-mailer`'s
     client id, scope `https://www.googleapis.com/auth/gmail.send` only (in
     place since 2026-10-16, when a test message reached `apps-reports@`);
   - the functions' runtime account allowed to sign as `report-mailer`. Grant
     it once, before the first deploy of `reportProblem`:

     ```sh
     gcloud iam service-accounts add-iam-policy-binding \
       report-mailer@sabeel-institute-kanban.iam.gserviceaccount.com \
       --project sabeel-institute-kanban \
       --member serviceAccount:826656438175-compute@developer.gserviceaccount.com \
       --role roles/iam.serviceAccountTokenCreator
     ```

     `826656438175-compute@` is the gen-2 runtime account every function here
     runs as. Without the grant a report is still stored, its `mail.status` is
     `failed` and `mail.error` begins "signing the delegation token: HTTP 403".

A new project instead: the consoles in `TODO.md` § B–D, then § First admin
below.

## Deploy

```sh
# Indexes FIRST — they take minutes to build, and queries error until they exist.
npx firebase deploy --only firestore:indexes --project sabeel-institute-kanban

# Then rules and functions, then the web app (§ Shipping a release has the order).
npx firebase deploy --only firestore:rules,storage,functions --project sabeel-institute-kanban
npx firebase deploy --only hosting --project sabeel-institute-kanban
```

Functions deploy from GitHub too, and that is the usual way: **Deploy
Functions** (`functions-deploy.yml`, `docs/GITHUB-ACTIONS.md`) deploys main
after CI has passed on it, refuses a deploy that would delete a live function,
and afterwards checks every callable and the error logs. It needs no local
Google login. The same guards run here:

```sh
export FIREBASE_PROJECT_ID=sabeel-institute-kanban
npx sabeel-ci ci-functions require-ci && npx sabeel-ci ci-functions plan
npx firebase deploy --only functions --project sabeel-institute-kanban
npx sabeel-ci ci-functions verify --since <the time the deploy started, ISO>
```

It is `storage`, **not** `storage:rules`. The `storage` block in `firebase.json`
is a single unnamed config, so a named target does not exist and `storage:rules`
errors with "Could not find rules for the following storage targets: rules".

Hosting serves `app/dist-web`, built automatically by the predeploy hook
(`npm run web:export -w @sabeel/app`, which is `sabeel-ci build-web`). The
usual web release is **Deploy Web** instead, which publishes the artifact the
Web workflow built and checked for that commit, after uploading its source
maps to Sentry (§ Shipping a release); a local deploy uploads none.

**Attachments cannot be fully verified before this deploy.** The Storage
emulator has no signing service, so `getAttachmentUrl` takes a different branch
locally and the `roles/iam.serviceAccountTokenCreator` grant it depends on fails
ONLY in production. After deploying, upload a file and open it, and confirm the
URL carries `X-Goog-Signature`. Note an expired GCS signed URL answers **HTTP
400 `ExpiredToken`**, not 403.

## First admin

Everyone lands `pending` and only an admin can approve, so the first admin has to
be made from outside the app. `scripts/grant-admin.mjs` does this with the Admin
SDK, but it needs gcloud ADC or `GOOGLE_APPLICATION_CREDENTIALS`:

```sh
GCLOUD_PROJECT=sabeel-institute-kanban node scripts/grant-admin.mjs you@oursabeel.com
```

**Without those credentials**, the fallback is a temporary one-shot function.
This project was bootstrapped that way on 2026-07-19; the file no longer exists,
because step 4 is to delete it. Recreate it as `functions/src/bootstrap.ts` only
if you are standing up a *new* project:

1. Sign in through the app once so the account exists (you will land `pending`).
2. `firebase deploy --only functions:bootstrapFirstAdmin`
3. `curl https://us-central1-sabeel-institute-kanban.cloudfunctions.net/bootstrapFirstAdmin`
4. **Delete it** — the export in `functions/src/index.ts`, the file, then
   `firebase functions:delete bootstrapFirstAdmin --region us-central1`.
5. Sign out and back in to pick up the claim.

It is safe for the minutes it exists by construction, not secrecy: it can only
ever promote one hardcoded address, it refuses once any admin exists, and it
re-checks the verified-domain rule. Delete it anyway — a spent one-shot left
lying around is a thing someone later has to reason about.

From then on, promote everyone else in-app under **People**.

## Android distribution

Testers install through Play internal testing:
https://play.google.com/apps/internaltest/4701475909888991410

Every release also carries its APKs on the versioned GitHub release in
`Sabeel-Institute/sabeel-institute-kanban`, beside the manual:
`sabeel-institute-kanban-arm64-v8a.apk` and
`sabeel-institute-kanban-universal.apk`, which `npx sabeel-ci release --ship`
builds, checks and attaches (§ Shipping a release). No personal website or
Pages clone is involved. Those APKs carry the upload key; Play installs use
Google's app signing key, so neither can replace the other.

## Android releases — Google Play

`npx sabeel-ci release --ship` builds the bundle and publishes it (§ Shipping a
release). The two steps alone, for a rerun:

```sh
npm run build:aab                          # sabeel-ci build-aab
# outputs app/android/app/build/outputs/bundle/release/app-release.aab
npx sabeel-ci publish-play --internal
```

`sabeel-ci build-aab` refuses to start Gradle without a store-legal version, a
deploy-log entry for it that exists **before** the build, the native Sentry
DSN (`EXPO_PUBLIC_SENTRY_DSN_NATIVE`) in `app/.env.local` and the Sentry token
in `app/.env.sentry-build-plugin`; it stamps the commit, builds with
`ci-tools.json`'s Sentry org and native project (the bundle's source map goes
there), and refuses an unsigned or debug-signed bundle. Play wants one bundle carrying
every ABI and does its own per-device splitting, so the `splits` block turns
itself off for bundle tasks — leaving both on fails with *"Multiple
shrunk-resources files found"*.

### Three SHA-1s, because there are three signing identities

All three are registered in Firebase; each covers a different way the app gets
onto a device, and a missing one fails only for that route:

| Build | Signed with | Needed for |
|---|---|---|
| `npm run dev:android`, `expo run:android` | committed debug keystore | day-to-day development |
| any release build: the APKs on a GitHub release, a local `assembleRelease` | upload key, `~/.config/sabeel-kanban/…jks` | an APK installed by hand |
| installed from Play | **Google's app signing key** | everyone actually using the app |

Play's is the one that gets forgotten: **Play re-signs whatever you upload**,
so the key you built with is not the key the installed app runs under. Its
fingerprint is under Play Console → App integrity → *App signing key
certificate*. Miss it and sign-in fails with `DEVELOPER_ERROR` for Play users
only, while every build on your own machine works — so it reads as a device
problem. Its SHA-256 is also `release.appSigningCertificate` in
`ci-tools.json`, read from the APKs Play generated for 0.12.2: `sabeel-ci
publish-play` completes a release only when Play signs with it, so a key change
on Play's side stops the next release instead of reaching phones.

### DEVELOPER_ERROR on a Play install — diagnose in this order

Sign-in fails only for Play-installed copies while every local build works. The
cause is almost always the app signing fingerprint, but "registered" and
"in effect" are different things, so check in this order rather than rebuilding:

0. **Is Play App Signing "quantum-ready"?** Play Console -> App integrity ->
   App signing. If the app signing key is badged **Quantum-ready (beta)**, that
   page lists a **Classical key** AND a **Post-quantum cryptography key**, each
   with its own fingerprints — and any **Previous app signing keys** row is a
   third certificate, the classical key still served to older devices. Google's
   guidance is that **all three must be registered** with API providers. This is
   the trap that cost a night: registering only the classical key makes every
   other check pass — the fingerprint matches, the OAuth client exists, the
   package is right — while devices served either of the other two certificates
   get `DEVELOPER_ERROR`. Register every SHA-1 that page shows.

1. **Is the fingerprint registered?** Google Cloud Console -> APIs & Services ->
   **Credentials** -> OAuth 2.0 Client IDs. There should be one **Android** client
   per registered SHA-1 — debug, upload key and Play's app signing key — each
   marked "Auto created by Google service", which is Firebase creating them when
   a fingerprint is added. Several entries for one package is correct, not a
   duplicate.
2. **If it is there, it is propagation.** OAuth client changes take minutes and
   sometimes hours. Force-stop the app and retry; then clear the device's Google
   Play services cache (Settings -> Apps -> Google Play services -> Storage ->
   Clear cache), because the config is cached device-side and that cache outlives
   the server-side change.
3. **Only then consider a rebuild** — and note the cost: a re-upload needs a NEW
   versionCode, which is derived from the version, so it means bumping the
   version and writing a deploy-log entry, not just rebuilding.

**The bundled `google-services.json` does not matter at runtime, confirmed.**
`WEB_CLIENT_ID` is a hardcoded constant in `app/src/firebase-config.ts`, and the
plugin bakes only `default_web_client_id`, `gcm_defaultSenderId`,
`google_api_key`, `google_app_id`, `google_crash_reporting_api_key`,
`google_storage_bucket` and `project_id` into the app — **no certificate hashes**.
Check `app/android/app/build/generated/res/processReleaseGoogleServices/values/values.xml`
if it is ever doubted again. A bundle built before a fingerprint was added still
works once the fingerprint is registered, so **never spend a version bump on a
rebuild for this**: registration is entirely server-side. Proven on 2026-08-03,
when the fix was fingerprints and the shipped AAB never changed.

### Debug installs alongside; the two release builds do not

Debug builds carry `applicationIdSuffix '.debug'`, so
**`com.sabeelinstitute.kanban.debug`** is a separate app to Android and sits on
the same device as the real one. Its launcher label is **"Sabeel Kanban (dev)"**
(`app/android/app/src/debug/res/values/strings.xml` — a build-type source set,
because declaring `app_name` again via `resValue` collides with `src/main/res`).

Two consequences worth knowing:

- **It is a different app to Firebase too**, registered separately with the debug
  SHA-1. Without that registration the google-services plugin fails the build
  outright: *"No matching client found for package name"*.
- **`expo run:android` does not know about the suffix.** It reads the id with a
  regex over the `applicationId` line alone, so it would install the `.debug` APK
  and then try to launch the unsuffixed package. `npm run dev:android` passes
  `--app-id com.sabeelinstitute.kanban.debug` to correct that.

**A sideloaded release APK and a Play install still collide** — both are
`com.sabeelinstitute.kanban` with different signatures, so neither can replace
the other. Uninstall to move between those two.

### Android developer verification, and why it does not threaten dev builds

Google's developer-verification programme links a package name to its signing
keys, and unverified apps eventually cannot be installed. Two facts bound what
it means here, both from Google's FAQ rather than inference:

- **ADB installs are exempt, permanently and by design** — *"As a developer, you
  are free to install apps without verification with ADB."* That covers debug
  builds and locally sideloaded APKs, so `npm run dev:android` is unaffected
  whatever happens to the timeline.
- **`com.sabeelinstitute.kanban.debug` needs no registration.** Registration
  applies to apps distributed to end users through a store, not to a package that
  only ever reaches a device over adb.

The **30 September 2026** date is narrower than it first reads: it covers only
specific participating stores in Brazil, Indonesia, Singapore and Thailand.
Global rollout is **2027**. Creating the app in Play Console registered
`com.sabeelinstitute.kanban` automatically, so the Play route is already covered.

The one thing with a real horizon is the **APKs on the GitHub releases**: by
the 2027 global rollout, an app sideloaded from a page rather than a store needs
its signing key registered under Play Console -> Android developer
verification. Retiring that channel resolves it; so would registering the
upload key there.

### The signing and publishing files, and where they are kept

Three files in `~/keys`, plus `~/.config/sabeel-kanban/keystore.properties`;
each is copied into the vault (`docs/SECRETS.md`).

| File | Role | If it is missing |
|---|---|---|
| `sabeel-kanban-upload.jks` | Play **upload** key | **Restore it from the vault. Never generate a new one**: Play refuses a new upload key until Play Console support resets it |
| `~/.config/sabeel-kanban/keystore.properties` | the keystore's absolute path, its passwords and alias, which `build.gradle` reads (or the file `SABEEL_KEYSTORE_PROPERTIES` names) | Gradle refuses to package a release. Restore it with the keystore; one is useless without the other |
| `sabeel-play-publisher.json` | Play service-account key for `sabeel-ci publish-play` | Restore it, or mint a new one (below) |
| `upload_certificate.pem` | public certificate of the upload key | What Play support asks for in an upload-key reset; re-exportable from the keystore |

**Losing the upload key is friction, not death.** Under Play App Signing, Google
holds the *app signing* key — the one that actually has to stay constant — so a
lost upload key is reset through Play Console support and updates resume. The
app signing key is the one that can never be replaced, and it is not on this
machine.

**Rotating the service-account key** takes a minute: Google Cloud → *IAM & Admin
→ Service Accounts* → `sabeel-play-publisher` → *Keys → Add key → JSON*, delete
the old key, put the new file at `~/keys/sabeel-play-publisher.json`, then
`bash ~/.config/secrets-vault/vault.sh collect`. It is org-scoped, not
app-scoped: one account publishes every app on the developer account.

### Publishing from the command line, without a browser

`npx sabeel-ci publish-play` uploads the release AAB through the Google Play
Developer API, so a build can reach a phone when nobody is at the computer that
built it. `npx sabeel-ci release --ship` runs it last; alone it is for a rerun.

```
npx sabeel-ci publish-play --check      # every gate + the Play permission, uploads nothing
npx sabeel-ci publish-play --internal   # publish to the internal testing track
```

**There is one destination, and it must be named.** Publishing is a release to
the whole tester list, so a bare invocation prints the usage and refuses rather
than guessing; unrecognised flags are refused too.

Internal app sharing is not supported. Use Play internal testing for testers
and a locally installed release APK for developer verification.

**Gates, before anything leaves the machine.** The bundle must be signed, and
not with the debug key; its JavaScript must carry HEAD's commit, not marked
`+` (built from uncommitted changes); its manifest must name `app.json`'s
version, from a `build.gradle` that derives the version rather than stating
one. A timestamp describes the file, not the build, so nothing here trusts one.

**Then three steps.** The bundle goes up as a DRAFT on the internal track, which
no tester sees, and Play's reading of its versionCode must be the one the
version gives; a rerun after a failure resumes only with this very bundle. Play
then makes the APKs phones install, and the release is completed only when Play
signs them with `release.appSigningCertificate` in `ci-tools.json`, the app
signing certificate (§ Three SHA-1s); then testers get it. Play keeps an app's
first release a draft when the API may not complete it, and says so: one "Start
rollout" in Play Console sends it.

`--check` runs every gate, then proves the Play permission by creating and
discarding an edit — even when a gate fails, because a missing or stale bundle
is the state you are in *before* rebuilding, and whether the credentials work is
the question `--check` exists to answer. It exits 1 when a real run would
refuse, and uploads nothing.

**One credential for every app, named for the ACCOUNT not the app.** A Play
service account belongs to the developer account and is scoped per-app by Play
Console permissions, so one key publishes them all and a second app needs no new
credential — only a tick box. That is the opposite of the upload **keystore**,
which is per-app and stays app-named (`sabeel-kanban-upload.jks`). Every Sabeel
app publishes through the same `sabeel-ci publish-play` and finds the same key
with no configuration.

**The credential lives at `~/keys/sabeel-play-publisher.json`** (override with
`PLAY_KEY`), beside the upload keystore and for the same reason: this repo is
PUBLIC, and a service-account key committed once is a publish credential for the
app that stays readable in history no matter what a later commit removes.
`.gitignore` carries a name-pattern backstop, but the file should simply never be
inside the repo.

Set up already; for a new service account, all of it in consoles:

1. **Google Cloud** → the project already backing Firebase → *APIs & Services* →
   enable **Google Play Android Developer API**.
2. **IAM & Admin → Service Accounts** → create one (a name like
   `sabeel-play-publisher`), then *Keys → Add key → JSON*. That download is the
   only copy; Google keeps none.
3. **Play Console → Users and permissions → Invite new user** → the service
   account's `…iam.gserviceaccount.com` address → grant it on **this app only**,
   with **Release apps to testing tracks**.
4. `chmod 600 ~/keys/sabeel-play-publisher.json`, then
   `bash ~/.config/secrets-vault/vault.sh collect`.
5. `npx sabeel-ci publish-play --check`.

### Testers: the "Sabeel staff" list

Internal testing is this app's Play track, and `sabeel-ci publish-play`
publishes to it alone; public production is the destination, released from Play Console
(`docs/STORE-RELEASE.md`). Who gets each internal release is an account-wide
Play Console **email list**, "Sabeel staff", shared by every app on the
developer account:

1. Play Console → this app → *Testing → Internal testing → **Testers*** → tick
   **Sabeel staff** → *Save*. A list that exists but is not ticked on the track
   reaches nobody.
2. On the same page, copy the **opt-in link** and send it to the team. **Play
   sends no email**: someone on the list sees nothing until they open that
   link, signed in to the Google account on the list — the one their phone's
   Play Store uses — and accept.
3. A new colleague: add their address to the list, then send them the link.

**"Item not found" right after opting in is normal**: a first download takes a
while to propagate. If it persists for one person, check in this order: their
phone is **Android 13 or newer** (`minSdkVersion 33`; Play shows an ineligible
device as this same screen), the Play Store's ACTIVE account (profile icon) is
the one that opted in, and the release is rolled out rather than a draft. A
pre-13 phone cannot install the app; that person uses the web app.

### The release APKs, and signing

`npx sabeel-ci release --ship` builds the per-ABI APKs with `./gradlew
assembleRelease` and attaches two of them to the versioned GitHub release:

```
app/android/app/build/outputs/apk/release/app-arm64-v8a-release.apk  -> sabeel-institute-kanban-arm64-v8a.apk
app/android/app/build/outputs/apk/release/app-universal-release.apk  -> sabeel-institute-kanban-universal.apk
```

It refuses an APK not signed with the bundle's key, and cold-starts the
universal one on the AVD before anything is published. Per-ABI splits plus R8
take arm64 from 82 MB to 27 MB. Both R8 flags are ON in `gradle.properties` and
both are OFF by default in the React Native template.

**`./gradlew clean` can fail** in `externalNativeBuildCleanDebug` while CMake
regenerates. Delete the caches instead:

```sh
rm -rf app/android/app/.cxx app/android/app/build
```

**After any change to R8 or splits, install and RUN the result** — R8 strips
classes reached only by reflection, and Google Sign-In is exactly that kind of
dependency. A smaller APK that crashes on launch is worse than a large one that
works. `sabeel-ci check-release` installs a release APK or bundle on the AVD
(booting it when no device is attached), cold-starts it five times, and fails
unless each start reaches the sign-in screen with this build's label, no dev
sign-in row and no crash in the device log:

```sh
npx sabeel-ci build-info && (cd app/android && ./gradlew assembleRelease --no-daemon)
npx sabeel-ci check-release app/android/app/build/outputs/apk/release/app-universal-release.apk --out shots/release-check
```

**Signing.** `signingConfigs.release` reads
`~/.config/sabeel-kanban/keystore.properties`, or the file
`SABEEL_KEYSTORE_PROPERTIES` names, which is how CI hands Gradle the key
(`sabeel-ci ci-platform prepare-android` writes it from the `release-build`
secrets). Without it the release signing configuration stays empty and Gradle
refuses to package a release: it fails closed, never falling back to the debug
key. The debug keystore is committed to this **public** repo, so a release
signed with it could be reproduced by anyone with a clone; `sabeel-ci
build-aab`, `publish-play` and `release --ship` each refuse a debug-signed
artifact as well.

The debug keystore is still committed and its SHA-1 still registered, on purpose:
it is what makes `npm run dev:android` sign in without per-machine setup. The
residual is unchanged and accepted — a malicious build carrying that key and this
package name is indistinguishable to Google Sign-In. What bounds it is that
sign-in is `@oursabeel.com`-only and admin-gated, and that a dozen colleagues
install deliberately. If that ever stops being true, replace the committed debug
keystore with a per-machine one and register those fingerprints instead.

## Verify after deploy — do not skip

**1. Composite indexes (REQUIRED).** The emulator does NOT enforce them, so only
production can confirm they exist and are built. Exercise each indexed query:

- Open a board (needs `cards: archived + rank`).
- Open **My work** (needs the `cards` collection-group index on
  `assigneeUids + archived + dueDate`).
- Open **Alerts** (needs `notifications: read + at`).

A missing index surfaces as a listener error with a link that creates it. If you
see one, add the definition to `firestore.indexes.json` too — the console link
creates it in the project only, and the repo is the source of truth.

**2. Callables are reachable.** An unauthenticated

```sh
curl -X POST https://us-central1-<project>.cloudfunctions.net/setUserAccess -d '{"data":{}}'
```

should return a Firebase JSON error (`UNAUTHENTICATED`) — meaning your code ran.
A plain Cloud Run "request was not authenticated" 403 means the public-invoker
binding was never applied. See the trap below.

**3. Sign in end to end** with a real `@oursabeel.com` account, and confirm a
non-org account is rejected. When the sign-in or rules changed, also sign in
through **Sign in with email** as `apps-reviewer@oursabeel.com` (password in the
vault): it reaches the App Review board and nothing else.

**4. Report a problem sends.** After a deploy that touched `reportProblem`, or
the IAM grant or delegation it rests on, send one report from the app (**More →
Report a problem**). It should arrive at `apps-reports@oursabeel.com` within a
minute, from "Sabeel Apps No Reply", with Reply-To the sender, and
`reports/{id}` should show `mail.status: 'sent'` with Gmail's `messageId`. A
`failed` status names the step in `mail.error`: *signing* is the IAM grant in
§ Prerequisites, *exchanging* is the Admin console's delegation entry, *sending*
is the Gmail API. Such a report was kept; nothing re-sends it.

## Known traps

These cost real time on the sibling time-tracker project; see
`docs/INHERITED-STACK.md` for the full accounts.

**Callables permanently 403 after a failed first deploy.** Gen-2 callables get
their public-invoker IAM binding only on the *create* path. If the first deploy
creates the function but the build fails, later deploys never re-apply it and
every call bounces at the Cloud Run layer before your code runs. Fix by forcing
recreation:

```sh
firebase functions:delete accountExists setUserAccess removeBoardMember \
  addBoardMember listAddableUsers countMemberAssignments \
  boardsSolelyOwnedBy countLabelUsage deleteLabel \
  finalizeAttachment deleteAttachment getAttachmentUrl \
  --region us-central1 --force
firebase deploy --only functions
```

**First deploy of a Firestore-trigger function fails on the Eventarc service
agent.** Not a config error — permissions take 2–5 minutes to propagate. Wait,
then redeploy just the failed functions.

**Functions must be esbuild-bundled.** Already configured. `functions/build` is
`tsc --noEmit` plus `node esbuild.config.mjs`; the bundle inlines the private
`@sabeel/shared` package, which Cloud Build cannot otherwise resolve.

**Functions deploy from `functions/package-lock.json`.** A deploy uploads the
functions directory alone, and without a lockfile in it the Node buildpack
generates one; its npm crashes doing that here (`Cannot read properties of null
(reading 'edgesOut')`, in arborist's peer resolution), so every function without
a cached build failed. With the lockfile the buildpack runs `npm ci`. When
`functions/package.json` changes, regenerate it from that file alone, top-level
versions pinned to what the suites ran against, with npm 11 (npm 10 hits the same
crash generating it, though it installs from the result fine):

```sh
mkdir /tmp/fnlock && cp functions/package.json /tmp/fnlock/
# pin each dependency in /tmp/fnlock/package.json to the version in node_modules
cd /tmp/fnlock && npm install --package-lock-only --ignore-scripts
# put functions/package.json's own ranges back in the lock's packages[""] block
npx -y npm@10 ci --dry-run --omit=dev    # what the buildpack runs; must pass
```

`npx sabeel-ci check-app` (in CI's quality job) fails when the lock's root
block and `functions/package.json` disagree, which `npm ci` would otherwise
reject only at deploy time, and `functions/test/unit/functionsLockfile.test.ts`
fails when the lock does not resolve a runtime dependency.

**`expo export` must always `--clear`.** `sabeel-ci build-web` (`web:export`)
always passes it. Metro would otherwise serve a bundle built with different
`EXPO_PUBLIC_*` values, and an emulator-mode bundle must never reach Hosting.

## Shipping a release

`android/` is committed; there is no EAS. A ship touches **the backend when it
changed, web, the versioned GitHub release, Play internal testing and
TestFlight**, and they go out in one batch after Faisal's go-ahead. **Do not run
the Gradle or `gh release` steps by hand**: `npx sabeel-ci release` (ci-tools)
encodes them and their checks, and skipping it is how versions and stamps drift
apart. The version is X.Y.Z, written only in `app/app.json`; Android's
versionCode and the iOS build number are both `major * 1000000 + minor * 1000 +
patch` (0.12.2 is 12002), and each version must be above main's and every
released tag's.

```sh
# 0. CI green on main; the AVD free for the release check (--ship boots it).

# 1. Backend, when functions, rules or indexes changed, BEFORE the clients that
#    need it. Indexes first; a deploy-log entry that needs another order (such as
#    functions before rules) states it. Functions can also go through Deploy
#    Functions (docs/GITHUB-ACTIONS.md).
npx firebase deploy --only firestore:indexes --project sabeel-institute-kanban
npx firebase deploy --only firestore:rules,storage,functions --project sabeel-institute-kanban

# 2. The deploy-log entry, heading first, kept outside the checkout (--ship
#    refuses an untracked file):
#      ### 2026-11-02 — <summary> — v0.13.0
#      <the release notes>
#    then the release pull request; Faisal merges it once its checks pass.
npx sabeel-ci release 0.13.0 --notes ../v0.13.0.md

# 3. Ship the merged commit from main: bundle, APKs, AVD check, tag, Play.
git switch main && git pull --ff-only
npx sabeel-ci release --ship

# 4. The web and the iPhones, from the same commit: the two runs --ship prints.
gh workflow run web-deploy.yml -R Sabeel-Institute/sabeel-institute-kanban -f build_run_id=<the Web run for that commit> -f deploy=true
gh workflow run ios.yml -R Sabeel-Institute/sabeel-institute-kanban --ref v0.13.0 -f testflight=true
```

`npx sabeel-ci release X.Y.Z --notes <entry>` works from origin/main in a
worktree of its own: it writes the version and the iOS build number in
`app/app.json`, moves the manual's version line and renders the manual PDF,
adds the entry to the deploy log in `docs/PHASE_STATUS.md`, commits that on
`release/vX.Y.Z`, pushes the branch and opens the pull request, titled and
described by the entry. `--dry-run` shows the change and leaves nothing behind.

`--ship`, on main after the merge, refuses unless main is clean and matches
origin/main, then builds the AAB (`sabeel-ci build-aab`'s gates), checks it and
Play's permission (`publish-play --check`), builds the APKs and refuses one not
signed with the bundle's key, cold-starts the universal APK on the AVD five
times (`sabeel-ci check-release`), creates the versioned GitHub release with
its tag on that commit — the APKs and `docs/USER-MANUAL.pdf` attached, titled
and described by the deploy-log entry — and publishes to Play internal testing
last, because that reaches every tester's phone by itself. If Play refuses,
the GitHub release stands; `npx sabeel-ci publish-play --internal` reruns that
step alone. No personal website or Pages credentials are required.

The tag is the release: Deploy Web publishes the Web workflow's artifact of the
same commit, after checking its provenance, and the iOS run builds the tag, so
every surface carries one commit. Its TestFlight job stops in seconds unless the
commit is the one tagged `v<version>` and App Store Connect has not taken the
build number (`sabeel-ci testflight-check`); each version goes to TestFlight
once.

**The artifacts carry the commit they were built from.** `--ship` builds from
main's HEAD after the merge, and `publish-play` refuses a bundle whose
JavaScript does not carry HEAD's commit, or carries it marked `+` (built from
uncommitted changes), so a superseded build cannot go out by accident.

Before sharing any build, **read the version back from the artifact, not from
your notes.** Web: load the live site and read the stamp. Android: the release
check reads it off the sign-in screen of the APK that ships, and the Android
workflow runs the same check on every bundle it builds; the e2e suite asserts
the web bundle has no dev sign-in row on every run.

The **deploy-log entry in `docs/PHASE_STATUS.md` is mandatory and comes first**
— `sabeel-ci build-aab` and `build-ios` refuse without one, and `release`
takes the pull request's and the GitHub release's title and notes from it
(`npx sabeel-ci deploy-notes <version>`). It is the only record of why a
release exists.

### Play specifics

- Uploading is **scripted**: `npx sabeel-ci publish-play --internal` does the
  whole draft/upload/signing check/completion cycle, and `--check` proves the
  gates and the Play permission without uploading. The console is only needed
  for things the API cannot do — permissions, testers, and reading the
  app-signing fingerprints. Play is never published automatically: `--ship`
  publishes from the release machine, and the manual **Publish Android**
  workflow publishes a bundle CI built (`docs/GITHUB-ACTIONS.md`).
- Testers: § Testers above. Internal app sharing is not supported; § Publishing
  from the command line says why.
- `versionCode` is derived from the semver (`major*1000000 + minor*1000 + patch`),
  so it increases on its own. Play rejects a duplicate outright, which is the
  backstop.
- Processing takes a few minutes before a build appears on the testing track.
- Tagging a GitHub release at a commit whose `.github/workflows` differs from
  the default branch needs the `workflow` token scope
  (`gh auth refresh -h github.com -s workflow`). `--ship` tags main's HEAD, so a
  normal ship never hits it.

## Rollback

Hosting keeps previous releases — roll back from the console in one click.
Functions and rules do not: redeploy the previous commit. For Firestore data, see
disaster recovery below — boards still archive rather than delete, and only a
board's owners and admins may permanently remove cards, because prevention beats
restoring.

### Restoring across the label migration

A restore from a backup taken **before 2026-07-27** brings back boards that still
carry a `labels` array and a `labels` collection that may be missing entries. The
deployed rules reject a board write containing that field, so managers would find
those boards uneditable, and any label not in the collection would render as
nothing on its cards.

Re-run the migration after such a restore:

```
GCLOUD_PROJECT=sabeel-institute-kanban node scripts/migrate-global-labels.mjs part-a
GCLOUD_PROJECT=sabeel-institute-kanban node scripts/migrate-global-labels.mjs part-b
```

Both are idempotent and both abort rather than guess — part A on a duplicate id
or a label the rules would refuse, part B if anything has not been copied yet.

### Restoring across the board-ownership migration

A restore from a backup taken **before 2026-08-16** brings back boards with no
`boardOwnerUids` and user documents that may still say `manager`. Both are silent
failures rather than errors:

- a board without the field is administrable **by admins only**, forever, and
  nothing on screen says why;
- `manager` is a role no rule matches, so the account signs in, is shown a
  member's app, and holds a claim that means nothing.

Two scripts put it back, **in this order**, because the second one is what makes
the first one's owners able to act — and `rename-manager-role.mjs` now refuses to
run while any active board is still missing `boardOwnerUids`, so the order is
enforced rather than merely written down:

```sh
GCLOUD_PROJECT=sabeel-institute-kanban node scripts/backfill-board-owners.mjs           # dry run
GCLOUD_PROJECT=sabeel-institute-kanban node scripts/backfill-board-owners.mjs --apply
GCLOUD_PROJECT=sabeel-institute-kanban node scripts/rename-manager-role.mjs --apply
GCLOUD_PROJECT=sabeel-institute-kanban node scripts/verify-board-owners.mjs
```

The backfill seeds each board's creator and **nothing else** — it deliberately
writes an empty list where the creator is no longer a member, and names those
boards in its report for an admin to assign by hand. It aborts outright on a
board with no `createdBy`. Both are idempotent.

`rename-manager-role.mjs` writes a manifest to `migration/` **before** it changes
a claim, and that file is the only way back: custom claims are in no backup at
all (see below). Reverse it with
`node scripts/rename-manager-role.mjs --revert <manifest> --apply`. It also
refuses to run while any active board is still missing `boardOwnerUids`, so the
order above is enforced rather than merely written down.

**Rehearse against the shape first if there is time.**
`scripts/dump-migration-shape.mjs` reads the database and writes a redacted
structure — no names, no addresses, no board titles, no cards — which
`scripts/migration-e2e.mjs --shape <file>` replays through the whole sequence on
the emulators. It answers the question the seeded fixtures cannot: does this
work on the database that actually exists. See `docs/DEV-TOOLING.md`.

**A restore cannot undo the backfill.** An import merges by document id, so it
recreates what was deleted and cannot remove what was wrongly *added* — a field
addition is outside the backup's reach entirely. The undo is
`scripts/unbackfill-board-owners.mjs`, and it only helps while rules that do not
require the field are live. All four scripts are exercised end to end by
`scripts/migration-e2e.mjs`, which `npm run test:emulator` runs first in its
rules pass, and so CI on every push.

## Backups and disaster recovery

Two native Firestore layers, both Google-managed settings with no code to
maintain. They do different jobs and compose:

| Layer | Window | What it answers |
|---|---|---|
| **PITR** | rolling **7 days** | "someone deleted it this morning" — rewind to any microsecond |
| **Daily backup** (98-day retention) | **14 weeks** | "we noticed in September that something broke in July" |

98 days is Firestore's **maximum** retention — it will not keep a backup longer.
Both PITR and backup data are **excluded from the free tier** and need billing
enabled (this project is on Blaze); at this data size they bill as fractions of a
cent, but they are a real line item, not zero.

**Delete protection is ENABLED**, so the database itself cannot be deleted until
someone deliberately turns it off.

```sh
# enable (one-time)
firebase firestore:databases:update "(default)" --point-in-time-recovery ENABLED
firebase firestore:backups:schedules:create --recurrence DAILY --retention 98d
firebase firestore:databases:update "(default)" --delete-protection ENABLED

# inspect
firebase firestore:databases:get "(default)"   # PITR + delete-protection state
firebase firestore:backups:schedules:list      # schedule + retention
firebase firestore:backups:list                # backups actually taken
```

### Restoring — read this BEFORE you need it

A restore **always creates a NEW database**. There is no restore-in-place, and
the destination id *cannot be one already in use* — so you can never restore
directly over `(default)`, the database every client is configured for.

**Do not plan to "just repoint the app."** Repointing the web is a redeploy, but
repointing an installed Android client is a **new build every user has to
install** — recovery time becomes an app-store round trip. Bring the data back to
the id the clients already use instead:

1. **Restore to a scratch database.**
   `firebase firestore:databases:restore --database recovery-YYYYMMDD --backup <backup-name>`
   (For PITR, recover using a `--snapshot-time` within the last 7 days.)
2. **Verify the scratch copy** actually contains what you expect before touching
   anything live — count boards/cards/users, spot-check a board.
3. **Managed-export the scratch database** to a Cloud Storage bucket, then
   **import it back into `(default)`**.
4. **Delete the scratch database.** Clients never notice any of this.

Two things that bite mid-incident:

- **Import merges by document id.** It recreates what was deleted, but it does
  **not** remove anything that was wrongly added — a clean fix for a deletion,
  only a partial one for a corruption.
- **Backups do not contain security rules, indexes, IAM or TTL policies.** A
  restored database comes up needing them reapplied. Cheap here, because they are
  config-as-code: `firebase deploy --only firestore` puts them back.

### Firebase Auth is NOT in any backup

Firestore backups cover Firestore only. Auth is a separate system, and a uid is
not cosmetic — `memberUids`, `assigneeUids`, `createdBy` and `authorUid` all
reference it. Letting people simply sign in again would mint **new random uids**
and leave a database that restores "successfully" while being quietly wrong
everywhere.

No separate Auth backup is needed, because the roster already lives in Firestore:
`onUserCreate` writes `users/{uid}` with displayName, email, role and status, and
the **doc id is the uid**. So restore Firestore first, then:

```sh
GCLOUD_PROJECT=sabeel-institute-kanban node scripts/restore-auth.mjs           # dry run
GCLOUD_PROJECT=sabeel-institute-kanban node scripts/restore-auth.mjs --apply
```

It recreates each account with its **original uid** and re-applies the `role` /
`status` **custom claims** — which matter because `firestore.rules` trusts the
token, not the user doc; an account restored without claims can sign in and then
do nothing. It is idempotent and never deletes. Everyone must sign in again
afterwards to pick up a token carrying their claims.

**Unproven step:** whether a Google sign-in attaches cleanly to a restored
account with a matching email and uid has not been exercised yet — it is the main
thing the restore drill (TODO.md) is meant to settle. If it refuses to link, the
fallback is `firebase auth:export`, which preserves provider linkage explicitly.

### Detection — the `healthCheck` canary

Retention only helps if the problem is noticed while a good backup still exists.
The bad case is a corruption just before a quiet period: every later backup
faithfully captures the broken state, and by the time anyone looks the last good
one has aged out. `functions/src/health.ts` runs daily at 03:15 (org timezone)
and:

- counts documents per collection using `count()` aggregations, never full reads
  (subcollections — comments, activity, notifications — go through
  `collectionGroup`);
- compares against the previous run stored at `meta/health` (operator state; the
  rules catch-all denies all client access, pinned by a rules test);
- raises to Sentry when a collection shrinks past its tolerance. `boards`,
  `activity` and `users` have **zero tolerance** (the rules forbid deleting the
  first two outright; users go only by deliberate admin action), while `cards`,
  `comments` and `notifications` tolerate `max(5, 20%)` since routine deletion is
  normal there;
- sends a Sentry **cron check-in**, so the job going *silent* is itself an alert.

Tune the thresholds in `DROP_RULES`. It always re-baselines, so a single bad day
alerts once rather than forever. Known limitation: it compares run-to-run, so a
slow bleed of a few documents a day stays under the threshold — it is built to
catch sudden loss, which is what accidents and bad deploys look like.

**When it fires:** check PITR first (`earliestVersionTime` tells you how far back
you can still go), decide whether the drop was legitimate, and if not, follow the
restore steps above while the 7-day window is still open.

**Remaining gap.** Beyond 14 weeks Firestore cannot retain natively; the cheap
mitigation is a deliberate managed export to Cloud Storage before a long break.
