# Prompt — the iOS release, from the Mac

Hand this to the agent on the **cloud Mac**. It is written to be pasted whole.
The only thing that changes between releases is the version in §1; everything
else is standing instruction. The upload itself is not the Mac's: TestFlight
takes only the iOS workflow's build of the release tag, started by Faisal
(`gh workflow run ios.yml --ref vX.Y.Z -f testflight=true`). The Mac is for
what needs a live Mac before and after it.

Read `docs/IOS-BUILD.md` before deviating from any step here — this prompt is the
route, that file is the reasoning.

---

## The prompt

> You are checking the **iOS** release of Sabeel Kanban from the cloud Mac.
> The release is tagged and its other surfaces (the GitHub release with the
> APK, Play internal testing, web hosting) went out from that tag. The
> TestFlight upload is the iOS workflow's build of the same tag, which Faisal
> starts on GitHub; **you upload nothing from this Mac.**
>
> ### 1. What is being shipped
>
> - **Version `<X.Y.Z>`**, tag `v<X.Y.Z>`. `expo.version` and
>   `expo.ios.buildNumber` in `app/app.json` were written together by
>   `npx sabeel-ci release`: the build number is the versionCode,
>   `major * 1000000 + minor * 1000 + patch`. **Change neither**, and never add
>   `ios.version`: `expo.version` is the one number all three surfaces share,
>   and an `ios.version` override would show Apple a different one.
> - The deploy-log entry for the version is in `docs/PHASE_STATUS.md`.
>   `npm run build:ios` refuses to build without one.
> - The commit is the tag's: `git fetch --tags && git checkout v<X.Y.Z>`.
>
> ### 2. Three rules you can break expensively
>
> 1. **NEVER run a bare `npx expo prebuild`.** Prebuild defaults to *clean* — it
>    deletes and regenerates the native folder — and only clears the platforms
>    you name. `app/android/` is committed and hand-edited (it carries
>    `minSdkVersion 33`); a bare prebuild wipes it silently. Always
>    `--platform ios`. `npm run build:ios` (`sabeel-ci build-ios`) already
>    scopes it correctly, which is one reason to use it rather than the steps
>    inside it.
> 2. **`app/ios/` is a build product and is gitignored.** It is regenerated on
>    every build, so *nothing you change in Xcode's UI survives*. Anything that
>    must persist belongs in `app/app.json`. If you find yourself clicking a
>    capability back on, stop and express it under `ios.entitlements` instead.
> 3. **Do not commit anything from `app/ios/`, and do not commit a binary.**
>
> ### 3. Two files a fresh clone does not have
>
> Both are gitignored, and **neither failing announces itself**. Copy them across
> out of band before you build here:
>
> - **`app/.env.local`** — needs `EXPO_PUBLIC_SENTRY_DSN_NATIVE`. Without it the
>   build *succeeds* and ships with crash reporting silently off.
>   `EXPO_PUBLIC_*` is inlined at bundle time, so it must exist **before** the
>   build, not be added after. The build script gates on this.
> - **`app/.env.sentry-build-plugin`** — `IOS_TEAM_ID`, `SENTRY_AUTH_TOKEN`,
>   `ASC_KEY_ID`, `ASC_ISSUER_ID` (and optionally `ASC_KEY_PATH`).
>   `npm run build:ios` loads it, and takes the Sentry org and project from
>   `ci-tools.json`.
>
> And the App Store Connect API key itself:
> `~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8`. It is **not** the
> APNs key — the two `.p8` files look identical and are different keys. The ASC
> key has an Issuer ID; an APNs key does not. That is the tell.
>
> **Never paste any of these values into chat.** If one is missing, say which
> variable is missing and stop.
>
> ### 4. Build here only to inspect
>
> ```sh
> git fetch --tags && git checkout v<X.Y.Z>
> npm ci                          # also generates app/src/build-info.ts
> npm run build:ios -- --check    # every gate, builds nothing — run this FIRST
> npm run build:ios               # archive and export an .ipa; uploads nothing
> ```
>
> `--check` is free and takes seconds. It catches a missing team id, a missing
> API key, an absent deploy-log entry, a bundle-id mismatch against the plist, an
> icon with an alpha channel — each of which otherwise surfaces twenty minutes
> into an archive, or at upload, after the thing is built and signed.
>
> `npm run build:ios` (`sabeel-ci build-ios`) does the whole job: gates, the
> build stamp, `expo prebuild --platform ios`, `pod install` held to
> `app/Podfile.lock`, `xcodebuild archive`, then export to `build/ios/export`
> with `destination: export`. No Organizer, no Transporter, no signing dialog.
> Use it rather than driving Xcode — Xcode's GUI runs build phases in a
> sanitised environment and cannot see `SENTRY_AUTH_TOKEN`, so a GUI archive
> uploads no debug symbols and says nothing about it.
>
> **Build from a clean checkout of the tag.** The build stamp gets a trailing
> `+` when the tree is dirty, and a build stamped `4356b20+` maps to no commit
> at all.
>
> Worth doing when anything about signing, entitlements or the bundle has
> moved: the `.ipa` is the same kind of artifact the iOS workflow uploads, so
> three of the device checks below can be made *before* the upload spends the
> build number. `docs/IOS-BUILD.md` § What the
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
> 1. **Read the version and commit off the sign-in screen.** It must say
>    `<X.Y.Z>` and the tag's commit. Read it from the running app, not from your notes
>    — a stale `build-info.ts` has produced a build that named the wrong commit
>    while serving current source.
> 2. **The dev sign-in row must be absent.** It is stripped when `__DEV__` is
>    false; its presence means a dev bundle got shipped. Every Android release
>    build is held to this on an emulator (`sabeel-ci check-release`, in the
>    Android workflow); on an iPhone it is read off the screen.
> 3. **Sign in with an `@oursabeel.com` account.**
> 4. **Confirm a push notification arrives.** This is the one thing a simulator
>    cannot tell you: a simulator gets no real APNs token, and `xcrun simctl
>    push` only proves the app renders a notification. Whether the APNs key, its
>    upload to Firebase and token registration actually work is **unverified**
>    until a push lands on a physical device. Do not let a green simulator run
>    stand in for it.
>
> **Settled — do not re-investigate.** `expo-notifications`' config plugin,
> registered bare in `app/app.json`, writes `aps-environment` on every
> prebuild, so the capability always survives; and the export re-signs it from
> `development` to `production`. Nothing belongs under `ios.entitlements`, and
> setting `production` there by hand would break the simulator and be overwritten
> anyway. `docs/IOS-BUILD.md` has the evidence.
>
> ### 6. If the upload is rejected or the build is bad
>
> Do not touch the build number: it follows from the version, and each version
> goes to TestFlight once. A fix is a new version, released the usual way
> (`npx sabeel-ci release <X.Y.Z+1> --notes <entry>`, `docs/DEPLOY.md`).
> Report what Apple said, verbatim.
>
> ### 7. Report back
>
> - Which build reached TestFlight, and the commit hash on the sign-in screen
>   as read off the device.
> - Whether push arrived on a physical iPhone — and if you could not test it,
>   say so plainly rather than omitting it.
> - Anything you think must change, as a proposal; you commit nothing.
> - Do **not** submit for App Store review. TestFlight only.

---

## Notes for whoever hands this over

- **What changes next release:** §1's version, and nothing else.
- The build number is never bumped by hand: `npx sabeel-ci release` writes it
  with the version. `TODO.md` § Play publishing tracks what has shipped so far.
- iOS is deliberately absent through Play internal testing — that page carries
  "There is no iPhone version." Update it only once iOS is out of TestFlight and
  actually available to the team.
- The distribution certificate's private key lives in the build Mac's keychain
  and nowhere else. If this is a rebuilt Mac, export a `.p12` and store it with
  the two `.p8` keys before anything else — Apple caps how many certificates an
  account may hold, and a lost one is not recreatable.
