# Faisal's setup checklist — things only you can do

Console, account and secret-handling steps Claude can't (or shouldn't) do.
Claude keeps this file current; you tick items off. Each item says **what to do**
and **what to hand back**.

The app is in production. Ticked items are the record of how each console was
set up; unticked ones are open.

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
      Send the invite.
- [x] **Put the key where the script looks:**
      ```
      mkdir -p ~/keys
      mv ~/Downloads/<the-file>.json ~/keys/sabeel-play-publisher.json
      chmod 600 ~/keys/sabeel-play-publisher.json
      ```
      **Never inside the repo — it is public.** Hand back nothing; do not paste
      any part of it into chat. A copy is in the vault (`docs/SECRETS.md`).
- [x] **Confirm it works:** `npm run publish:play -- --check`. It runs every
      gate and proves the Play permission by creating and discarding an edit —
      a key mints a token whether or not Play granted it anything, so this
      checks the thing that actually fails. Uploads nothing.

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
- [x] **Sign-in providers: Google, and Email/Password for the one review
      address** (Email/Password since 2026-10-15). The project is on
      **Identity Platform**, and the blocking functions `beforeSignUp` and
      `beforeSignIn` hold the door; `docs/DEPLOY.md` § Prerequisites has the
      order that keeps it shut. No other provider.
      Google will not save until **Support email** is set — the only required
      field on that screen.
- [ ] **Set the public-facing name.** Same screen, currently the generated
      `project-8266…`. This is the name users see on the Google consent screen
      when they sign in, so make it **Sabeel Institute Kanban**.
- [x] **Report a problem's sender** (2026-10-16): the Gmail API is on, and
      the Admin console's domain-wide delegation lets
      `report-mailer@sabeel-institute-kanban.iam.gserviceaccount.com` send as
      `apps-noreply@oursabeel.com` (scope `gmail.send` only); a test message
      reached `apps-reports@`.
- [ ] **Let the functions sign as `report-mailer`**, before the first deploy
      of `reportProblem`: `roles/iam.serviceAccountTokenCreator` for
      `826656438175-compute@developer.gserviceaccount.com` on it. The exact
      command is `docs/DEPLOY.md` § Prerequisites, item 5; without it every
      report is kept but its email fails at "signing the delegation token".

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

**What this costs us, stated plainly.** The domain restriction rests on the
server: `beforeSignUp` refuses a sign-up that is not a verified
`@oursabeel.com` Google account before any account exists, `onUserCreate`
deletes any that gets past it, and firestore.rules grant nothing without an
admin-set `status == 'active'` claim. But the outer wall is gone: anyone with
any Google account can reach the consent screen.

**If Sabeel ever wants this properly:** move the project into an `oursabeel.com`
Cloud organization (keeps the project id and all data), then set Internal. That
also fixes the larger issue that the nonprofit's production system currently
lives in a personal Google account — a continuity risk independent of OAuth.

> The app's own admin-approval gate is separate and applies to every
> `@oursabeel.com` account.

---

## D. App registration — done

- [x] **Web app registered**; its config is committed in
      `app/src/firebase-config.ts` (not secret).
- [x] **Android apps registered**: `com.sabeelinstitute.kanban` and the
      side-by-side `com.sabeelinstitute.kanban.debug`, in one
      `google-services.json` committed byte-identical at `app/` and
      `app/android/app/`.
- [x] **Fingerprints registered** — the debug key on both packages, the upload
      key, and Play's app signing key (§ F). Registration is entirely
      SERVER-SIDE: no rebuild and no `google-services.json` re-download is
      needed, because the plugin bakes no certificate hashes into the app
      (`docs/DEPLOY.md` § DEVELOPER_ERROR). The committed debug keystore's
      fingerprint (not a secret) is
      `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`; re-derive it
      with `keytool -list -v -keystore app/android/app/debug.keystore -alias androiddebugkey -storepass android -keypass android`.
- [x] **`WEB_CLIENT_ID`** committed, from `google-services.json`'s
      `client_type: 3` entry. Public, not secret.

---

## D2. iOS — registered and on TestFlight; App Review is next

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
      on a different site: registering an identifier in the portal does not
      create an app, and an upload has nowhere to land without one.
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
- [x] **APNs authentication key** (2026-08-04). It is the `APNS_KEY` secret
      the functions send to iPhones with (`functions/src/apns.ts`);
      `npm run check:apple-push` asks Apple whether it accepts the key for this
      app. **This is NOT the App Store Connect API key**, which is a different
      `.p8` that uploads builds rather than delivering pushes. Both download
      exactly once and both are real secrets; both are in the vault
      (`docs/SECRETS.md`).
