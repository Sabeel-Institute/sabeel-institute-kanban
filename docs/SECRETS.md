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
| **Genuinely secret** | `SENTRY_DSN` (functions), `SENTRY_AUTH_TOKEN`, any service-account key | **Secret Manager**, or nothing. Never in the repo, never in chat. |

## Client — gitignored `app/.env.local`

| Name | Used by | Where to get it |
|---|---|---|
| `EXPO_PUBLIC_SENTRY_DSN_WEB` | `app/src/sentry.web.ts` | Sentry → web project → Client Keys (DSN) |
| `EXPO_PUBLIC_SENTRY_DSN_NATIVE` | `app/src/sentry.ts` | Sentry → React Native project → Client Keys (DSN) |

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
**Every v2 function carries it** — the list here used to name three and was four
releases out of date, so the rule is stated instead of enumerated. The one
exception is `onUserCreate`, a v1 auth trigger: v1 functions have no `secrets`
option, which is why `sentry.ts` also reads the DSN from the environment.

Locally, `functions/.secret.local` (gitignored) sets it empty so the emulator
never reports. The emulator still logs one 403 at startup trying to reach real
Secret Manager — harmless, not silenced, and not a new failure.

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
- **Any Cloud Storage credential** — the bucket is reached through the Admin SDK
  and the client Firebase config, neither of which is a secret. No bucket
  is provisioned.

## What Sentry is allowed to know

`setErrorUser` sends the **uid only — never email or display name**. The uid
correlates with the `users` collection when someone needs to trace a report,
which is all triage requires. Putting staff email addresses into a third-party
service is a disclosure this app has no reason to make. The web and native seams
must not diverge on this.
