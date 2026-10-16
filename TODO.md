# Faisal's setup checklist — things only you can do

Console, account and secret-handling steps Claude can't (or shouldn't) do.
Claude keeps this file current; you tick items off. Each item says **what to do**
and **what to hand back**.

**Nothing here blocks Phases 0–12** — everything runs against the Firebase
emulators until the production deploy at Phase 13. Do the Sentry and GitHub bits
whenever; leave the rest until Phase 12/13 if you like.

**Never paste a secret into chat.** Client Firebase config and the Web OAuth
client ID are *not* secrets and are committed. DSNs, service-account keys and
tokens are — they go in gitignored files or Secret Manager, and Claude only ever
tells you the command to run.

---

## Play publishing from the command line — **DONE, verified 2026-08-29**

All five steps below are ticked because they were *exercised*, not because
someone remembered doing them: `npm run publish:play -- --internal` uploaded
v0.11.3 as versionCode 11003, and `-- --check` created and discarded a real
edit first, which is what proves the service account can actually release.

So a build can reach your phone when you are away from this machine. Everything
below is console work; the script is already written (`npm run publish:play`).

- [x] **Enable the API.** Google Cloud Console → the project already backing
      Firebase → *APIs & Services → Library* → **Google Play Android Developer
      API** → Enable.
- [x] **Create the service account.** *IAM & Admin → Service Accounts → Create*,
      name it `sabeel-play-publisher`. No project roles are needed — its power
      comes from Play Console, not IAM. Then *Keys → Add key → Create new key →
      JSON*. **That download is the only copy.**
- [x] **Give it Play access.** Play Console → *Users and permissions → Invite new
      user* → paste the service account's `…iam.gserviceaccount.com` address →
      restrict it to **this app** → tick **Release apps to testing tracks**.
      That one permission also covers internal app sharing. Send the invite.
- [x] **Put the key where the script looks:**
      ```
      mkdir -p ~/keys
      mv ~/Downloads/<the-file>.json ~/keys/sabeel-play-publisher.json
      chmod 600 ~/keys/sabeel-play-publisher.json
      ```
      **Never inside the repo — it is public.** Hand back nothing; do not paste
      any part of it into chat.
- [x] **Confirm it works:** `npm run publish:play -- --check`. It runs every
      gate and proves the Play permission by creating and discarding an edit —
      a key mints a token whether or not Play granted it anything, so this
      checks the thing that actually fails. Uploads nothing.
- [x] **Internal app sharing is NOT available to this app** — it requires the
      app to have been published, and internal-testing releases do not count
      (confirmed in Play Console, 2026-08-03). Nothing to do; `--internal` is
      the channel until the app is published. The SHA-1 below was registered
      anyway and will be needed the day it does unlock.
- [ ] **Register the internal-app-sharing SHA-1** in Firebase, if not already:
      Play Console → *Testing → Internal app sharing → Internal test
      certificate* → copy the SHA-1 → Firebase Console → Project settings →
      Android app `com.sabeelinstitute.kanban` → *Add fingerprint*. Without it
      Google sign-in fails on shared builds **and nothing else**, which reads as
      a device problem. Server-side only: no rebuild, no `google-services.json`
      re-download, so this one can be done from your phone.

## Stats backfill — done

- [x] Re-ran `scripts/backfill-stats.mjs --write` on 29 July (2026) to fill the
      28 July hole left by `v0.5.0` deploying mid-afternoon. The dry run's
      self-check agreed with a direct count of the source documents before
      anything was written.

---

## A. GitHub — done

- [x] Repo created and pushed (2026-07-19):
      https://github.com/faisal-shah/sabeel-institute-kanban
- [x] **It is PUBLIC** (confirmed 2026-07-29). Audited on that date: no secret
      file, DSN, service-account key or token has ever been committed, in the
      working tree or anywhere in history; no ClickUp export; no APK or large
      blob; and none of the `@oursabeel.com` addresses in the repo is a real
      account — they are all fixtures. What IS committed is public by design:
      the Firebase web config, `google-services.json` and `firestore.rules`.
- [x] CI green on the Phase 0 commit.

---

## B. Firebase project

- [x] **Create the Firebase project.** Project id: **`sabeel-institute-kanban`**
      (already in `.firebaserc`). **Blaze (pay-as-you-go)** is required — Cloud
      Functions won't deploy on Spark.
- [x] **Create the Firestore database.** Location: **`nam5`** (multi-region US).
      Production mode; rules deploy from the repo and overwrite the console.
- [x] **Cloud Storage enabled** (2026-07-26, reversing the original decision).
      `firebasestorage.googleapis.com` on; bucket
      **`sabeel-institute-kanban.firebasestorage.app`** in **us-central1**
      (permanent, and one of the three regions with no-cost quotas);
      `roles/iam.serviceAccountTokenCreator` self-bound on
      `826656438175-compute@developer.gserviceaccount.com` so signed URLs can be
      minted. That grant fails ONLY in production — no local test can catch it.
- [x] **Billing budget alert set** (2026-07-27). Attachments are the first thing
      here with unbounded per-user cost, so this is worth having; it is done, and
      nothing needs to re-raise it. Note the billing account carries four
      projects, so a budget is only meaningful scoped to this one.
- [x] **Enable Google as the only sign-in provider.** Authentication → Sign-in
      method → Google → Enable. Leave every other provider disabled.
      The provider will not save until **Support email** is set — that is the
      only required field on that screen. The SHA-1 notice above it is advance
      warning about Android (§ D), not something that screen needs.
- [ ] **Set the public-facing name.** Same screen, currently the generated
      `project-8266…`. This is the name users see on the Google consent screen
      when they sign in, so make it **Sabeel Institute Kanban**.

> Needed at: Phase 13.

---

## C. Google Cloud — OAuth consent

**Decided 2026-07-19: External, published.** Not Internal.

- [x] **User type: `External`, publishing status `In production`.**
      Internal was the original plan and is the stronger setting — Google itself
      refuses non-Workspace accounts before our code runs. It turned out to be
      unavailable: **Internal requires the Cloud project to belong to a Google
      Cloud organization**, and the project is deliberately under a personal
      Google account, which has none. "Make internal" is greyed out for that
      reason, not because anything is misconfigured.
- [x] **Publish the app.** While status is `Testing`, ONLY explicitly-listed test
      users can sign in — staff would be locked out. Publishing is required, not
      optional.
- [ ] Confirm scopes are only `email`, `profile`, `openid`. If you ever see a
      request for more, stop and tell Claude — nothing in this app needs it.
      These are non-sensitive scopes, which is why no Google verification review
      and no 100-user cap apply.

