# Sabeel Institute Kanban

Automatic platform builds and manual release controls are documented in
[GitHub Actions](docs/GITHUB-ACTIONS.md).

Access-controlled kanban boards for Sabeel Institute — Android and iPhone apps
and a responsive website from one Expo codebase, on a Firebase backend. Replaces
ClickUp.

**Docs**
- `docs/USER-MANUAL.md` — what the app does, for the people using it. Built to
  `docs/USER-MANUAL.pdf` with `npx sabeel-ci render-manual`; its screenshots
  come from `scripts/manual-shots.mjs`.
- `docs/PRODUCT_BRIEF.md` — decisions, data model, access rules. Source of truth.
- `docs/PERMISSIONS.md` — who can do what.
- `docs/PHASE_STATUS.md` — the phase plan, exit criteria, live build status, and
  the **deploy log** (what shipped, when, and what it broke).
- `docs/DEV-TOOLING.md` — the dev loops: emulators, tests, dead code,
  screenshots, the screen sweep.
- `docs/DEPLOY.md` — the access a releaser needs, deploying, shipping a release
  (web, Play, versioned GitHub APK releases, TestFlight), rollback.
- `docs/IOS-BUILD.md` — the iPhone app: builds on GitHub, TestFlight testers,
  signing and its renewal.
- `docs/STORE-RELEASE.md` — Kanban on the App Store and Google Play: where it
  stands, its store answers, the review account, the submission checklist. The
  decisions shared by every Sabeel app are in the `sabeel-app-stores` skill
  (`Sabeel-Institute/brand`).
- `docs/BRAND.md` — the authority for Sabeel Institute colors (the designer's
  Option 1 palette, shared with the time-tracker; supersedes the archived
  `docs/brand/sabeel-color-usage-guide.jpg`). Consult before any design decision.
- `docs/INHERITED-STACK.md` — what carries over from the sibling time-tracker
  project, and the traps it already paid for.
- `docs/SECRETS.md` — which values are secret, where each one lives, and the
  vault that holds a copy of every file.
- `docs/MIGRATION.md` — the ClickUp import, done once.
- `docs/STACK-GOTCHAS.md` — a stub; the traps live in the `expo-firebase-stack`
  skill, which is public and shared with the sibling project.
- `TODO.md` — console and account steps only Faisal can do.
- `CLAUDE.md` — working rules for the agent.

## Quick start

```sh
npm install                 # also builds @sabeel/shared

npm run lint                # ESLint, the version check, no control bytes
npm run typecheck
npm run knip                # dead code: unused files, exports, dependencies
npm test                    # Vitest: shared, functions and app unit tests
npm run test:emulator       # rules and functions against the emulators (JDK 21)
npx sabeel-ci check-app     # what the shared CI tooling assumes of this repo
```

**End-to-end** (each starts its own emulators; all six run in CI)

```sh
npm run test:e2e                # access + board flow
npm run test:e2e:attachments    # files on cards
npm run test:e2e:stats          # the chart, nine widths
npm run test:e2e:richtext       # the web rich-text editor
npm run test:e2e:typing-perf    # typing stays fast on a busy card
npm run test:screens            # every screen, five widths
scripts/e2e-all.sh              # all of them, one at a time
```

**Web**

```sh
npm run dev:web                     # dev server against the EMULATORS  ← use this
npm run web:export -w @sabeel/app   # production bundle → app/dist-web
node scripts/web-shot.mjs           # screenshot the UI → shots/
```

> `npm run web -w @sabeel/app` starts the same server **without**
> `EXPO_PUBLIC_USE_EMULATORS=1`, which points it at **production Firebase** —
> real boards, real people. `npm run dev:web` (and `scripts/dev.sh web`) set the
> flag. Nothing in the UI announces which backend you are on, so prefer the
> wrappers.

**Android** (emulator only — there are no physical devices)

```sh
npx sabeel-ci emulator headless        # boot the tb_emu AVD (SABEEL_AVD)
npm run android -w @sabeel/app         # build, install, launch
npx sabeel-ci emulator shot my-screen  # → shots/my-screen.png
```

> Metro port 8081 is shared with the other React Native projects on this machine.
> The emulator reaches Metro at `10.0.2.2:8081` directly, so `adb reverse` cannot
> redirect it. `sabeel-ci preflight-metro` (in `npm run android` and `start`)
> refuses to start if another project's Metro holds the port — otherwise you get
> a red screen quoting a different repo's paths after a successful build.

## Layout

```
app/            @sabeel/app — Expo + react-native-web (Android, iOS, web)
functions/      Cloud Functions (nodejs22, esbuild-bundled)
packages/shared @sabeel/shared — types, constants, cross-surface logic
scripts/        the app's own tools: browser suites, dev loop, seed, screenshots,
                migrations
docs/           manual, product brief, phase plan, deploy and brand guides
ci-tools.json   this app's settings for the shared CI, release and device tooling
```

CI, releases, the emulators and device checks run through the shared
[ci-tools](https://github.com/Sabeel-Institute/ci-tools) package, pinned in
`package-lock.json`: `npx sabeel-ci <command>` (its README lists them). The
workflows in `.github/workflows/` are rendered from it.

The app is a **single light theme — there is no dark mode** (decided
2026-07-21), and every colour goes through a semantic token; ESLint rejects a
hardcoded one. `app/src/theme/palette.ts` is the only exception, and is where
`docs/BRAND.md`'s palette lives.
