# Deploy guide

Everything through Phase 12 runs against the emulators with no real project.
Deploying is the point where the console steps in `TODO.md` must be done first.

## Prerequisites

1. Complete `TODO.md` sections B, C and D — Firebase project (Blaze), Google
   sign-in enabled, OAuth consent screen **External and published** (see
   TODO.md § C for why not Internal), Web and Android apps registered, SHA-1
   added, `google-services.json` downloaded.
2. Put the real project id in `.firebaserc`.
3. Replace the placeholder config in `app/src/firebase-config.ts` with the real
   web config. **Keep `EMULATOR_PROJECT_ID` as it is** — it is what makes local
   development point at the emulators.
4. Optional but recommended: `firebase functions:secrets:set SENTRY_DSN`.

## Deploy

```sh
# Indexes FIRST — they take minutes to build, and queries error until they exist.
firebase deploy --only firestore:indexes

# Then rules, functions and the web app.
firebase deploy --only firestore:rules,storage,functions,hosting
```

It is `storage`, **not** `storage:rules`. The `storage` block in `firebase.json`
is a single unnamed config, so a named target does not exist and `storage:rules`
errors with "Could not find rules for the following storage targets: rules".

Hosting serves `app/dist-web`, built automatically by the predeploy hook.

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

## Public download page — the developer's pre-release route

Un-retired 2026-08-03. Testers get Android builds from **Play internal
testing**; this channel exists for one thing Play cannot do for this app —
letting the developer test a release build *before* the testers see it, from a
phone, away from the build machine.

Play's feature for exactly that is internal app sharing, and it **refuses this
app**: it requires the app to have been published, and internal-testing releases
do not count. The dashboard shows why — "Draft app", internal testing "Active ·
Not reviewed". For an internal tool that may never change.

```
npm run build:apk                 # release-signed, per-ABI
SK_CHECK=1 scripts/publish-apk.sh # dry run: every gate, uploads nothing
scripts/publish-apk.sh            # replaces the rolling asset + cuts the release
```

**The signature rule is permanent.** An APK from here is signed with the
**upload key**; a Play install is signed with **Google's app signing key**.
Neither can install over the other — Android refuses with a signature mismatch
and says only "App not installed". Uninstall first; nothing is lost, because all
state is in Firestore.

That rule is also why this was retired for a day: the frozen asset was the last
debug-signed build, and replacing it would have stranded everyone who had it.
The team has since moved to Play, so the only sideload install left is the
developer's.


## Android releases — Google Play

```sh
npm run build:aab
# outputs app/android/app/build/outputs/bundle/release/app-release.aab
```

Then Play Console → Testing → Internal testing → Create new release.

`build-aab.sh` holds the gates the old publish script did: a store-legal version,
a deploy-log entry that exists **before** the build, and a refusal to proceed on
a debug signature. Play wants one bundle carrying every ABI and does its own
per-device splitting, so the `splits` block turns itself off for bundle tasks —
leaving both on fails with *"Multiple shrunk-resources files found"*.

### Four SHA-1s, because there are four signing identities

All four belong in Firebase; each covers a different way the app gets onto a
device, and a missing one fails only for that route:

| Build | Signed with | Needed for |
|---|---|---|
| `npm run dev:android`, `expo run:android` | committed debug keystore | day-to-day development |
| `npm run build:apk` (sideload) | upload key, `~/keys/…jks` | quick testing of a real release build |
| installed from Play | **Google's app signing key** | everyone actually using the app |
| **Internal app sharing link** | **Play's internal test certificate** | handing a build to a developer without shipping it to the testers |

The last two are the ones that get forgotten, and for the same reason: **Play
re-signs whatever you upload**, so the key you built with is not the key the
installed app runs under.

- Play App Signing: Play Console → App integrity → *App signing key
  certificate*. Miss it and sign-in fails with `DEVELOPER_ERROR` for Play users
  only, while every build on your own machine works — so it reads as a device
  problem.
- **Internal app sharing has its OWN certificate**, separate from both of the
  above: Play Console → Testing → Internal app sharing → *Internal test
  certificate*. Enabled 2026-08-03 so a build can go to a developer without
  becoming an update for the Sabeel testers on the internal testing track. Its
  SHA-1 must be registered too, or sign-in fails on exactly those builds and
  nothing else.