**What this costs us, stated plainly.** The domain restriction now rests entirely
on the server-side check in `onUserCreate` (it deletes any auth user whose email
is unverified or not exactly `@oursabeel.com`). That check was always specified
to stand alone, and firestore.rules grant nothing without an admin-set
`status == 'active'` claim — so the window between a stray account being created
and deleted gives no data access. But the outer wall is gone: anyone with any
Google account can now reach the consent screen and briefly create an account.

**If Sabeel ever wants this properly:** move the project into an `oursabeel.com`
Cloud organization (keeps the project id and all data), then set Internal. That
also fixes the larger issue that the nonprofit's production system currently
lives in a personal Google account — a continuity risk independent of OAuth.

> Needed at: Phase 13. The app's own admin-approval gate is separate and still
> applies to every `@oursabeel.com` account.

---

## D. App registration

- [ ] **Register the Web app** in Firebase (Project settings → Your apps → Web).
      → **Hand back:** the config object. This is **not secret**; it gets
      committed to `app/src/firebase-config.ts`.
- [ ] **Register the Android app.** Package name: `com.sabeelinstitute.kanban`.
      → **Hand back:** `google-services.json` (save it to `app/`).
- [ ] **Add the debug SHA-1.** Adding the fingerprint in Firebase is what
      creates the Android OAuth client, and native Google Sign-In fails with
      `DEVELOPER_ERROR` until it exists. Registration is entirely SERVER-SIDE:
      re-downloading `google-services.json` is not needed and no rebuild is
      either — the plugin bakes no certificate hashes into the app (verified
      2026-08-03, see `docs/DEPLOY.md` § DEVELOPER_ERROR).
      The debug fingerprint for this repo's committed debug keystore is:

      `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`

      Not a secret — it is the fingerprint of a debug key that is committed to
      the repo, and it only ever signs debug builds. Re-derive it any time with:

      ```sh
      keytool -list -v -keystore app/android/app/debug.keystore \
        -alias androiddebugkey -storepass android -keypass android
      ```

      The **release** build uses a different key, so its SHA-1 must be added too
      before sharing an APK (§ F).
- [ ] **Web OAuth client ID** — Claude reads it from `google-services.json`
      (the `client_type: 3` entry) and commits it as `WEB_CLIENT_ID`. Public, not
      secret. Nothing for you to do beyond the above.

> Needed at: Phase 13 (or earlier if you want to test real sign-in on a device).

---

## D2. iOS registration — console work DONE; the route is the open decision

An iOS app was registered in the **right Firebase project**
(`sabeel-institute-kanban`) but with the **wrong bundle id**:
`com.sabeelinstitute.timetracker`, copied from a setup guide written for the time
tracker. Renaming the app in Firebase does not help — the nickname is cosmetic
and never appears in the plist, and **Firebase cannot change a bundle id after
creation**.

- [x] **Register a second iOS app** with bundle id `com.sabeelinstitute.kanban`
      (2026-08-01). `app/GoogleService-Info.plist` is committed — by design,
      exactly like `google-services.json`: client identifiers, not secrets.
      Verified a genuinely new registration (new `CLIENT_ID`,
      `REVERSED_CLIENT_ID` and `GOOGLE_APP_ID`), and `npm run check:ios` passes.
- [x] **Deleted the `com.sabeelinstitute.timetracker` iOS app** (2026-08-01).
- [x] **Registered the bundle id in the Apple Developer portal** (2026-08-01),
      at developer.apple.com -> Certificates, Identifiers & Profiles.
- [x] **Created the app record in App Store Connect** (2026-08-13). SEPARATE FROM THE ABOVE,
      on a different site, and this checklist previously recorded them as one
      ticked item — which is how it went unnoticed until an upload had nowhere to
      land. Registering an identifier in the portal does not create an app.
      App Store Connect -> Apps -> **+** -> New App:
      platform **iOS**, name `Sabeel Kanban`, primary language English (U.S.),
      bundle id `com.sabeelinstitute.kanban` from the dropdown, SKU
      `sabeel-kanban`, Full Access.
      The **name must be unique across the whole App Store** even for an unlisted
      app; `Sabeel Institute Kanban` is the fallback. The name can change later,
      the bundle id and SKU cannot.
      **TestFlight is a tab inside the app record**, not a top-level section — it
      does not exist until the app does.
- [x] **App ID capabilities: Push Notifications only** (2026-08-04). Not
      Background Modes (our pushes are alerts, not silent), not Associated
      Domains (no universal links), not Sign in with Apple (the enterprise-account
      exemption to guideline 4.8 applies). Reasoning in `docs/IOS-BUILD.md`.
- [x] **APNs authentication key created and uploaded to Firebase** → Project
      settings → Cloud Messaging → iOS app, with its Key ID and Team ID
      (2026-08-04). Not verifiable from this side: Firebase exposes no API for
      reading APNs configuration, so the proof is a push actually arriving on a
      device — worth doing as the first check after the first TestFlight build,
      because until then nothing distinguishes "uploaded" from "uploaded wrong".
      **This is NOT the App Store Connect API key.**
      That one is a different `.p8`, made in App Store Connect → Users and
      Access → Integrations, and it uploads builds rather than delivering
      pushes. Both download exactly once and both are real secrets — keep either
      out of the repo. Both are in Drive.
- [ ] **Distribution route DECIDED 2026-08-18: Unlisted App Distribution.**
      Surveyed 2026-08-12, briefly reopened on 2026-08-17 because it had not
      actually been called, and now called. The Apple Developer account is an
      **Organization** account under Sabeel Institute, so the Account Holder
      files the unlisted request and listings carry the institute's name.
      **Still do not submit yet** — App Review and the unlisted request are gated
      on `docs/STORE-RELEASE.md` landing, which removes account creation from the
      app. Submitting before that owes Apple an in-app deletion flow nobody has
      built. Internal TestFlight remains the channel meanwhile.
      Internal TestFlight is right for Faisal and core developers — people who
      genuinely belong on the App Store Connect team — and avoids Beta App
      Review entirely; its 90-day build expiry is the cost of staying on it.
      **Unlisted** is a normal App Store app that is not
      searchable and appears
      in no chart or category, reachable only by direct link: no user cap, no
      expiry, managed and unmanaged devices, and colleagues need no ASC account,
      no MDM and no redemption code. It suits the recordings app equally, which
      is the strongest argument for it over anything app-specific.
      **Rejected:** Apple Business Manager Custom Apps (needs a D-U-N-S number,
      reaches unmanaged devices only via country-locked redemption codes Apple is
      migrating away from, still requires App Review, and is a *one-way door* —
      an app distributed privately through ABM needs a brand-new App Store
      Connect record before it can be made unlisted); the Apple Developer
      Enterprise Program (requires 100+ employees). Reasoning in
      `docs/IOS-BUILD.md`.