- [x] **Distribution route: Unlisted App Distribution** (decided 2026-08-18).
      The Apple Developer account is an **Organization** account under Sabeel
      Institute, so the Account Holder files the unlisted request and listings
      carry the institute's name. Internal TestFlight is the channel until App
      Review. Reasoning and the alternatives rejected: `docs/IOS-BUILD.md`;
      the submission: `docs/STORE-RELEASE.md`.
- [x] **Apple Distribution certificate for GitHub builds** (2026-10-15). One
      certificate, shared by Kanban, the LMS and the time tracker; its key,
      `.p12` and the App Store profiles are in
      `~/.config/sabeel-lms/ios-distribution/` and in the vault. The Mac signs
      automatically instead (cloud-managed), so no distribution identity is ever
      in its keychain.
- [x] **Review account** (2026-10-15): `apps-reviewer@oursabeel.com`, through the
      password door, a member of the App Review board and nothing else. Its
      password is in the vault (`sabeel/review/kanban-app-review.txt`), never
      here. `docs/STORE-RELEASE.md`.

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

### iPhone builds

Builds and TestFlight uploads run on GitHub (`docs/IOS-BUILD.md` § Builds on
GitHub). What the Mac route taught, kept because none of it is guessable from
its symptom:

**The App Store Connect API key must have the Admin role.** Export failed with
`Cloud signing permission error` and `No signing certificate "iOS Distribution"
found`, while the archive itself was fine. Cloud signing
(`-allowProvisioningUpdates`) mints the distribution certificate through that
key, and **Certificates, Identifiers & Profiles answers over the API only to an
*Admin* key** — App Manager and Developer cannot reach it at all. The tell was in
the keychain: the key had created four *Apple Development* certificates ("Created
via API") and no distribution one, so it could sign for debugging and nothing
else. A new Admin key fixed it; only `ASC_KEY_ID` changed, the Issuer ID is
per-team and stayed the same, and nothing in the repo needed editing.

Two more worth reusing:

- **A cloud-managed distribution certificate never lands in the keychain.**
  After a successful export `security find-identity` still shows no distribution
  identity. Do not read that as failure.
- **Prove a signing fix by re-exporting the archive you already have**
  (`destination: export` in the options plist) rather than starting another
  twenty-minute build. It exercises exactly the step that failed and uploads
  nothing.

1. **The App Store Connect key**, for a build or upload from the Mac: every
   identifier is in `app/.env.sentry-build-plugin` (gitignored) — the Sentry
   three, `IOS_TEAM_ID`, `ASC_KEY_ID` and `ASC_ISSUER_ID`; the `.p8` itself is
   in the vault and goes in `~/.appstoreconnect/private_keys/`, the directory
   Apple's own tooling searches (`ASC_KEY_PATH` only exists for keeping it
   elsewhere). **It is NOT the APNs key**, and the two are easy to confuse
   because both download as `AuthKey_<KeyID>.p8`. The tell is the **Issuer
   ID**: an App Store Connect API key has one (a UUID), an APNs key never does.
2. **Testers**: `docs/IOS-BUILD.md` § Adding a tester.
3. **A build:**
   `gh workflow run ios.yml -R faisal-shah/sabeel-institute-kanban --ref vX.Y.Z -f testflight=true`,
   started on the release tag. From the Mac instead:
   ```bash
   git pull && npm ci
   # copy app/.env.local and app/.env.sentry-build-plugin across
   npm run build:ios -- --check     # free, proves every gate
   npm run build:ios                # archive + upload to TestFlight
   ```
4. **`expo.ios.buildNumber` rises before every upload.** Apple requires it to
   increase within a version; unlike Android's versionCode it does not derive
   itself. On App Store Connect: builds 1, 2, 4 and 6–13, the last v0.11.5
   build 13 (2026-10-16 UTC, VALID, in "Sabeel Kanban Internal"). Builds 3 and
   5 were never uploaded, which cost nothing: the number need only rise
   *within* a version, so carrying it across versions is the cheapest way never
   to collide. It is `14` now, unused. The GitHub upload job checks it with
   Apple before uploading.
5. [ ] **First thing on a TestFlight install: confirm a push arrives, and that
   tapping it with the app closed opens the card.** Apple accepts the key
   (`npm run check:apple-push`) and the sandbox path works on the simulator;
   the production service, and a tap from outside the app, only a phone can
   show. Assign yourself a card from another account, or have someone mention
   you, with the app in the background.
6. [ ] **Before 16 October 2027: renew the iOS distribution certificate and the
   App Store profiles of all three apps that share it** — Kanban, the LMS and
   the time tracker — set `IOS_DIST_P12`, `IOS_DIST_P12_PASSWORD` and
   `IOS_PROFILE` again in all three repos, and revoke the old certificate. After
   that date the gates in `build-ios.sh` stop every GitHub build in seconds
   with "expired"; the Mac is unaffected (it signs automatically). Steps:
   `docs/IOS-BUILD.md` § Renewal.
