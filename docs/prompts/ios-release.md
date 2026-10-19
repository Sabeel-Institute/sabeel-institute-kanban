# Prompt — cut the iOS release

Hand this to the agent on the **cloud Mac**. It is written to be pasted whole.
The only thing that changes between releases is the version and build number in
§1; everything else is standing instruction.

Read `docs/IOS-BUILD.md` before deviating from any step here — this prompt is the
route, that file is the reasoning.

---

## The prompt

> You are cutting the **iOS** release of Sabeel Kanban from the cloud Mac.
> The other three surfaces (web hosting, versioned GitHub APK releases, Play internal
> testing) are already shipped from `main`; iOS is its own runbook and is the
> only surface left.
>
> ### 1. What you are shipping
>
> - **Version `0.8.0`**, iOS **build number `4`**. Both are already set in
>   `app/app.json` — `expo.version` and `expo.ios.buildNumber`. **Do not change
>   either** unless a gate below tells you to, and never add `ios.version`:
>   `expo.version` is the one number all three surfaces share, and an
>   `ios.version` override would show Apple a different one.
> - The deploy-log entry for v0.8.0 is already written in
>   `docs/PHASE_STATUS.md`. `build-ios.sh` refuses to build without one.
> - The commit to build is the tip of `main`. Start with `git pull`.
>
> ### 2. Three rules you can break expensively
>
> 1. **NEVER run a bare `npx expo prebuild`.** Prebuild defaults to *clean* — it
>    deletes and regenerates the native folder — and only clears the platforms
>    you name. `app/android/` is committed and hand-edited (it carries
>    `minSdkVersion 33`); a bare prebuild wipes it silently. Always
>    `--platform ios`. `scripts/build-ios.sh` already scopes it correctly, which
>    is one reason to use the script rather than the steps inside it.
> 2. **`app/ios/` is a build product and is gitignored.** It is regenerated on
>    every build, so *nothing you change in Xcode's UI survives*. Anything that
>    must persist belongs in `app/app.json`. If you find yourself clicking a
>    capability back on, stop and express it under `ios.entitlements` instead.
> 3. **Do not commit anything from `app/ios/`, and do not commit a binary.**
>
> ### 3. Two files a fresh clone does not have
>
> Both are gitignored, and **neither failing announces itself**. Copy them across
> out of band before you build:
>
> - **`app/.env.local`** — needs `EXPO_PUBLIC_SENTRY_DSN_NATIVE`. Without it the
>   build *succeeds* and ships with crash reporting silently off.
>   `EXPO_PUBLIC_*` is inlined at bundle time, so it must exist **before** the
>   build, not be added after. The build script gates on this.
> - **`app/.env.sentry-build-plugin`** — `IOS_TEAM_ID`, `SENTRY_ORG`,
>   `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `ASC_KEY_ID`, `ASC_ISSUER_ID` (and
>   optionally `ASC_KEY_PATH`). `scripts/load-build-env.sh` reads it.
>
> And the App Store Connect API key itself:
> `~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8`. It is **not** the
> APNs key — the two `.p8` files look identical and are different keys. The ASC
> key has an Issuer ID; an APNs key does not. That is the tell.
>
> **Never paste any of these values into chat.** If one is missing, say which
> variable is missing and stop.
>
> ### 4. Build and upload
>
> ```sh
> git pull
> npm ci                          # also generates app/src/build-info.ts
> npm run build:ios -- --check    # every gate, builds nothing — run this FIRST
> npm run build:ios               # archive, export, upload to TestFlight
> ```
>
> `--check` is free and takes seconds. It catches a missing team id, a missing
> API key, an absent deploy-log entry, a bundle-id mismatch against the plist, an
> icon with an alpha channel — each of which otherwise surfaces twenty minutes
> into an archive, or at upload, after the thing is built and signed.
>
> `scripts/build-ios.sh` does the whole job: gates, `gen-build-info`,
> `expo prebuild --platform ios`, `pod install`, `xcodebuild archive`, then
> export with `destination: upload`. No Organizer, no Transporter, no signing
> dialog. Use it rather than driving Xcode — Xcode's GUI runs build phases in a
> sanitised environment and cannot see `SENTRY_AUTH_TOKEN`, so a GUI archive
> uploads no debug symbols and says nothing about it.
>
> **Commit everything first, then build.** `gen-build-info.mjs` stamps a trailing
> `+` on the commit when the tree is dirty, and a build stamped `4356b20+` maps
> to no commit at all. Fixing a build script and rerunning earns that `+` even
> though nothing about the app changed.
>
> `npm run build:ios -- --no-upload` stops at the `.ipa`. Worth doing when
> anything about signing, entitlements or the bundle has moved: it exports the
> same artifact the uploading run would send, so three of the device checks below
> can be made *before* a build number is spent. `docs/IOS-BUILD.md` § What the
> `.ipa` can tell you before you upload has the commands — including the two
> Hermes traps that make the obvious `grep` lie to you.
>
> ### 5. What to verify, and what you cannot
>
> **Before uploading**, if anything about sign-in has changed, build once to the
> simulator and sign in: `cd app && npx expo run:ios`. Google Sign-In opens a web
> session and returns through the URL scheme, which is the single most likely
> thing to be misconfigured, and the simulator proves it. The symptom of a wrong
> `iosUrlScheme` is *nothing at all* — Safari opens, you pick an account, and the
> app never comes back.
>
> **After the upload**, on a real iPhone through TestFlight:
>
> 1. **Read the version and commit off the sign-in screen.** It must say `0.8.0`
>    and the commit you built. Read it from the running app, not from your notes
>    — a stale `build-info.ts` has produced a build that named the wrong commit
>    while serving current source.
> 2. **The dev sign-in row must be absent.** It is stripped when `__DEV__` is
>    false; its presence means a dev bundle got shipped.
> 3. **Sign in with an `@oursabeel.com` account.**
> 4. **Confirm a push notification arrives.** This is the one thing a simulator
>    cannot tell you: a simulator gets no real APNs token, and `xcrun simctl
>    push` only proves the app renders a notification. Whether the APNs key, its
>    upload to Firebase and token registration actually work is **unverified**
>    until a push lands on a physical device. Do not let a green simulator run
>    stand in for it.
>
> **Settled 2026-08-15 — do not re-investigate.** `expo-notifications` applies
> its own config plugin automatically and writes `aps-environment` on every
> prebuild, so the capability always survives; and the export re-signs it from
> `development` to `production`. Nothing belongs under `ios.entitlements`, and
> setting `production` there by hand would break the simulator and be overwritten
> anyway. `docs/IOS-BUILD.md` has the evidence.
>
> ### 6. If the upload is rejected or the build is bad
>
> Bump `expo.ios.buildNumber` in `app/app.json` and build again. Apple requires
> it to increase on **every** upload, even for the same version; unlike Android's
> `versionCode` it does not derive itself. A monotonically increasing integer is
> always valid — there is no need to reason about resetting it per version.
> Commit that bump with a message in this repo's style, e.g.
> `chore(ios): v0.8.0 build 4 was rejected, so buildNumber is 5`.
>
> ### 7. Report back
>
> - Which build number actually reached TestFlight, and the commit hash on the
>   sign-in screen as read off the device.
> - Whether push arrived on a physical iPhone — and if you could not test it,
>   say so plainly rather than omitting it.
> - Anything you had to change in `app/app.json`, as a commit.
> - Do **not** submit for App Store review. TestFlight only.

---

## Notes for whoever hands this over

- **What changes next release:** §1's version and build number, and nothing else.
- `expo.ios.buildNumber` must be bumped *before* handing this over if the current
  number has already been uploaded. `TODO.md` § Play publishing tracks what has
  shipped so far.
- iOS is deliberately absent through Play internal testing — that page carries
  "There is no iPhone version." Update it only once iOS is out of TestFlight and
  actually available to the team.
- The distribution certificate's private key lives in the build Mac's keychain
  and nowhere else. If this is a rebuilt Mac, export a `.p12` and store it with
  the two `.p8` keys before anything else — Apple caps how many certificates an
  account may hold, and a lost one is not recreatable.