- [x] **DROPPED (2026-08-15): there is no distribution certificate on this Mac to
      export.** This item assumed the iOS rule matched the Android keystore — a
      private key living on one machine and nowhere else. It does not. Signing
      here is **cloud-managed**: `-allowProvisioningUpdates` mints the
      distribution certificate through the App Store Connect API key at export
      time and discards it afterwards, so nothing persists locally. Checked after
      three successful uploads:

      ```
      security find-identity -v -p codesigning
        4 valid identities found   # all "Apple Development: Created via API"
      security find-certificate -a -c "Apple Distribution"   # nothing
      ```

      Four development certificates from the old non-Admin key, and **not one
      distribution certificate**, on the machine that has shipped every build.
      There is nothing to put in a `.p12`.

      The thing that genuinely cannot be recreated is the **Admin `.p8` App Store
      Connect key**, which downloads exactly once and is already in Drive. Apple's
      cap on distribution certificates still exists, but the certificates are now
      Apple's to manage rather than this Mac's to lose. If a future build machine
      ever signs with a keychain identity instead, this item comes back.
- [ ] **Create the review account — needed for the UNLISTED submission**, not for
      internal TestFlight. A pre-approved `appreview@oursabeel.com` (or similar)
      that Apple's reviewer can actually sign in with, since sign-in is
      domain-restricted *and* admin-gated. An app a reviewer cannot open is
      rejected every time. Create it, approve it, and keep it — every reviewed
      submission needs it, so it is infrastructure rather than a one-off.
      **On hold with the route (2026-08-17)** — internal TestFlight needs no
      reviewer, so there is nothing to create until a reviewed route is chosen.

- [x] **Symbolication wired for BOTH platforms (2026-08-12), at parity.**
      `SENTRY_ORG`, `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN` in the build shell,
      one set of names for iOS and Android, and both report to the same Sentry
      project because both read `EXPO_PUBLIC_SENTRY_DSN_NATIVE`.
      iOS: `@sentry/react-native/expo` registered **bare** in `app/app.json` —
      options would be written verbatim into `ios/sentry.properties` and this
      repo is public. Android: `app/android/app/build.gradle` applies
      `sentry.gradle`, gated on `SENTRY_AUTH_TOKEN`, since a config plugin runs
      at prebuild and that folder is never prebuilt.
      **You must export the three before building a release, on either
      platform.** Without them each build succeeds and uploads nothing.
      `npm run check:ios` and `scripts/build-aab.sh` both warn; neither fails,
      because unlike a missing DSN this degrades reports rather than losing them.
      Verified by diffing the Gradle task graph: no token → zero Sentry tasks, so
      CI and a fresh clone are unaffected.
      **You already have a token and it works here unchanged.**
      `sabeel-apk-sourcemaps`, an ORGANIZATION token with scope `org:ci`, used by
      the sibling time-tracker. Organization tokens reach **every project in the
      org**, so one token serves every Sabeel app; only `SENTRY_PROJECT` differs.
      Confirmed against the API: releases endpoints answer 200, while org and
      project-list endpoints answer 403 — `org:ci` grants exactly the CI/release
      permissions and nothing more, which is the right shape for a build secret.

### Next, in order

Everything Claude could do is done: the build is one command, the gates run
first, and the Sentry values are already in place. What is left is four values
only you can get, then the build.

**RESOLVED 2026-08-13 — v0.7.7 build 1 is on TestFlight.** The first iOS build
shipped. What it cost, kept because the cause is not guessable from the symptom:

