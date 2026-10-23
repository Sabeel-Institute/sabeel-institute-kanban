# Secrets and config

**Names and locations only. No value from this table is ever written down here,
pasted into chat, or committed.**

## The distinction that matters

Not everything here is a secret, and treating them alike leads to the wrong
instinct in both directions — hiding things that are meant to be public, and
being casual with the one thing that actually grants access.

| Kind | Examples | Handling |
|---|---|---|
| **Public by design** | Firebase web config, `WEB_CLIENT_ID`, the web push (VAPID) public key, the Sentry org and project slugs | **Committed.** Access is controlled by `firestore.rules`, never by hiding these. Hiding them would buy nothing and make setup harder. |
| **Not secret, still not committed** | Sentry client DSNs | Gitignored `app/.env.local`. They ship inside every browser and app bundle, so they cannot be secret; they are kept out of git only so a fork or public mirror does not inherit this project's event quota. |
| **Genuinely secret** | `SENTRY_DSN` and `APNS_KEY` (functions), `SENTRY_AUTH_TOKEN`, the signing keys, the Play service-account key | **Secret Manager** for the functions; a file outside the repo, copied into the vault, for build and publish credentials (below). Never in the repo, never in chat. |

## Client — gitignored `app/.env.local`

| Name | Used by | Where to get it |
|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN_WEB` | `app/src/sentry.web.ts`; `sabeel-ci ci-platform web` refuses a release web build without it | Sentry → web project → Client Keys (DSN) |
| `EXPO_PUBLIC_SENTRY_DSN_NATIVE` | `app/src/sentry.ts`; `sabeel-ci build-aab`, `build-ios` and `check:ios` refuse a release without it | Sentry → React Native project → Client Keys (DSN) |

These two names are ci-tools' and the same in every Sabeel app; `npx sabeel-ci
check-app` fails one the app does not read, or a third.

The web push (VAPID) public key is not here: it is `VAPID_PUBLIC_KEY` in
`app/src/firebase-config.ts`, committed beside the rest of the web config
(Firebase console → Project settings → Cloud Messaging → Web Push
certificates). `npm run check:web-push`, which every web release build runs,
refuses an export without it.

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
`npm run check:push -- apple` (`sabeel-ci check-push`) asks both Apple services
whether they accept the key for this app, reading it from Secret Manager;
`npm run check:push` asks FCM as well.

Bind it on any function whose failures matter, via `secrets: [sentryDsn]`.
**Every v2 function carries it** — the rule is stated rather than enumerated,
because a list here goes out of date. The one
exception is `onUserCreate`, a v1 auth trigger: v1 functions have no `secrets`
option, which is why `sentry.ts` also reads the DSN from the environment.

Under the emulators, `functions/.secret.local` (gitignored) gives each secret
a placeholder from `ci-tools.json`'s `ci.emulatorSecrets` (`SENTRY_DSN` is
`disabled`, which `sentry.ts` treats as off). Nobody keeps it by hand:
`sabeel-ci emulators`, `test-emulator` and `emulator-secrets` write it, and
`scripts/e2e.sh` runs the last before it starts its own emulators.

**Not a secret, deliberately: `PASSWORD_SIGN_IN_EMAIL`**, the one address that
may sign in with a password. Rules cannot read a secret, so it is a literal in
`firestore.rules` and `storage.rules` and in this public repository; the
account's security is its long generated password (Faisal's vault, never here)
and Firebase's rate limiting, and signed in it is a member of one board of
sample cards. `docs/STORE-RELEASE.md` § 3, The review account.

## Build machine — the shell that cuts a RELEASE, on any platform

| Name | Where it lives | Used by |
|---|---|---|
| Sentry org and projects | `ci-tools.json`'s `sentry`, committed: `devnull-ke`; `sabeel-kanban-mobile` (Android and iOS), `sabeel-kanban-web`, `sabeel-kanban-functions` | the release builds, which hand them to `sentry-cli`; never in a secret |
| `SENTRY_AUTH_TOKEN` | the gitignored `app/.env.sentry-build-plugin`; on GitHub the `BUILD_ENV` secret | the source-map and symbol uploads of every release build |

The token is an **organization** token (Sentry → Settings → Developer Settings
→ Organization Tokens, scope `org:ci`), one for every Sabeel app, and
**genuinely secret**: never in a file this repo tracks. The same file carries
the iOS build's `IOS_TEAM_ID`, `ASC_KEY_ID` and `ASC_ISSUER_ID`:

```properties
SENTRY_AUTH_TOKEN=<token>
IOS_TEAM_ID=<team id>
ASC_KEY_ID=<key id>
ASC_ISSUER_ID=<issuer id>
```

How each surface uploads, all through ci-tools (its README, "Sentry"):

- **Android** — `app/android/app/build.gradle` applies `sentry.gradle` exactly
  when `app/.env.sentry-build-plugin` exists; `sentry.gradle` hands the file to
  `sentry-cli` as `SENTRY_DOTENV_PATH`, and `sabeel-ci build-aab` and `release
  --ship` run Gradle with `SENTRY_ORG` and `SENTRY_PROJECT` from
  `ci-tools.json`. Sentry's Android Gradle plugin uploads the R8 mapping file
  the same way, under the same gate. Deliberately NOT an
  `android/sentry.properties`, which would hold a real token in a public repo. A config plugin cannot do this half:
  plugins run at `prebuild`, and `app/android/` is committed and hand-edited.
- **iOS** — `@sentry/react-native/expo` in `app/app.json`, registered
  **bare**. Given `organization`/`project` options it writes them verbatim into
  `ios/sentry.properties`, and its own code warns that an `authToken` option
  "will be written to the application package". `sabeel-ci build-ios` loads the
  file into the environment `xcodebuild` runs in and exports the org and the
  native project from `ci-tools.json`. `export` does **not** reach an Xcode GUI
  build: build phases run in a sanitised environment and Xcode 15+ does not
  inherit from a launching terminal; for one, fill in `app/ios/sentry.properties`
  (a gitignored build product — prebuild rewrites it). `docs/IOS-BUILD.md` has
  both.
- **Web** — `app/metro.config.js` builds on `getSentryExpoConfig`, so every
  script carries a debug id; `sabeel-ci ci-platform web` exports with source
  maps beside the site, and Deploy Web's `sourcemaps` job uploads them to the
  web project before the site is published.

**`app/.env.local` is NOT the mechanism for the token.** Nothing sources it:
Expo reads it to inline `EXPO_PUBLIC_*` into the JS bundle, and the release
gates read it as a file to check the DSN lines. `sentry-cli` never sees it.

**GitHub** — the whole of `app/.env.sentry-build-plugin` is the `BUILD_ENV`
secret and `app/.env.local` is `APP_ENV_LOCAL`, written into place by
`sabeel-ci ci-platform prepare-android`, `prepare-web` and `prepare-ios`; the
signing keys are secrets beside them. The table, and where each comes from, is
in `docs/IOS-BUILD.md` § Builds on GitHub. The workflows mask every value on
their own, because the logs are public and GitHub masks a multi-line secret
only line by line.

**Absent, a release refuses to build.** `sabeel-ci build-aab` and `build-ios`
stop without the token and without the native DSN, and `ci-platform web`
without the web DSN, because a release whose crashes nobody can read, or which
reports none, looks no different until the first crash. Pull-request builds
need none of it: without the file Gradle registers no Sentry tasks at all, and
a Gradle release started by hand without it only warns.

**Both native platforms report to ONE Sentry project**, since both read
`EXPO_PUBLIC_SENTRY_DSN_NATIVE`. Parity is structural, not something to
maintain.

**Do NOT run `npx @sentry/wizard`** to set this up. It rewrites committed native
files and Metro config and writes a `sentry.properties` containing a real token.
The plugin registration in `app/app.json`, the gated `apply from:` in
`build.gradle` and `app/metro.config.js` are the whole configuration.

## Build and publish credentials — files outside the repo

Each lives at its path on the machine that uses it and is copied into the vault
(below). None is ever in this repository.

| What | Live path | Used by | Vault copy |
|---|---|---|---|
| Play **upload** keystore `sabeel-kanban-upload.jks` | `~/.config/sabeel-kanban/`, beside `keystore.properties` | every release build (`build:aab`, and the Android workflow through `ANDROID_KEYSTORE`), through `keystore.properties` | `sabeel/kanban/android/` |
| `keystore.properties` (keystore path, alias and passwords) | `~/.config/sabeel-kanban/`, or the file `SABEEL_KEYSTORE_PROPERTIES` names | `signingConfigs.release`; without it Gradle refuses to package a release | `sabeel/kanban/android/` |
| `upload_certificate.pem` (public) | `~/.config/sabeel-kanban/` | a Play upload-key reset only | `sabeel/kanban/android/` |
| Play service-account key `sabeel-play-publisher.json` | `~/keys/` (or `PLAY_KEY`) | `npx sabeel-ci publish-play`; `sabeel-ci play-apk`, which `release --ship` runs | `sabeel/google-play/` |
| `app/.env.local` | gitignored | every bundle (table above) | `sabeel/kanban/env/` |
| `app/.env.sentry-build-plugin`: `SENTRY_AUTH_TOKEN`, `IOS_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID` | gitignored | every release build | `sabeel/kanban/env/` |
| App Store Connect API key `AuthKey_<ASC_KEY_ID>.p8` (Admin) | `~/.appstoreconnect/private_keys/` | `build:ios`, `sabeel-ci testflight-check`, the `ASC_KEY_P8` secret | `sabeel/apple/` |
| APNs key `AuthKey_<APNS_KEY_ID>.p8` | `~/.apns/`, or `APNS_KEY_FILE` | `npx sabeel-ci send-test-push --apple`; the `APNS_KEY` secret, which `check:push` reads | `sabeel/apple/` |
| Apple Distribution certificate (`distribution.key`, `.cer`, `.p12`, `p12-password`) and the profile `SabeelKanban_AppStore_CI.mobileprovision` | `~/.config/sabeel-lms/ios-distribution/` on the Linux machine | the GitHub secrets below | `sabeel/apple/ios-distribution/` |
| App Review password for `apps-reviewer@oursabeel.com` | nowhere else | App Store Connect → App Review Information | `sabeel/review/kanban-app-review.txt` |

**The upload keystore is never regenerated.** Play knows this key; a new one is
refused until Play support resets the upload key. A missing keystore or
`keystore.properties` is restored from the vault. On GitHub the two are the
`ANDROID_KEYSTORE` (base64) and `ANDROID_KEYSTORE_PROPERTIES` secrets of the
`release-build` environment; `sabeel-ci ci-platform prepare-android` writes
them out and names the properties file in `SABEEL_KEYSTORE_PROPERTIES`.

**The review password** is reset, if it is ever lost, on that account through
the Admin API (`accounts:update`), then written into the vault and into App
Store Connect's App Review Information.

### GitHub Actions secrets

`IOS_DIST_P12`, `IOS_DIST_P12_PASSWORD`, `IOS_PROFILE`, `ASC_KEY_P8`,
`BUILD_ENV` (`app/.env.sentry-build-plugin`), `APP_ENV_LOCAL`
(`app/.env.local`), `ANDROID_KEYSTORE` and `ANDROID_KEYSTORE_PROPERTIES`, each
set from the files above as secrets of the `release-build` environment, which
only main and `v*` tags may enter. `npx sabeel-ci check-app` (in CI) fails a
workflow that reads one outside it. The table of iOS sources and the `gh secret
set` commands are in `docs/IOS-BUILD.md` § Builds on GitHub;
`docs/GITHUB-ACTIONS.md` has the rest.

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