7. [ ] **App Review, then unlisted distribution**, against build 14 or later —
   build 14 carries the Next and Go keys on the email sign-in.
   `docs/STORE-RELEASE.md` owns the steps; none starts before Faisal says so.

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

> The repo side is done: `app/app.json` carries the bundle id, the plist, the
> Google Sign-In plugin and the Sentry plugin, and `npm run check:ios` guards
> all of it.

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

## F. Release signing and Play

The upload key, Play App Signing and the fingerprints are set up. Android is on
Play internal testing now; public production is the destination
(`docs/STORE-RELEASE.md`).

- [x] **The upload keystore exists**: `~/keys/sabeel-kanban-upload.jks`, read
      through the gitignored `app/android/keystore.properties`, both copied in
      the vault. **On a new machine, restore both from the vault — never
      generate a new key**: Play refuses a new upload key until Play Console
      support resets it (`docs/DEPLOY.md` § The signing and publishing files).
      Without `keystore.properties` a release build is debug-signed, and
      `build-aab.sh`, `publish:play` and `publish-apk.sh` refuse it.
- [x] **Play app created with Play App Signing**: Google generated and holds
      the app signing key; the repo's key is only the upload key.
- [x] **Fingerprints registered in Firebase** on `com.sabeelinstitute.kanban`
      (2026-08-02): the upload key
      `33:93:4A:A4:5F:51:60:23:E3:86:6F:68:84:8A:20:2C:44:28:2E:97` and Play's
      app signing key
      `A6:58:D9:33:B2:07:00:31:AF:58:5F:97:54:92:C2:6E:3D:25:77:B0`, plus the
      debug key on both packages (§ D). Play's is the one Play installs run
      under; miss it and sign-in fails with `DEVELOPER_ERROR` for Play users
      only.
- [x] **Android verified end to end (2026-08-03):** installed from the internal
      testing track, signed in, and push received on the device.
- [x] **"Sabeel staff" ticked on the track** (2026-10-16); the opt-in link
      is live on Play Console → Kanban → *Testing → Internal testing →
      Testers*. Send it to the team: Play sends no email (`docs/DEPLOY.md`
      § Testers).
- [ ] **Hand the opt-in link to Claude**, to replace "Link coming shortly" on
      the Android button of `app/public/get-app.html`.

**Target API level.** Play enforces a minimum `targetSdkVersion` and raises it
annually; ours comes from `rootProject.ext.targetSdkVersion` (Expo's default for
SDK 57). Check the current floor in the console before assuming it passes.

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

## I. Push notifications — device checks only you can do

Push is wired on all three surfaces: Android and the web through FCM, iPhones
through Apple (`APNS_KEY`; § D2 item 5 is the iPhone check). The web push VAPID
key is deployed.

- [x] **Verify a push actually arrives.** Done, on your phone, 2026-09-16:
      two mention pushes minutes apart. What the screenshot ALSO showed was the
      bug it took to v0.11.4 to fix — the two carried different small icons,
      the glyph for the one that arrived with the app closed and the launcher
      icon for the one that arrived with it open — so the next device pass sends
      one push of EACH kind and checks both icons match. The steps below stay,
      because they are the procedure for that pass.

      Install from Play and sign in.
      **Signing in does not ask for permission** — the prompt would land on the
      *Waiting for approval* screen, and Android only offers it twice ever.
      Press **Enable notifications** instead:
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

      A browser honours a permission request only straight from a click, so the
      ask is on a button.

      So: open <https://sabeel-institute-kanban.web.app>, use
      **Enable notifications** (the card on Boards, or the gear on Alerts) and
      allow it. Check the screen then reads *Notifications
      are enabled on this device*: that message means a TOKEN WAS FILED, not
      merely that permission was granted, so it is worth confirming on its own
      before involving anybody else.

      Then two things, or the test misreads:

      - **Someone else** has to do the action — `shouldNotify` drops the actor,
        so nothing is sent if you trigger it yourself.
      - **Try it both ways: once with the tab focused, once with it minimised.**
        The service worker shows every push itself, so a banner should appear
        in BOTH cases, and exactly one each time. Clicking the banner should
        focus the app. The Alerts badge goes up either way, because the
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
- [ ] Whatever else **App content** lists — privacy policy, data safety, ads,
      target audience. The answers are in `docs/STORE-RELEASE.md`.

## M. Privacy

- [ ] **Confirm `privacy@oursabeel.com` exists** (a Workspace group, two
      admins). It is published in the privacy policy, on the support page, and
      in the App Store listing.
- [ ] **Read the privacy policy** at
      https://sabeel-institute-kanban.web.app/privacy. It is short. Three things
      in it are commitments you are making: a **30-day** response to deletion
      requests, an assertion that Google, Firebase and Sentry are under
      agreements protecting the data to the same standard (and that iPhone
      notifications pass through Apple's push service), and the retention
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