**A shared build cannot install over a Play-installed one.** Different signing
key means Android refuses the update with a signature mismatch — uninstall
first, and uninstall again to go back. Same package name, so only one at a
time. (The `.debug` variant is a different package and does sit alongside both.)

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
   per registered SHA-1 — debug, upload key, Play's app signing key, and the
   internal-app-sharing certificate — each marked "Auto created by Google
   service", which is Firebase creating them when a fingerprint is added.
   Several entries for one package is correct, not a duplicate.
   **Which install is it?** If sign-in fails on a build you got from an internal
   app sharing LINK but works on one from the internal testing track, it is the
   internal test certificate that is missing, not the app signing key — they are
   different certificates and the symptom is identical.
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

The one thing with a real horizon is the **website APK download**: by the 2027
global rollout, an app sideloaded from a page rather than a store needs its
signing key registered under Play Console -> Android developer verification.
Retiring that channel resolves it; so would registering the upload key there.

### What to back up, and what to regenerate instead

Three files sit in `~/keys`. They are not equivalent, and treating them the same
is how people end up with a backup that cannot sign and a credential copied
somewhere it did not need to be.

| File | Back up? | Why |
|---|---|---|
| `sabeel-kanban-upload.jks` | **Yes** | Cannot be recreated. Losing it is recoverable only through a Play upload-key reset |
| `app/android/keystore.properties` | **Yes, with it** | The keystore is **useless without these passwords** — this is the half that gets forgotten |
| `sabeel-play-publisher.json` | **No** | Mint a fresh key in seconds; another copy is only another thing to leak |
| `upload_certificate.pem` | No | Public certificate, re-exportable from the keystore and downloadable from Play Console |

**The keystore and its passwords travel together or not at all.** Backing up the
`.jks` alone produces a file nobody can open. Backing up
`keystore.properties` alone produces passwords for a keystore that no longer
exists. Whether they live in the same place is a real choice: one folder is
convenient and means a single compromise yields both; passwords in a password
manager and the keystore in Drive is the safer split. Pick deliberately.

**Losing the upload key is friction, not death.** Under Play App Signing, Google
holds the *app signing* key — the one that actually has to stay constant — so a
lost upload key is reset through Play Console support and updates resume. The
app signing key is the one that can never be replaced, and it is not on this
machine.

**The service-account key is deliberately NOT backed up.** It is regenerable:
Google Cloud → *IAM & Admin → Service Accounts* → the publisher account → *Keys →
Add key → JSON*, then delete the old one. That is also the rotation procedure, so
"lost it" and "might be exposed" have the same one-minute answer. What is worth
recording instead is the **pointer** — which Google Cloud project and which
`…iam.gserviceaccount.com` address — because that is the part you would otherwise
have to go hunting for. It is org-scoped, not app-scoped: one account publishes
every app, so this is a single note, not one per app.

### Publishing from the command line, without a browser

`npm run publish:play` uploads the release AAB through the Google Play Developer
API, so a build can reach a phone when nobody is at the computer that built it.

```
npm run publish:play -- --check      # every gate + the Play permission, uploads nothing
npm run publish:play -- --internal   # publish to the internal testing track
```

**There is one destination, and it must be named.** Publishing is a release to
the whole tester list, so a bare invocation prints help and refuses rather than
guessing; unrecognised flags are refused too. The flow is edit → upload → point
the track at the new `versionCode` → commit, and a failure discards the edit.

**Internal app sharing was removed, not left as a broken flag.** It is the
obvious tool for handing one build to one person, and it refuses this app: it
requires the app to have been **published**, and internal-testing releases do not
count. The dashboard shows why — *"Draft app"*, internal testing *"Active · Not
reviewed"*. For an internal tool that may never change, and publishing would mean
a real store listing, content rating, data safety and review, plus handing Google
working credentials for an app restricted to `@oursabeel.com`.

The support was written, proved not to work against the live API and by hand in
the Console, and then deleted — an option that cannot succeed is a trap that
costs somebody an evening. The reasoning is kept here so it is not re-derived.
**The developer's pre-release route is the APK download page**, above.

**Gates, before anything leaves the machine.**

- A store-legal version, and a deploy-log entry that already describes it.
- A destination must be named, and unknown flags are refused, so no typo can
  reach the publish path.
- **The bundle must SAY it is this version.** The versionName is read out of
  `base/manifest/AndroidManifest.xml` inside the AAB and compared with
  `app.json`. This started as an mtime comparison and was defeated the first
  time it was tested: copying the file back after an experiment refreshed its
  timestamp, and a bundle whose contents said 0.7.4 passed as 0.7.5. A timestamp
  describes the file, not the build. mtime survives only as a secondary note.