The App Store Connect API key needed the **Admin** role. Export failed with
`Cloud signing permission error` and `No signing certificate "iOS Distribution"
found`, while the archive itself was fine. Cloud signing
(`-allowProvisioningUpdates`) mints the distribution certificate through that
key, and **Certificates, Identifiers & Profiles answers over the API only to an
*Admin* key** — App Manager and Developer cannot reach it at all. The tell was in
the keychain: the key had created four *Apple Development* certificates ("Created
via API") and no distribution one, so it could sign for debugging and nothing
else. A new Admin key fixed it; only `ASC_KEY_ID` changed, the Issuer ID is
per-team and stayed the same, and nothing in the repo needed editing.

Two things worth reusing next time:

- **A cloud-managed distribution certificate never lands in the keychain.**
  After a successful export `security find-identity` still shows no distribution
  identity. Do not read that as failure.
- **Prove a signing fix by re-exporting the archive you already have**
  (`destination: export` in the options plist) rather than starting another
  twenty-minute build. It exercises exactly the step that failed and uploads
  nothing.

1. **Put the App Store Connect key file on the Mac.** Every identifier is
   already in `app/.env.sentry-build-plugin` (created, gitignored, mode 600) —
   the Sentry three, `IOS_TEAM_ID`, `ASC_KEY_ID` and `ASC_ISSUER_ID`. The only
   thing missing is the `.p8` itself, which is a secret and lives in Drive:

   ```bash
   mkdir -p ~/.appstoreconnect/private_keys
   cp AuthKey_<KEY_ID>.p8 ~/.appstoreconnect/private_keys/
   ```

   That is the directory Apple's own tooling searches, so nothing needs editing;
   `ASC_KEY_PATH` only exists for keeping it somewhere else.

   **It is NOT the APNs key**, and the two are easy to confuse because both
   download as `AuthKey_<KeyID>.p8`. The tell is the **Issuer ID**: an App Store
   Connect API key has one (a UUID), an APNs key never does — it has a Team ID
   instead. The APNs key is the one already uploaded to Firebase for push, and
   it belongs nowhere near this step.
2. **Add core developers as App Store Connect users**, so internal TestFlight can
   reach them. Only the few who need pre-release builds — each holds a role in
   the developer account.
3. **On the Mac:**
   ```bash
   git pull && npm ci
   # copy app/.env.local and app/.env.sentry-build-plugin across
   npm run build:ios -- --check     # free, proves every gate
   npm run build:ios                # archive + upload to TestFlight
   ```
   `--check` first. It catches a missing value in two seconds instead of twenty
   minutes into an archive.

   **Or from GitHub, with no Mac at all:**
   `gh workflow run ios.yml -R faisal-shah/sabeel-institute-kanban -f testflight=true`,
   started on the release commit. `docs/IOS-BUILD.md` § Builds on GitHub.
4. **Bump `expo.ios.buildNumber` before every re-upload.** Apple requires it to
   increase even for the same version; unlike Android's versionCode it does not
   derive itself. On App Store Connect so far: builds 1, 2, 4 and 6–11, the last
   v0.11.5 build 11 (2026-10-15, the first upload from GitHub). Builds 3 and 5
   were never uploaded — each was bumped past twice — which cost nothing, and is
   the point: the number need only rise *within* a version, so carrying it
   across versions is simply the cheapest way never to collide. It is `12` now,
   unused, ready for the next upload. The GitHub upload job checks it with
   Apple before uploading.
5. **First thing on a TestFlight install: confirm a push arrives, and that
   tapping it with the app closed opens the card.** Apple accepts the key
   (`npm run check:apple-push`) and the sandbox path works on the simulator;
   the production service, and a tap from outside the app, only a phone can
   show. Assign yourself a card from another account, or have someone mention
   you, with the app in the background.
6. **Before 16 October 2027: renew the iOS distribution certificate and both App
   Store profiles** (this app's and the LMS's — they share the certificate),
   then set `IOS_DIST_P12`, `IOS_DIST_P12_PASSWORD` and `IOS_PROFILE` again in
   both repos, and revoke the old certificate. Until then GitHub builds work
   unattended; after it, the gates in `build-ios.sh` stop every GitHub build in
   seconds with "expired". The Mac is unaffected (it signs automatically).
   Steps: `docs/IOS-BUILD.md` § Builds on GitHub → Renewal.
7. **On hold until the route is final (2026-08-17).** If it lands on unlisted:
   create and approve the review account, submit to App Review, then request
   unlisted distribution — against a release build, not a TestFlight one. None
   of that starts before Faisal says so; internal TestFlight is the standing
   channel meanwhile.

**Answered 2026-08-15, and nothing goes under `ios.entitlements`.** The question
was whether the `aps-environment` entitlement survives a prebuild. It does, and
not through Xcode: `expo-notifications` ships an `app.plugin.js`, so its config
plugin applies automatically and writes the entitlement on every prebuild.
Confirmed again on v0.9.0 build 6 by reading the exported `.ipa` — the archive
carries `development`/`get-task-allow true` and the export re-signs it to
`production`/`false` off the App Store profile, so setting `production` by hand
would break the simulator and be overwritten anyway. `docs/IOS-BUILD.md` has the
detail.

`docs/IOS-BUILD.md` is the runbook.

> Everything left here is console or build-machine work. The repo side is done:
> `app/app.json` carries the bundle id, the plist, the Google Sign-In plugin and
> now the Sentry plugin, and `npm run check:ios` guards all of it.

---

## E. Sentry

- [x] **Three projects created** (2026-07-19), platform set to match the SDK:
      web → React, android → React Native, functions → Node.js. The platform
      choice only drives onboarding docs and defaults and is changeable later;
      the installed SDK is what determines behaviour.
- [x] **Client DSNs are in `app/.env.local`** (gitignored) as
      `EXPO_PUBLIC_SENTRY_DSN_WEB` and `EXPO_PUBLIC_SENTRY_DSN_NATIVE`.
      Two names, not one: web and native are separate projects, and a single
      shared variable would file Android crashes under the web project.
- [x] **`sabeel-kanban-functions` project created** (the UI stall cleared on a
      retry; it was never a plan limit — all Sentry plans include unlimited
      projects).
- [x] **Server DSN set + verified.** `firebase functions:secrets:set SENTRY_DSN`
      is done; the binding is live (every function deploy binds it), and the
      pipeline was confirmed end-to-end — the `functions-sentry-check` marker
      landed in the functions project 2026-07-20. The client paths were likewise
      verified via a deliberate-error test build.
- [x] **Rotation: decided AGAINST (2026-07-22).** A DSN is send-only — it cannot
      read Sentry or app data — so the only realistic risk is someone submitting
      noise events. For an internal app that is not worth the churn. Left as-is by
      choice. (To set it via the CLI if ever needed: `firebase functions:secrets:set
      SENTRY_DSN`, paste at the prompt, **never in chat**, then redeploy functions.)

**Do NOT run `npx @sentry/wizard`.** It rewrites committed native files and
metro config and writes a `sentry.properties` containing a real auth token. The
SDKs are wired by hand instead — see `docs/SECRETS.md`.

> Client DSNs are not secret (they ship in every bundle); the functions DSN and
> any auth token are. `docs/SECRETS.md` sets out which is which.

---

## F. Release signing — **a debug-signed APK is already published**

**Every release so far, up to and including v0.6.1, is signed with the debug
keystore**, which is committed to this repo. That is why the debug SHA-1 is the
one registered in Firebase — and it means **anyone with this repo can sign an
update that Android will accept as this app.**

The original note said to close this "before the APK goes to the team". It has
gone to the team; the app is in daily use. That does not make it urgent on its
own — the audience is a dozen colleagues who install deliberately — but the
condition it was written against has passed, so this is now a standing risk
rather than a pre-launch task. Swapping keystores also forces a **reinstall for
everyone** (Android refuses an update signed by a different key), which is the
real reason to plan it rather than slip it into a release.

- [x] **`build.gradle` is wired** (2026-08-02). `signingConfigs.release` reads a
      **gitignored** `app/android/keystore.properties`. With no such file the
      release build still works but is debug-signed and says so loudly, and
      `scripts/publish-apk.sh` now **refuses to publish a debug-signed APK** —
      verified by pointing it at the current one.
- [ ] **Generate the upload keystore.** Store it somewhere backed up and OUTSIDE
      the repo. Pick your own passwords; never paste them into chat or a file in
      this repo.

      ```sh
      keytool -genkeypair -v \
        -keystore ~/keys/sabeel-kanban-upload.jks \
        -alias upload -keyalg RSA -keysize 4096 \
        -validity 10000 -storetype PKCS12
      ```

- [ ] **Write `app/android/keystore.properties`** (gitignored):

      ```properties
      storeFile=/home/faisal/keys/sabeel-kanban-upload.jks
      storePassword=...
      keyAlias=upload
      keyPassword=...
      ```

- [ ] **Export the public certificate** — this is what Play Console asks for. It
      is a certificate, not a key; nothing secret leaves your machine.

      ```sh
      keytool -export -rfc -keystore ~/keys/sabeel-kanban-upload.jks \
        -alias upload -file upload_certificate.pem
      ```

- [ ] **Register the new SHA-1 in Firebase**, then **re-download
      `google-services.json`** — the re-download is what adds the OAuth client
      (§ D). Read it with:

      ```sh
      keytool -list -v -keystore ~/keys/sabeel-kanban-upload.jks -alias upload
      ```

- [ ] **If using Play App Signing, add Play's certificate SHA-1 too.** Google
      re-signs the app with an app signing key that is NOT your upload key, so
      the fingerprint that matters for Google Sign-In on a Play install is the
      one under Play Console → App integrity → *App signing key certificate*.
      Miss it and sign-in fails with `DEVELOPER_ERROR` for exactly the users who
      installed from Play, while your sideloaded build keeps working — so it
      looks like a device problem rather than a config one. Add **both**.

### Do these in order, next time you are at the computer

**Order matters.** Debug builds are broken until step 1b lands — the
google-services plugin fails outright with *"No matching client found for package
name"*. Everything up to that point is already committed and waiting.

1. **Firebase** → Project settings → **your existing Android app**
   (`com.sabeelinstitute.kanban`) → add SHA-1
   `33:93:4A:A4:5F:51:60:23:E3:86:6F:68:84:8A:20:2C:44:28:2E:97` (the upload
   key). The re-download below is what creates the OAuth client; without it
   sign-in fails with `DEVELOPER_ERROR`.
1b. **Firebase** → **Add app → Android**, package name
   **`com.sabeelinstitute.kanban.debug`**, and give it the DEBUG SHA-1
   `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`. This is the
   side-by-side dev build; it is a separate app to Android and to Firebase, but
   lives in the SAME project, so one `google-services.json` covers both.
1c. **Download `google-services.json` once**, after both of the above. It will
   contain **two** `client` entries. Put the same file in **both** places — they
   are byte-identical today and must stay so:
   - `app/google-services.json` (Expo's copy)
   - `app/android/app/google-services.json` (the one Gradle actually reads)

   Both are committed by design. Easiest over the GitHub web UI: open each file,
   "Edit", paste, commit — then tell me and I will pull and verify.
2. **Play Console → All apps → Create app.** It asks for an app NAME, not a
   package name — the package comes from the first AAB you upload. Take the
   default on Play App Signing (*let Google create and manage the app signing
   key*); your upload key is registered from that first bundle, so
   `~/keys/upload_certificate.pem` is usually not needed at all. Keep it only in
   case a screen explicitly asks for a certificate.

   **Android developer verification is a DIFFERENT screen** and not the way in.
   It links a package name to a signing key, and enforcement starts
   **30 September 2026** — after which unverified apps cannot be installed on
   certified devices, which is a hard expiry on the old sideloaded APK, not just
   a plan to retire it. Creating the app registers the package automatically, so
   leave any draft there alone rather than binding the package to the upload key
   by hand: what users install is signed with Google's app signing key, not that
   one.
3. **Build and upload:** `npm run build:aab`, then Play Console → Testing →
   Internal testing → Create new release.
3b. **After the AAB finishes processing:** Internal testing -> Save -> Review
   release -> Start rollout. Play will block on **App content** declarations
   first (privacy policy, data safety, ads, content rating, target audience) —
   the dashboard lists which. Then Testers tab -> add the team's emails -> copy
   the **opt-in link**; testers must accept it before Play shows them the app.

   **Play sends NO email for internal testing.** Adding someone to a list does
   nothing on its own — the opt-in link has to be sent to them by hand, and they
   must open it signed into the same Google account that is on the list, on the
   account their phone's Play Store uses. Waiting for an invite that never
   arrives is the default way to lose an afternoon here.

   **If ONE tester gets "Item not found" while it works for everyone else**,
   suspect device eligibility before anything else: `minSdkVersion 33` means
   **Android 13 or newer**, which is a much higher floor than most apps set, and
   Play renders "not available for your device" as this same screen when you
   arrive by direct link. Check Settings -> About phone -> Android version.
   Then check the Play Store's ACTIVE account (profile icon) — being signed in
   is not the same as the Store using that account, and the mismatch never
   resolves on its own. A pre-13 device is not fixable without reversing the
   Android 13 floor; point that person at the web app instead.

   **"Item not found" right after opting in is normal, not a fault.** The opt-in
   page says so in passing and it is easy to miss: a first-time download can take
   a while to propagate, and for a brand-new app's first release that is closer
   to hours than minutes. Before debugging anything, confirm the phone's Play
   Store is signed into the SAME account that opted in — a device with several
   Google accounts gives this identical error forever. The `(unreviewed)`
   temporary app name and "Not reviewed" in the console are unrelated and
   expected; they just mean the store listing is not filled in, which internal
   testing does not require. Also check the list is
   actually *attached to the track* and saved (creating it is a separate step),
   and that the release is rolled out rather than left a draft.
   **A privacy policy is probably NOT needed.** Apps active *exclusively* on the
   internal testing track are exempt from the Data safety section, which is what
   drives the privacy-policy requirement — the exemption exists because only
   staff added by email can install. It becomes required the moment the app also
   goes to a closed, open or production track, i.e. anywhere the public can
   reach it. Internal testing caps at 100 testers and needs no review, so for a
   dozen colleagues it is a permanent home, not a workaround.

   If Play does ask: any publicly reachable URL is acceptable — a `github.io`
   page is fine, it need not be on the org's domain — and the URL can be changed
   in Play Console later without touching the app.
4. [x] **Done 2026-08-02.** Play's app signing certificate SHA-1
   `A6:58:D9:33:B2:07:00:31:AF:58:5F:97:54:92:C2:6E:3D:25:77:B0` is registered on
   `com.sabeelinstitute.kanban` and committed to both `google-services.json`
   copies. Four fingerprints now cover the three signing identities: upload key,
   debug key (twice — main package for existing sideloaded users, and the
   `.debug` package), and Play's. This is the fingerprint Play-installed
   copies actually run under. Easy to skip, and the failure looks like a device
   problem: sign-in breaks only for people who installed from Play.

   **No rebuild or re-upload is needed for this.** The registration is
   server-side: `WEB_CLIENT_ID` is a hardcoded constant in
   `app/src/firebase-config.ts`, not read from `google-services.json` at
   runtime, so the binary does not carry the fingerprint list. Commit the
   re-downloaded file to keep the repo honest, but the uploaded AAB stands. The
   proof is signing in on a Play-installed build.
**Android is verified end to end (2026-08-03):** installed from the internal
testing track, signed in, and push received on the device. Nothing about the
Android path is unproven any more.

**Most of the team is on iPhone**, so iOS is the critical path from here, not a
follow-up. Two interim points for the rollout message: the **web app works on
iPhone** and can be added to the Home Screen, and **web push may already work
there** (Safari has supported it for Home-Screen sites since iOS 16.4, and the
service worker and VAPID key are both in place) — worth testing before promising
it to anyone.

5. **Tell the team to uninstall and reinstall** from the Play invite. Android
   refuses an update signed by a different key, so there is no in-place upgrade
   from the old sideloaded build. Nothing is lost — all state is in Firestore.
   (This does NOT affect the `.debug` dev build, which is a separate app and can
   stay installed alongside.)
6. **Later, once everyone has moved:** remove the download section from the
   kanban page in the pages repo, and delete the `kanban-latest` release there.

> Decided 2026-08-02: Play is the Android channel from here on.
> `scripts/publish-apk.sh` is retired and refuses to run without
> `SK_LEGACY_APK_CHANNEL=1`; the frozen v0.7.4 download stays up until step 6.

### Notes on the Play move

- **`npm run build:aab` is the build.** It runs `bundleRelease` and repeats every
  gate publish-apk.sh used to hold — store-legal version, a deploy-log entry
  written *before* the build, and a signature that is not the debug key. The
  per-ABI splits switch themselves off for bundle tasks; leaving both on fails
  with *"Multiple shrunk-resources files found"*.
- **One channel, decided.** Play replaces the GitHub download. Keeping both was
  never really an option: Play signs installs with Google's app signing key and a
  sideloaded APK carries the upload key, so Android will not let either update
  the other. `scripts/publish-apk.sh` is retired accordingly.
- **Changing the signing key forces everyone to reinstall.** Android refuses an
  update signed by a different key, so there is no in-place upgrade from the old
  debug-signed build. Nothing is lost — all state is in Firestore — but it needs
  telling people, not discovering.
- **Target API level.** Play enforces a minimum `targetSdkVersion` for new apps
  and raises it annually; ours comes from `rootProject.ext.targetSdkVersion`
  (Expo's default for SDK 57). Check the current floor in the console before
  assuming it passes.

---

## G. ClickUp export — **done, one-time, 2026-07-26**

The migration ran and is finished. Nothing here is outstanding, and there is no
recurring import: it was a single pass, confirmed complete by Faisal.

Kept only as history — the importer (`scripts/import-clickup.mjs`) and the
`sourceId` field on cards are what it left behind, and both stay so a re-run
would update rather than duplicate.

## H. Launch — **done**

- [x] **Roles decided and in place.** Every role is assigned in production and
      the distribution was verified (2026-07-29). The model was **replaced** on
      2026-08-16 — board authority is now per-board, and `manager` became
      `organizer`; see `docs/PERMISSIONS.md`.
- [x] **First admin bootstrapped** after the first deploy (2026-07-19); everyone
      since has been approved and promoted in-app.
- [x] **Notification event list confirmed** and shipped. `myCardMoved` is off by
      default because it fires constantly on a busy board — the reason the
      later "subscribe to a card" work was narrowed to comments only.

---

## I. Push notifications — two things only you can do

Android push is wired and ships in the next APK. Two items are console work.

- [x] **Verify a push actually arrives.** Done, on your phone, 2026-09-16:
      two mention pushes minutes apart. What the screenshot ALSO showed was the
      bug it took to v0.11.4 to fix — the two carried different small icons,
      the glyph for the one that arrived with the app closed and the launcher
      icon for the one that arrived with it open — so the next device pass sends
      one push of EACH kind and checks both icons match. The steps below stay,
      because they are the procedure for that pass.

      Install the new APK and sign in.
      **Signing in no longer asks for permission** — that changed in v0.10.2,
      because the prompt used to land on the *Waiting for approval* screen, and
      Android only offers it twice ever. Press **Enable notifications** instead:
      the card at the top of Boards, or the gear on Alerts. Allow it, and check
      the screen then says *Notifications are enabled on this device* — if it
      says *can't be set up*, no token was filed and nothing will arrive, so
      stop there and tell me.

      Then get **SOMEONE ELSE** to `@`-mention you in a comment or assign you a
      card. It cannot be you: `shouldNotify` drops the actor first
      (`recipientUid === actorUid`), so mentioning yourself from the web app
      while signed in as yourself is silently a no-op — the test would look
      failed when nothing was ever sent. A second account you own works too.
      The banner should arrive within a few seconds.

      An emulator cannot prove this: it has no FCM delivery, which is why
      everything up to and including the permission grant and the channel is
      verified on the emulator and this last step is not. It needs the phone.
      If nothing arrives, say so and I'll read the function logs.

- [ ] **Web push — confirm a push actually ARRIVES.** The configuration half is
      done and verified against the live site, so this is now one question, not
      three. Confirmed by reading the deployed bundle and the deployed origin:
      the VAPID key is present and non-empty (the minifier folded the
      `!VAPID_KEY` guard away, which it can only do for a truthy literal),
      `USE_EMULATORS` compiles to `false`, and `/firebase-messaging-sw.js`
      returns HTTP 200.

      What was actually broken was neither of those: permission was requested
      from a Firestore snapshot callback, and a browser only honours that
      request straight from a click. Safari refused it silently and Chrome
      demoted it to the quiet chip, so the site sat at `default` — in neither
      the allowed nor the blocked list. Fixed; the ask is now on a button.

      So: open <https://sabeel-institute-kanban.web.app> once v0.11.4 is
      deployed — the service worker that shows every push ships with it — use
      **Enable notifications** (the card on Boards, or the gear on Alerts) and
      allow it. Check the screen then reads *Notifications
      are enabled on this device*: that message means a TOKEN WAS FILED, not
      merely that permission was granted, so it is worth confirming on its own
      before involving anybody else.

      Then two things, or the test misreads:

      - **Someone else** has to do the action — `shouldNotify` drops the actor,
        so nothing is sent if you trigger it yourself.
      - **Try it both ways: once with the tab focused, once with it minimised.**
        Since v0.11.4 the service worker shows every push itself, so a banner
        should appear in BOTH cases, and exactly one each time — the Firebase
        SDK's worker used to show a background push itself and then hand our
        handler the same message, which drew a second banner, and to hand a
        focused tab's push to the page, which drew none. Clicking the banner
        should focus the app. The Alerts badge goes up either way, because the
        notification is written to Firestore independently of the push — that
        badge moving is itself evidence the trigger fired, and separates "the
        server never sent" from "the push did not arrive".

      Safari is its own case: on macOS it wants the site added to the Dock before
      it will accept web push. Chrome, Edge and Firefox on desktop need nothing.

      Expect the TAP to only focus the app, not open the card. That is
      deliberate and is not part of this item: the web app has no URLs for board
      and card ids, so `firebase-messaging-sw.js` focuses rather than opening a
      link that would land on the home screen anyway. Worth revisiting now that
      web push actually arrives — the ids are already in the notification data,
      and that handler is where it goes.

      A VAPID key is a public/private pair identifying *your server* to the
      browser's push service (Google's for Chrome, Mozilla's for Firefox). The
      public half ships in the web app so a subscription is bound to you and
      cannot be replayed by anyone else; the private half stays in Firebase and
      signs each push. Android needs none of this because FCM reaches Play
      services on the device directly.

      The key already exists and is already deployed — nothing to generate. It
      lives in `app/.env.local` as `EXPO_PUBLIC_FCM_VAPID_KEY` and reaches the
      bundle from the environment that runs `expo export`. If it is ever lost or
      rotated: Firebase console → **Project settings** → **Cloud Messaging** →
      *Web configuration* → **Web Push certificates**. Console-only — there is
      no `firebase` CLI command and no REST endpoint for it (checked, not
      assumed).

      `npm run check:web-push` now reads the exported bundle and refuses when
      the key is missing or the wrong shape, so a keyless deploy — which would
      silently make every device report that it cannot receive notifications —
      cannot go out unnoticed. Run it between `web:export` and the deploy.

- [x] **Functions Sentry verified 2026-07-20.** Marker
      `functions-sentry-check 2026-07-20T16:01:17.471Z` arrived in
      `sabeel-kanban-functions`, environment `production`. The trace's second
      frame is `await fn(event)` — `guardedEvent` — so this also confirms the
      newly-wrapped background triggers deliver, not just the callables. All
      three surfaces now have an observed event, none inferred.

## K. The board-ownership migration — RUN THIS, IN THIS ORDER

`docs/PHASE_STATUS.md`'s v0.9.0 entry says what changes and why;
`docs/PERMISSIONS.md` is the model.

**THE WHOLE MIGRATION RAN ON 2026-08-17 and every step is verified.** Nothing
below is outstanding. It is kept as the record of what was done, and because
`docs/DEPLOY.md` § Restoring across the board-ownership migration points here for
what a restore from before that date has to re-run.

The R7a→R7b window — the one genuinely dangerous gap, where nobody can disable an
account still holding the old role — was **two seconds**, by chaining the deploy
and the rename in one command rather than typing the second after watching the
first.

- [x] **R1 — Manifests.** A managed Firestore export, plus
      `GCLOUD_PROJECT=sabeel-institute-kanban node scripts/dump-migration-shape.mjs`,
      which writes both the recovery manifest (real uids, emails and CLAIMS —
      gitignored, keep a copy off this machine) and a redacted shape file safe to
      keep. Note the board count it prints; R7c wants it. Confirm PITR is still
      on: `firebase firestore:databases:get "(default)"`.

      Done. PITR on with 7-day retention, delete protection on, and the daily
      schedule has real backups behind it — which also closes the § J item that
      asked whether the first one ever landed. The export went to a bucket
      created for it, **`gs://sabeel-kanban-exports`** (US, uniform access), under
      `pre-v0.9.0-board-ownership/`. That is a new billable resource, tiny, and
      the only one this migration added.

      The dump then found **no authorless board, no claim/mirror drift and no
      claimless account** — all three backfill gates clear — and the whole
      upgrade, both undos included, was replayed against that shape on the
      emulator before anything was written: 20/20.
- [x] **R2 — Compat rules only**, from the commit that carries them alone:
      ```
      git checkout db46919 -- firestore.rules
      npx firebase deploy --only firestore:rules --project sabeel-institute-kanban
      git checkout HEAD -- firestore.rules      # put the working tree back
      ```
      They admit `boardOwnerUids` and PIN it — create allows only
      `[request.auth.uid]`, update requires it unchanged unless you are an admin.
      Merely admitting the key would let any manager write themselves in for the
      whole window.
      **Rollback, about a minute:**
      ```
      git checkout db46919~1 -- firestore.rules
      npx firebase deploy --only firestore:rules --project sabeel-institute-kanban
      git checkout HEAD -- firestore.rules
      ```
- [x] **R3 — Canary.** Backfill ONE low-traffic board and then rename that board
      from a real signed-in client. This is the only proof R2 propagated; a green
      `firebase deploy` is not that proof.
      `GCLOUD_PROJECT=sabeel-institute-kanban node scripts/backfill-board-owners.mjs --only <boardId> --apply`

      Backfilled a single-member scratch board. Propagation was then proved
      **mechanically instead of by hand**, which is stronger than the rename this
      step originally asked for: the live ruleset was read back off the Rules API
      and is **byte-identical** to `db46919`, and that commit's board-rules suite
      was re-run against those exact fetched bytes — 32/32. Rules evaluation is
      deterministic given source, token and document, so identical source plus a
      green suite is the proof. Doing the rename by hand anyway costs five
      seconds and is still worth it.
- [x] **R4 — Backfill the rest, then verify.** Read the DRY RUN first — it names
      every board whose creator has left it, and those get an empty owner list
      for you to fill in by hand at R8.
      ```
      GCLOUD_PROJECT=sabeel-institute-kanban node scripts/backfill-board-owners.mjs
      GCLOUD_PROJECT=sabeel-institute-kanban node scripts/backfill-board-owners.mjs --apply
      ```
      **Undo is `scripts/unbackfill-board-owners.mjs`, NOT a restore** — an import
      cannot remove a field that was wrongly added.

      The dry run matched the emulator replay exactly. Verify now reports every
      board carrying the field, every owner a member of their board, every board
      recording its creator, and claims agreeing with their mirror. Its only
      remaining failures are the accounts still holding `manager`, which is R7b's
      job — **that is the expected reading between here and the flip**, not a
      fault.
- [x] **R5 — Ship the clients**, web and Android. The new client works under both
      rule sets, which is what makes this order safe.
- [x] **R6 — Soak** until everyone is on the new build. Small enough team to
      simply ask; confirm from Sentry release data, not Play's rollout
      percentage. An app build too old to know about ownership gets a broken
      Boards screen the moment R7a lands, which is the whole reason to wait.

      Ownership was also assigned BEFORE the flip rather than after, which the
      original order did not require but which is strictly better: R2's rules
      exempt an admin from the ownership pin precisely so this is possible, and
      doing it first meant nobody was briefly stranded on a board with no owner.
- [x] **R7 — The flip, one window, minutes apart.**
      **(a)** `firebase deploy --only firestore:rules,functions`.
      **(b)** Immediately — target under two minutes —
      `GCLOUD_PROJECT=sabeel-institute-kanban node scripts/rename-manager-role.mjs --apply`.
      Between (a) and (b) nobody can disable or restore an account that still
      holds `manager`, and their Boards screen is broken; (b) closes both.
      **If (b) half-finishes, go FORWARD** — re-run it, it is idempotent. New
      rules with old claims is recoverable; old rules with new claims is the
      worst state in the migration.
      **Rollback of (a) alone, before (b) has run:** redeploy the previous rules
      as in R2 and the previous functions with
      `git checkout db46919~1 -- functions/src && npx firebase deploy --only functions`,
      then `git checkout HEAD -- functions/src`. Claims are untouched at that
      point, so nothing else has to be undone. Once (b) has started, finish it.
      Keep the manifest it writes under `migration/`. It is gitignored, it holds
      real addresses, and it is the ONLY record of the previous claims — Auth is
      in no backup. Copy it off this machine.
- [x] **R7c — Verify.**
      `GCLOUD_PROJECT=sabeel-institute-kanban node scripts/verify-board-owners.mjs --expect-boards <the R1 count>`
      — R1 printed it and `migration/manifest-*.json` still holds it; this repo is
      public, so the number lives there and not here.
      Then by hand: an ex-manager's app updates within a second, People still
      works, an organizer can create a board, a member who does not own a board
      cannot edit it, and you can edit a board that has no owner.
- [x] **R8 — Assign the missing owners** through Board settings, from R4's
      report. Dump the board manifest again afterwards — a mis-click in the new
      UI is otherwise unrecoverable.

      Done before the flip, not after. One board is deliberately left without an
      owner: an archived ClickUp import with no members and no cards, which
      nobody has ever touched. Assigning an owner to an empty archived shell is
      busywork, and admins can administer it if it is ever restored.
      `verify-board-owners.mjs` reports it as a warning every run, which is the
      correct behaviour — it is a state to know about, not a fault.

      For the record, the original reading was that three boards need one, all of them ClickUp imports and two of them already
      archived, so only one is live. Their creator is still an active colleague —
      the import simply never added them as a *member* of those three, and
      ownership requires both. Run `verify-board-owners.mjs`; it names them.
      Adding that person as a member and turning their Owner toggle on is the
      whole fix, and until then an admin can still administer all three.

## N. Play content rating — **DONE 2026-08-29**, and the message lied

Observed 2026-08-29 on a real phone: the internal-testing listing shows
**"com.sabeelinstitute.kanban (unreviewed)"**, **Unrated**, and refuses to
install with *"Parental controls restrict downloading of this item"* — on the
correct adult account.

**It is not an account problem, and switching accounts will not fix it.** Play's
parental controls filter by CONTENT RATING, and an app with no rating fails
every filter. The setting also lives on the Play Store profile on the device,
not on the signed-in account, so any device with parental controls enabled will
refuse an unrated app no matter who is signed in. That means this blocks an
unknown number of the team, silently, with a message that points at the wrong
cause.

**RESOLVED: completing the content rating fixed it.** Keep the rest of this
entry, because the diagnosis wasted real time and the next person will repeat it.
The message names parental controls, so the instinct is to fix the DEVICE:
several Google accounts were checked and all were over 18, the supervised child
accounts were removed, the Play Store cache was cleared and the phone rebooted.
None of it changed anything, because none of it was the cause.

Two things make that message misleading. Parental controls are **one switch per
Play Store, not one per account** — an adult account can have it on, so verifying
ages proves nothing and removing child accounts does not turn it off. And an app
with no content rating is **Unrated**, which means "unknown", which fails EVERY
rating filter rather than only strict ones. So the app was blocked by a filter
whose switch nobody could find, for a reason the message did not state.

Whether the device toggle was ever on was never established, and it stopped
mattering: an all-ages rating passes the filter either way. **Do the
questionnaire first and debug the phone never.**

- [x] **Complete the content rating questionnaire.** Play Console → Policy →
      App content → Content rating. It is a short form; for a private
      productivity tool with no ads, no purchases and no user-generated content
      shown to strangers, the outcome is the everyone/all-ages rating. The app
      stops being "Unrated" once it propagates.
- [ ] While you are on that screen, clear whatever else **App content** still
      lists — privacy policy, data safety, ads, target audience. Play blocks a
      production rollout on these anyway, and `TODO.md` § F step 3b already
      warned they would come due.

**Workaround until then, in order of preference:** you already have this exact
build sideloaded from the download page, so nothing is blocking YOUR testing.
For anyone else, either turn off parental controls on their device (Play Store →
profile → Settings → Family → Parental controls) or send them the APK. Remember
the signature rule if someone switches route: a Play install carries Google's
app signing key and a downloaded APK carries the upload key, they cannot replace
one another, and the only symptom is "App not installed" — uninstall first,
nothing is lost because all state is in Firestore.

## M. v0.10.0 — do these two, they are the only ones outstanding

- [ ] **Create `privacy@oursabeel.com`.** A Workspace GROUP with two admins on
      it, not a person's alias — it is published in the privacy policy on both
      the web app and the download page, and in the App Store listing later. It
      does not exist yet, so a deletion request sent today bounces. This was
      flagged before shipping and shipped anyway on your call; it is the one item
      where waiting made it later rather than worse.
- [ ] **Read the privacy policy** at
      https://sabeel-institute-kanban.web.app/privacy. It is short. Three things
      in it are commitments you are making: a **30-day** response to deletion
      requests, an assertion that Google, Firebase and Sentry are under
      agreements protecting the data to the same standard, and the retention
      position — that cards, comments and authorship belong to the institute and
      survive somebody leaving. Reading it once already caught a paragraph that
      described an account model this app does not have.

## L. Known, deliberately NOT fixed in v0.9.0

- [ ] **`setUserAccess` requires a role even when only the status is changing.**
      Approve, Reject and Disable on the People screen all send the role read
      back from the user document, which means two things: a concurrent role
      change by another admin is silently reverted (a lost update — needs two
      admins acting on the same person within seconds, so it has never happened
      here), and during the R7a→R7b window nobody can disable an account still
      holding `manager`, because the deployed code no longer recognises that role
      as valid input.

      The fix is to let the callable take a status alone and carry the stored
      role through. It is NOT in this release on purpose: the migration's whole
      sequence was reasoned about and rehearsed against `setUserAccess` behaving
      exactly as it does today, and changing the access API during an
      access-model migration invalidates that reasoning for a bug worth minutes
      of exposure. `scripts/rename-manager-role.mjs` can set status directly if
      the window ever has to be worked through.

## J. Backups and disaster recovery

- [x] **Native protections enabled 2026-07-25** (you authorised me to run them).
      Before: PITR disabled, version retention **1 hour**, 0 schedules, 0 backups,
      delete protection off. Verified after, by reading the database back rather
      than trusting the success messages:

      | Setting | Value |
      |---|---|
      | `pointInTimeRecoveryEnablement` | `POINT_IN_TIME_RECOVERY_ENABLED` |
      | `versionRetentionPeriod` | `604800s` (7 days) |
      | `deleteProtectionState` | `DELETE_PROTECTION_ENABLED` |
      | backup schedule | daily, retention `8467200s` (98 days) |

      Both PITR and backup data are **excluded from the free tier** — expect a new
      (tiny) line item on the bill.

- [x] **Confirm the first scheduled backup actually landed.** The schedule exists,
      but no backup is taken until it first fires (within 24h of 2026-07-25).
      `firebase firestore:backups:list` should show one — a schedule with no
      backup behind it is not yet protection.

      Confirmed 2026-08-17, before the v0.9.0 migration: the schedule has a run of
      consecutive daily backups behind it, all `READY`, the newest from the day
      before. PITR reports a 7-day window with a live `earliestVersionTime`, which
      is the part that matters for a migration — a nightly backup can only take
      you back to last night, PITR to the second before the first write.

- [ ] **Rehearse a restore once, against a scratch database.** An unrehearsed
      restore path is a hope, not a plan, and the step that surprises people is
      that the destination id can *never* be the one the app is configured for.
      Walk the numbered procedure in `docs/DEPLOY.md`.

      This drill also settles the one open question in the Auth recovery story:
      whether a **Google sign-in attaches cleanly to a restored account** with a
      matching email and uid. If it does not, we add `firebase auth:export` as a
      belt-and-braces artifact; until then we are not guessing either way.

## Answered — kept for reference

- [x] **Sign-in domain is `oursabeel.com`**, a Google Workspace domain
      (confirmed 2026-07-19).
- [x] **File attachments** — declined 2026-07-19, **reversed 2026-07-26**.
      10 MB per file, any board member may remove, signed-URL downloads.
