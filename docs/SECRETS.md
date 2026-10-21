# Secrets and config

**Names and locations only. No value from this table is ever written down here,
pasted into chat, or committed.**

## The distinction that matters

Not everything here is a secret, and treating them alike leads to the wrong
instinct in both directions — hiding things that are meant to be public, and
being casual with the one thing that actually grants access.

| Kind | Examples | Handling |
|---|---|---|
| **Public by design** | Firebase web config, `WEB_CLIENT_ID` | **Committed.** Access is controlled by `firestore.rules`, never by hiding these. Hiding them would buy nothing and make setup harder. |
| **Not secret, still not committed** | Sentry client DSNs | Gitignored `app/.env.local`. They ship inside every browser and app bundle, so they cannot be secret; they are kept out of git only so a fork or public mirror does not inherit this project's event quota. |
| **Genuinely secret** | `SENTRY_DSN` and `APNS_KEY` (functions), `SENTRY_AUTH_TOKEN`, the signing keys, the Play service-account key | **Secret Manager** for the functions; a file outside the repo, copied into the vault, for build and publish credentials (below). Never in the repo, never in chat. |

## Client — gitignored `app/.env.local`

| Name | Used by | Where to get it |
|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN_WEB` | `app/src/sentry.web.ts` | Sentry → web project → Client Keys (DSN) |
| `EXPO_PUBLIC_SENTRY_DSN_NATIVE` | `app/src/sentry.ts` | Sentry → React Native project → Client Keys (DSN) |
| `EXPO_PUBLIC_FCM_VAPID_KEY` | `app/src/notify.web.ts`: web push | Firebase console → Project settings → Cloud Messaging → Web Push certificates (console only). `npm run check:web-push` refuses a bundle without it |

Web and native are **separate Sentry projects** with separate DSNs, so their
releases and source maps do not collide. A single shared variable would send
Android crashes to the web project.

`EXPO_PUBLIC_*` values are **inlined into the bundle at build time**. That is why
they must be non-secret: anyone with the app has them.

## Server — Secret Manager

| Name | Used by | Set with |
|---|---|---|
| `SENTRY_DSN` | `functions/src/sentry.ts` | `firebase functions:secrets:set SENTRY_DSN` |
| `APNS_KEY` | `functions/src/messaging.ts`: the team's APNs `.p8`, which signs every push to an iPhone | `firebase functions:secrets:set APNS_KEY --data-file AuthKey_<id>.p8` |

`APNS_KEY` is an **APNs authentication key** (developer portal → Keys), NOT
the App Store Connect API key (`docs/IOS-BUILD.md`, "The two `.p8` keys").
Its id and the team id are not secret, and sit beside it as parameters in
`functions/.env.sabeel-institute-kanban`. Every function that sends a push binds
it through `secrets: [sentryDsn, ...PUSH_SECRETS]`, and
`functions/test/unit/pushSecrets.test.ts` finds those functions and fails on one
that does not: unbound, a secret reads as empty, and iPhones hear nothing.
`npm run check:apple-push` asks Apple whether it accepts the key for this app.

Bind it on any function whose failures matter, via `secrets: [sentryDsn]`.
**Every v2 function carries it** — the rule is stated rather than enumerated,
because a list here goes out of date. The one
exception is `onUserCreate`, a v1 auth trigger: v1 functions have no `secrets`
option, which is why `sentry.ts` also reads the DSN from the environment.

Locally, `functions/.secret.local` (gitignored) sets it empty so the emulator
never reports. The emulator still logs one 403 at startup trying to reach real
Secret Manager — harmless, not silenced, and not a new failure.

**Not a secret, deliberately: `PASSWORD_SIGN_IN_EMAIL`**, the one address that
may sign in with a password. Rules cannot read a secret, so it is a literal in
`firestore.rules` and `storage.rules` and in this public repository; the
account's security is its long generated password (Faisal's vault, never here)
and Firebase's rate limiting, and signed in it is a member of one board of
sample cards. `docs/STORE-RELEASE.md` § 3, The review account.

## Build machine — the shell that cuts a RELEASE, on either platform

| Name | Used by | Where to get it |
|---|---|---|
| `SENTRY_ORG` | both native builds | Sentry → Settings → the org URL slug |
| `SENTRY_PROJECT` | both | the **React Native** project — Android and iOS share it |
| `SENTRY_AUTH_TOKEN` | both | An **organization** token: Settings → Developer Settings → Organization Tokens. Scope `org:ci` — see below |

Only the first two are non-secret. **The token is genuinely secret** and belongs
in the build shell's environment, never in a file this repo tracks.

**One set of names for both platforms**, reached two different ways because the
two native folders are managed differently:

- **iOS** — `@sentry/react-native/expo` in `app/app.json`, registered **bare**.
  Given `organization`/`project` options it writes them verbatim into
  `ios/sentry.properties`, and **this repo is public**; its own code also warns
  that an `authToken` option "will be written to the application package". Bare,
  it falls back to these three variables.
- **Android** — `app/android/app/build.gradle` applies `sentry.gradle`, but
  **only when `SENTRY_AUTH_TOKEN` is set**. `sentry-cli` reads all three from the
  environment. Deliberately NOT the sibling time-tracker's committed-example
  `android/sentry.properties`: a second file holding the same three values is a
  second thing to keep in step, and this one would hold a real token in a public
  repo.

### Getting them into the build, on each machine

**`app/.env.local` is NOT the mechanism.** Nothing sources it: Expo reads it to
inline `EXPO_PUBLIC_*` into the JS bundle, and two gates read it as a file to
check the DSN line exists. `sentry-cli` never sees it, so `SENTRY_*` placed there
does nothing at all — silently, since the build still succeeds.

**Linux, for `npm run build:aab`** — either works, pick one:

- `export` them in the shell (or keep them in a gitignored file you `source`).
- Put them in **`app/.env.sentry-build-plugin`**, which `sentry.gradle` finds on
  its own — it sets `SENTRY_DOTENV_PATH` to that file when it exists. Same
  ergonomics as `.env.local`, no shell ceremony, and already gitignored.

  ```properties
  SENTRY_ORG=<org slug>
  SENTRY_PROJECT=<native project>
  SENTRY_AUTH_TOKEN=<token>
  ```

**Mac, for Xcode** — `export` does **not** reach an Xcode GUI build: build phases
run in a sanitised environment and Xcode 15+ does not inherit from a launching
terminal. Fill in `app/ios/sentry.properties` (a gitignored build product, so
this is not repo config — but prebuild rewrites it), or archive with `xcodebuild`
from the shell, which does inherit. `docs/IOS-BUILD.md` has both.

**GitHub, for `ios.yml`** — the whole of `app/.env.sentry-build-plugin` is the
`IOS_BUILD_ENV` secret and `app/.env.local` is `APP_ENV_LOCAL`, written into
place before the build; the Apple Distribution certificate, the App Store
profile and the App Store Connect key are secrets beside them. The table, and
where each comes from, is in `docs/IOS-BUILD.md` § Builds on GitHub. The
workflow masks every value on its own, because the logs are public and GitHub
masks a multi-line secret only line by line.

A config plugin cannot do the Android half. Plugins run at `prebuild`, and
`app/android/` is committed and hand-edited — prebuild here is always scoped
`--platform ios`. Gradle is the only mechanism that reaches it.

**Both platforms report to ONE Sentry project**, since both read
`EXPO_PUBLIC_SENTRY_DSN_NATIVE`. Parity is structural, not something to maintain.

Absent, both builds **succeed and upload nothing**, so crashes arrive as
minified frames with nothing failing to say so. Said out loud in two places
rather than enforced: `npm run check:ios` warns, and `scripts/build-aab.sh`
warns. Neither fails — unlike the DSN gate beside it, which does. The difference
is deliberate: no DSN means *no reports at all*, while no token means reports
that are merely harder to read, and blocking a release on a machine that has no
token would be the worse trade.

The Android gate is also what keeps this safe: with no token the release build
registers no Sentry tasks at all — verified by diffing the Gradle task graph —
so CI and a fresh clone build exactly what they built before, and the release
path never depends on reaching sentry.io.

**Do NOT run `npx @sentry/wizard`** to set this up. It rewrites committed native
files and Metro config and writes a `sentry.properties` containing a real token.
The plugin registration in `app/app.json` and the gated `apply from:` in
`build.gradle` are the whole configuration.

## Build and publish credentials — files outside the repo

Each lives at its path on the machine that uses it and is copied into the vault
(below). None is ever in this repository.

| What | Live path | Used by | Vault copy |
|---|---|---|---|
| Play **upload** keystore `sabeel-kanban-upload.jks` | `~/keys/` | `build:aab`, `build:apk`, through `keystore.properties` | `sabeel/kanban/android/` |
| `keystore.properties` (keystore path and passwords) | `app/android/` (gitignored) | `signingConfigs.release` | `sabeel/kanban/android/` |
| `upload_certificate.pem` (public) | `~/keys/` | a Play upload-key reset only | `sabeel/kanban/android/` |
| Play service-account key `sabeel-play-publisher.json` | `~/keys/` (or `SK_PLAY_KEY`) | `npm run publish:play` | `sabeel/google-play/` |
| `app/.env.local` | gitignored | every bundle (table above) | `sabeel/kanban/env/` |
| `app/.env.sentry-build-plugin`: the Sentry three, `IOS_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID` | gitignored | native release builds, `build:ios` | `sabeel/kanban/env/` |
| App Store Connect API key `AuthKey_<ASC_KEY_ID>.p8` (Admin) | `~/.appstoreconnect/private_keys/` | `build:ios`, `testflight-check.mjs`, the `ASC_KEY_P8` secret | `sabeel/apple/` |
| APNs key `AuthKey_<APNS_KEY_ID>.p8` | `~/.apns/`, or `APNS_KEY_FILE` | `send-test-push.mjs`, `check-apple-push`; the `APNS_KEY` secret | `sabeel/apple/` |
| Apple Distribution certificate (`distribution.key`, `.cer`, `.p12`, `p12-password`) and the profile `SabeelKanban_AppStore_CI.mobileprovision` | `~/.config/sabeel-lms/ios-distribution/` on the Linux machine | the GitHub secrets below | `sabeel/apple/ios-distribution/` |
| App Review password for `apps-reviewer@oursabeel.com` | nowhere else | App Store Connect → App Review Information | `sabeel/review/kanban-app-review.txt` |

**The upload keystore is never regenerated.** Play knows this key; a new one is
refused until Play support resets the upload key. A missing keystore or
`keystore.properties` is restored from the vault.

**The review password** is reset, if it is ever lost, on that account through
the Admin API (`accounts:update`), then written into the vault and into App
Store Connect's App Review Information.

### GitHub Actions secrets (`ios.yml`)

`IOS_DIST_P12`, `IOS_DIST_P12_PASSWORD`, `IOS_PROFILE`, `ASC_KEY_P8`,
`IOS_BUILD_ENV` (`app/.env.sentry-build-plugin`) and `APP_ENV_LOCAL`
(`app/.env.local`), each set from the files above as secrets of the
`release-build` environment, which only main and `v*` tags may enter. The table
of sources and the `gh secret set` commands are in `docs/IOS-BUILD.md` § Builds
on GitHub.

### The vault

`~/.config/secrets-vault/` on Faisal's Linux machine holds a copy of every file
above, laid out as the last column says, with `sources.tsv` naming each live
path, and is kept off the machine in secure storage.

```sh
bash ~/.config/secrets-vault/vault.sh verify    # every copy matches its live file
bash ~/.config/secrets-vault/vault.sh collect   # copy every live file in again, then verify
```

Run `collect` after any secret changes, and add a new secret file to
`sources.tsv` the day it is made.

**A releaser who is not Faisal** gets each file from the vault owner, out of
band, and puts it at its live path. Nothing here is regenerated to avoid
asking: Play refuses a new upload key until support resets it, and the
distribution certificate is shared by three apps under a per-team cap.

## Reporting is off against the emulators

Both app seams gate on `USE_EMULATORS`, so a DSN in `.env.local` is ignored
whenever the app points at the emulators. Local runs and e2e passes would
otherwise file fake errors into the production project, burning a 5K/month quota
on noise. It was not only wasteful: the browser SDK wraps `fetch` and beacons to
an ingest host the test environment cannot reach, which stalled a sign-in flow
and aborted the suite until this gate was added.

## Deliberately NOT configured

- **Web source-map upload.** Not wired: a web stack trace still names the bundle
  chunk and the line, and the web bundle is not minified past readability the way
  a Hermes bytecode frame is. Android and iOS *are* wired — see the build-machine
  section above.
- **Any mail credential.** Report a problem sends as
  `apps-noreply@oursabeel.com` through domain-wide delegation with no password
  and no key: the function signs a delegation token as
  `report-mailer@sabeel-institute-kanban.iam.gserviceaccount.com` through IAM,
  which it may do because its runtime account holds
  `roles/iam.serviceAccountTokenCreator` on that service account
  (`docs/DEPLOY.md` § Prerequisites). The service account's name is a function
  parameter, `REPORT_MAILER_SERVICE_ACCOUNT` in
  `functions/.env.sabeel-institute-kanban`, not a secret. The rights it carries
  are the IAM grant and the Admin console's delegation entry (scope
  `gmail.send` only); there is nothing to put in Secret Manager or the vault.
- **Any Cloud Storage credential** — the attachments bucket
  (`sabeel-institute-kanban.firebasestorage.app`) is reached through the Admin
  SDK and the client Firebase config, neither of which is a secret, and signed
  URLs are minted by the functions' own service account.

## What Sentry is allowed to know

`setErrorUser` sends the **uid only — never email or display name**. The uid
correlates with the `users` collection when someone needs to trace a report,
which is all triage requires. Putting staff email addresses into a third-party
service is a disclosure this app has no reason to make. The web and native seams
must not diverge on this.