- **The signature must not be the debug key**, checked here and not merely
  trusted from `build-aab.sh`. Play would reject a wrong upload key anyway, but
  failing here names the problem instead of making Play do it.

`--check` runs all of it, proves the Play permission by creating and discarding
an edit, and uploads nothing. **Every artifact gate is advisory there and fatal
on a real run** — the bundle may be missing, stale or the wrong version and
`--check` will still tell you whether the credentials and permissions work,
because that is the state you are in *before* rebuilding and the question
`--check` exists to answer. It reports what a real run would refuse, and will not
claim "gates pass" when one of them would.

**One credential for every app, named for the ACCOUNT not the app.** A Play
service account belongs to the developer account and is scoped per-app by Play
Console permissions, so one key publishes them all and a second app needs no new
credential — only a tick box. That is the opposite of the upload **keystore**,
which is per-app and stays app-named (`sabeel-kanban-upload.jks`). Every sibling
repo can copy this script and find the same key with no configuration.

**The credential lives at `~/keys/sabeel-play-publisher.json`** (override with
`SK_PLAY_KEY`), beside the upload keystore and for the same reason: this repo is
PUBLIC, and a service-account key committed once is a publish credential for the
app that stays readable in history no matter what a later commit removes.
`.gitignore` carries a name-pattern backstop, but the file should simply never be
inside the repo.

One-time setup, all of it in consoles:

1. **Google Cloud** → the project already backing Firebase → *APIs & Services* →
   enable **Google Play Android Developer API**.
2. **IAM & Admin → Service Accounts** → create one (a name like
   `sabeel-play-publisher`), then *Keys → Add key → JSON*. That download is the
   only copy; Google keeps none.
3. **Play Console → Users and permissions → Invite new user** → the service
   account's `…iam.gserviceaccount.com` address → grant it on **this app only**,
   with **Release apps to testing tracks**. That single permission covers
   internal app sharing as well.
4. `chmod 600 ~/keys/sabeel-play-publisher.json`.
5. `npm run publish:play -- --check`.

**Sign-in on a shared build needs the internal-app-sharing SHA-1**, which is a
fourth certificate distinct from the upload key and Play's app signing key — see
the table above. Miss it and Google sign-in fails on exactly those builds and
nothing else. Registering it is server-side only: no rebuild, no
`google-services.json` re-download, so it can be done from a phone.

**A shared build cannot install over a Play-installed one** — different signing
key, so Android refuses it as a signature mismatch. Uninstall first; nothing is
lost, because all state is in Firestore.

### Building a sideloadable APK

Still supported and unchanged; it is just no longer published anywhere:

```sh
npm run build:apk
# outputs app/android/app/build/outputs/apk/release/app-<abi>-release.apk
```

Per-ABI splits plus R8 take arm64 from 82 MB to 27 MB. Both R8 flags are ON in
`gradle.properties` and both are OFF by default in the React Native template.

**`./gradlew clean` can fail** in `externalNativeBuildCleanDebug` while CMake
regenerates. Delete the caches instead:

```sh
rm -rf app/android/app/.cxx app/android/app/build
```

**After any change to R8 or splits, install and RUN the result** — R8 strips
classes reached only by reflection, and Google Sign-In is exactly that kind of
dependency. A smaller APK that crashes on launch is worse than a large one that
works:

```sh
adb install app/android/app/build/outputs/apk/release/app-x86_64-release.apk
adb shell monkey -p com.sabeelinstitute.kanban -c android.intent.category.LAUNCHER 1
adb exec-out screencap -p > shots/check.png     # then LOOK at it
```

**Signing.** `signingConfigs.release` reads a gitignored
`app/android/keystore.properties`; without it the build still works but is
debug-signed and says so loudly. Everything up to and including v0.7.4 shipped
that way, signed with the debug keystore committed to this **public** repo, so
anyone with a clone could sign an update Android would accept as this app. That
is closed for release builds.

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
non-org account is rejected.

## Known traps

These cost real time on the sibling time-tracker project; see
`docs/INHERITED-STACK.md` for the full accounts.

**Callables permanently 403 after a failed first deploy.** Gen-2 callables get
their public-invoker IAM binding only on the *create* path. If the first deploy
creates the function but the build fails, later deploys never re-apply it and
every call bounces at the Cloud Run layer before your code runs. Fix by forcing
recreation:

```sh
firebase functions:delete setUserAccess removeBoardMember countMemberAssignments \
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

**`expo export` must always `--clear`.** Configured in `web:export`. Metro will
otherwise serve a bundle built with different `EXPO_PUBLIC_*` values, and an
emulator-mode bundle must never reach Hosting.

## Shipping a release

`android/` is committed; there is no EAS. A ship touches **web, the APK download
page, and Play**, and they go out in one batch after Faisal's go-ahead. (iOS is
its own runbook, `docs/IOS-BUILD.md`: from the Mac, or from GitHub's `ios.yml`.)

```sh
# 0. app/app.json version + the deploy-log entry in docs/PHASE_STATUS.md
# 1. WRITE THE "What's new" PARAGRAPH on the download page — see below, nothing checks it
git push origin main            # FIRST — a release attaches to a commit GitHub already has
npm run web:export -w @sabeel/app
npm run check:web-push      # the VAPID key actually reached the bundle
npx firebase deploy --only hosting --project sabeel-institute-kanban
npm run build:apk && scripts/publish-apk.sh          # download page + versioned GitHub release
npm run build:aab && npm run publish:play -- --internal   # the team, via Play
```

**Push before publishing.** `publish-apk.sh` cuts a GitHub Release, which cannot
attach to a commit GitHub has not seen — shipping v0.7.0 failed at exactly that
step with `target_commitish is invalid`.

**Build the artifacts AFTER the last commit.** Both `build:apk` and `build:aab`
stamp the running commit onto the sign-in screen. An artifact built earlier
carries a superseded hash, so rebuild if anything landed since — the version
gate will not catch it, because the version is still right.

**The download page's "What's new" paragraph is hand-written and nothing checks
it.** The script owns the version, the timestamp and the download size, and
asserts all three. The prose it sits beside does not update itself: it spent four
releases advertising 31 MB and, until v0.7.5, still announced the move to Google
Play beside a live download button. Write it in
`../faisal-shah.github.io/sabeel-kanban/index.html` before publishing.

**The rolling GitHub release is script-owned too**, from the same three values.
Its title and body used to be hand-written: the body said "Current build:
v0.1.10" for four months while the asset under it was replaced eleven times, and
GitHub shows the tag's July creation date beside it, so the page read as an
artefact from another era. Nobody is meant to land there — the download button
links straight to the asset URL — but it is public. The script now writes both
and asserts the result, and **refuses to publish if `kanban-latest` carries any
asset other than the one APK**: it had quietly accumulated a
`sabeel-kanban-0.7.4.aab`, and a release page offering two files while naming
the wrong one is worse than one offering none.

Before sharing any build:

1. **Install it and screenshot the sign-in screen** — the dev sign-in row must be
   absent, and the version/commit stamp must be the build you just cut. The e2e
   suite asserts this for the web bundle on every run; a store build deserves the
   same one-off check, read off the running app rather than inferred.
2. **Read the version back from the artifact, not from your notes.** Web: load the
   live site and read the stamp. Android: install and look. This has caught a
   stale bundle more than once.

The **deploy-log entry in `docs/PHASE_STATUS.md` is mandatory and comes first** —
`build-aab.sh` refuses to build without one, the same guarantee `publish-apk.sh`
used to enforce by reading its release notes from it. It is the only record of
why a release exists.

### Play specifics

- Uploading is **scripted**: `npm run publish:play -- --internal` does the whole
  edit/upload/track/commit cycle, and `-- --check` proves the gates and the Play
  permission without uploading. The console is only needed for things the API
  cannot do — permissions, and reading the app-signing fingerprints. Play is
  deliberately **never deployed from CI** (see `CLAUDE.md`).
- Internal app sharing is deliberately not supported; see above for why.
- `versionCode` is derived from the semver (`major*1000000 + minor*1000 + patch`),
  so it increases on its own. Play rejects a duplicate outright, which is the
  backstop.
- Processing takes a few minutes before a build appears on the testing track.
- Historic note: tagging a GitHub release at a commit whose `.github/workflows`
  differs from the default branch needs the `workflow` token scope
  (`gh auth refresh -h github.com -s workflow`). Only relevant if versioned
  GitHub releases are ever cut again — a normal ship tags HEAD and never hits it.

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
work on the database that actually exists. See `docs/DEVELOPING.md`.

**A restore cannot undo the backfill.** An import merges by document id, so it
recreates what was deleted and cannot remove what was wrongly *added* — a field
addition is outside the backup's reach entirely. The undo is
`scripts/unbackfill-board-owners.mjs`, and it only helps while rules that do not
require the field are live. All four scripts are exercised end to end by
`scripts/migration-e2e.mjs`, which CI runs on every push.

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
