# Dev tooling

Local development runs against the Firebase emulators, which need no accounts,
no keys and no network; production is `sabeel-institute-kanban`
(`docs/DEPLOY.md`).

## Prerequisites

Node 22+, **two** JDKs — 21 for the emulators (they are Java), 17 as the default
`java` because the Android Gradle Plugin targets it — and the Android SDK with
the `tb_emu` AVD.

Do not install these by hand. The `expo-firebase-stack` skill in
`../agent-skills/` carries a bootstrap that does the lot under `$HOME` with no
root, and is idempotent:

```sh
../agent-skills/skills/expo-firebase-stack/tools/check-host.sh   # what is missing
../agent-skills/skills/expo-firebase-stack/tools/bootstrap-linux.sh \
    --jdk21-aliases SABEEL --repo "$PWD"
```

`--jdk21-aliases SABEEL` sets `SABEEL_JDK21_HOME`, the first place `npx
sabeel-ci jdk21` looks for JDK 21 for the emulators; the Gradle default stays
17. After it, `~/opt/jdk-21`, `JAVA_HOME`, the `java` on `PATH`, and where a Mac
keeps one (`java_home -v 21`, Homebrew's `openjdk@21`, Android Studio's
runtime), each run rather than trusted for existing — so a machine set up
differently still works, but the variable is the reliable route.

The CI, release, emulator and device tooling is the shared
`Sabeel-Institute/ci-tools` package, a dev dependency pinned to a commit in
`package-lock.json` and run as `npx sabeel-ci <command>` (its README lists
them); `ci-tools.json` says what differs for this app. `scripts/` holds this
app's own tools: the browser suites and their runner, the seed, the dev loop,
the first-admin bootstrap and the data migrations.

```sh
npm install     # once
```

## The quickest look: web

Two terminals.

**Terminal 1 — emulators** (Firestore, Auth, Functions, Storage):

```sh
npm run emulators
```

`sabeel-ci emulators`: it frees this checkout's ports, builds the functions
(the Functions emulator loads the built bundle, so without the build it serves
stale triggers, or none), and starts every emulator `firebase.json` runs under
the demo project `demo-sabeel-kanban`. `npm run emulators:free` (`sabeel-ci
free-emulator-ports`) stops a leftover run by itself: it stops only processes
working inside this checkout, names any other holder of the block's ports with
its pid and directory and stops nothing, and reaps functions runtimes an
interrupted run orphaned.

> **This checkout owns the port block 61200-61299**, ci-tools' block for this
> app (`emulators.base` in `ci-tools.json`): firestore 61200, its websocket
> 61201, auth 61202, functions 61203, ui 61204, hub 61205, logging 61206,
> storage 61207, tasks 61208, eventarc 61209, and **61210** for the Expo web
> dev server. Every Sabeel app sits at the same offsets in its own block (the
> time tracker 61000+, LMS 61300+), so a port in a `ss` or `ps` line names its
> app and service at a glance.
>
> The apps share this machine. On Firebase's default ports, whichever suite
> started second would kill the other's Firestore — and the victim's symptoms
> would look like bugs in its own code. 61000+ because this box's ephemeral
> range is 32768-60999 and Firebase's own defaults stop at 9499, so the block
> collides with nothing chosen at random or by the CLI.
>
> Scripts read the ports from ci-tools and state none: `scripts/lib/emulators.mjs`
> in Node, `npx sabeel-ci ports <name>` in shell (`npx sabeel-ci ports` lists
> them all). `firebase.json` and `app/src/env.ts` cannot, so they state them,
> and `npx sabeel-ci check-app` (in CI) holds both in step with `ci-tools.json`
> and fails a script or `package.json` that states one.
>
> **Metro's 8081 and idb's 10882 stay shared** — the Android emulator reaches the
> host directly at `10.0.2.2:8081`, so that port cannot move. Concurrent *web*
> work across repos is fine; concurrent *native* work is one session at a time.

Leave it running. The Emulator UI is at http://127.0.0.1:61204 — useful for
inspecting Firestore documents and Auth users directly.

> You will see `dueSoonReminders: function ignored because the pubsub emulator
> does not exist or is not running`. That is expected: the daily due-soon sweep
> is a **scheduled** function, and scheduled functions do not run locally. Every
> other trigger — provisioning, comments, activity, notifications — does. To
> exercise the sweep, invoke it manually from the Functions emulator shell, or
> wait until it runs in production.

## Just use `scripts/dev.sh`

```sh
scripts/dev.sh status     # what is running, and which process owns each port
scripts/dev.sh stop       # stop what dev.sh started, and VERIFY the ports
scripts/dev.sh web        # stop, start emulators + web, seed
scripts/dev.sh android    # stop, start emulators + Metro for the device build
scripts/dev.sh e2e        # stop, then run the full suite
```

Always `stop` before starting anything. A stale emulator or Metro holding a port
fails in ways that look like application bugs — `Could not start Authentication
Emulator, port taken`, or worse, a dev server that answers on the web port while
serving code from a different checkout. `stop` re-checks the ports afterwards rather than
trusting that a kill worked, because a silently-failed kill is exactly how a
"cleared" port keeps serving yesterday's bundle.

`stop` stops only what `dev.sh` started: each job runs in a process group of its
own, recorded in `.dev-pids` (gitignored). Anything else holding one of this
checkout's ports is reported with its pid and working directory and left
running: stop it by that pid if it is yours. Metro's 8081 and idb's 10882 are
shared with every other checkout on the machine, so `stop` never touches them,
and `android`/`ios` refuse to start Metro while someone else holds 8081.

### Debugging habits that keep paying off

- **`status` first, always.** Half a dozen sessions were lost to a process
  nobody knew was still running.
- **Never pipe a long-running command through `grep` to a log you intend to
  read while it runs.** grep buffers when its output is not a terminal, so the
  file stays empty and the run looks hung. Write the full output, then grep the
  file. (`grep --line-buffered` if you must filter live.)
- **Write logs to `/tmp/sk-*.log`, not the agent scratchpad** — the scratchpad
  gets cleaned mid-session and the evidence disappears with it.
- **Background jobs must outlive their launcher** (`nohup … & disown`), or they
  die with the shell and you debug a process that is not running.
- **Verify by using the app, not by reading coordinates.** A control can be
  on-screen and still unreachable. Type the comment and post it.
- **Re-test without touching anything.** If confirming a fix needs a scroll or a
  retry, your interaction may be producing the result rather than the fix.

**Terminal 2 — the app:**

```sh
npm run dev:web
```

Opens on http://localhost:61210.

**Terminal 3 — something to look at (optional):**

```sh
npm run seed
```

Creates three people, a board with eight columns and six cards by driving the
UI, so a seed that succeeds is also evidence the flow works. It is re-runnable:
each step is skipped if it has already happened.

The emulators start empty every time. To wipe them mid-session without a
restart:

```sh
curl -X DELETE "http://127.0.0.1:61200/emulator/v1/projects/demo-sabeel-kanban/databases/(default)/documents"
curl -X DELETE "http://127.0.0.1:61202/emulator/v1/projects/demo-sabeel-kanban/accounts"
```

## Android

> **The AVD needs hardware virtualization, and a VM may not have it.** Check
> before assuming a screenshot loop is available:
>
> ```sh
> emulator -accel-check    # "accel: 0" good; "accel: 3" means no KVM
> ```
>
> If `/proc/cpuinfo` shows `hypervisor` but neither `vmx` nor `svm`, nested
> virtualization is off at the host and nothing inside the machine — root
> included — can enable it. **`npx sabeel-ci emulator` handles this on its
> own**: it checks per launch and adds `-accel off` only when there is no KVM,
> so an accelerated machine is untouched and runs at full speed.
>
> Start it through that command rather than by hand. `-accel auto` — the default
> — does NOT fall back for an x86_64 image: it exits at once with *"x86_64
> emulation currently requires hardware acceleration!"*, which looks like a
> broken emulator instead of a missing CPU feature. Only an explicit
> `-accel off` selects QEMU's software CPU (TCG), and `-gpu
> swiftshader_indirect` is a GPU knob that never stood in for it.
>
> Unaccelerated, expect **several minutes to boot** (805 s measured for a cold
> first boot including provisioning; ~200 s for a later one) and ~14 s per
> `screencap`, with input around 1.4 s. Input is usable; the screenshot sweeps
> this file relies on are not, so prefer the browser suites on such a host — or
> a real device over ADB TCP.
>
> Before reaching for a device, exhaust what needs none:
> `npx expo export --platform android` proves the native module graph resolves
> and the worklets compile, and transforming a file with `babel-preset-expo`
> proves a `'worklet'` directive really became a worklet factory instead of
> being dropped.
> **Builds are unaffected** — Gradle needs no KVM, so `build:aab` and the APK
> path work normally. `../agent-skills/skills/expo-firebase-stack/tools/check-host.sh`
> gives the verdict and the numbers.
>
> A freshly created AVD also comes up on `com.android.settings.FallbackHome`
> rather than the launcher, so the first `screencap` is a blank image that looks
> like a rendering bug. It is unprovisioned:
> `adb shell settings put global device_provisioned 1` and
> `adb shell settings put secure user_setup_complete 1`.

Terminal 1 is the same (`npm run emulators`). Then:

```sh
npx sabeel-ci emulator headless  # boot the tb_emu AVD (or `window` to watch it)
npm run dev:android              # build, install, launch (~2 min the first time)
```

The AVD is `tb_emu`, or the one `SABEEL_AVD` names. Every Sabeel checkout on
the machine shares it, so `headless` and `window` refuse to boot it twice and
name the process already running it, with the directory it was started from
(`npx sabeel-ci emulator list` shows the same). Headless shows nothing on your
desktop: use `npx sabeel-ci emulator window` to watch it live, or take
screenshots: `npx sabeel-ci emulator shot my-screen` → `shots/my-screen.png`.

Already built once? Just restart Metro and relaunch, which is much faster:

```sh
cd app && EXPO_PUBLIC_USE_EMULATORS=1 npx expo start
adb shell monkey -p com.sabeelinstitute.kanban.debug -c android.intent.category.LAUNCHER 1
```

Note the **`.debug` suffix**: dev builds install as a separate app
(`Sabeel Kanban (dev)`) so they can sit beside the Play build. The release
package has no suffix.

**Web and Android share the emulator data.** Sign in as `faisal` on both and it
is the same account — approve once and both are in.

The app reaches the emulators at `10.0.2.2` automatically — that's the Android
emulator's alias for your machine, handled in `app/src/env.ts`.

Screenshot what you see: `npx sabeel-ci emulator shot my-screen` → `shots/`.

> **Metro port note.** Port 8081 is shared with your other React Native projects.
> The Android emulator reaches Metro at `10.0.2.2:8081` — your machine, directly —
> so `adb reverse` cannot redirect it. If another project's Metro holds 8081, this
> app silently loads *that project's bundle* and shows a confusing red screen.
> `npm run dev:android` (and `npm run android` / `npm run start` in `app/`)
> runs `sabeel-ci preflight-metro` first, which refuses to start in that case
> and names the offending process.

## Signing in

There is no real Google sign-in yet — the OAuth clients don't exist until
`TODO.md` § D. Instead, dev builds pointed at the emulators show a **dev sign-in
row** with one-tap accounts:

| Button | What it demonstrates |
|---|---|
| `faisal`, `sara`, `omar` | Normal `@oursabeel.com` sign-ups. Each lands **pending**. |
| `intruder@gmail.com` | Outside the org domain — the server deletes it on sight. |

These go through the **real** Google provider path (the Auth emulator accepts a
fake Google token), so they exercise the same trigger, the same domain check and
the same approval flow as production will.

The dev row is gated on `__DEV__` **and** the emulator flag, so it cannot appear
in a release build — `web-e2e` loads the exported production bundle in a browser
and asserts the row does not render, on every run.

That is a check on the RENDER, not on the bytes, and the difference is worth
knowing before it alarms you: the strings and the branch are still in the
bundle, because the minifier does not drop them. What is not there is any way to
reach them — `IS_DEV` and `USE_EMULATORS` both compile to `false`, so
`devSignInAvailable` is false and `devSignIn` throws if called. Grepping the
bundle for "Dev sign-in" therefore finds it and proves nothing either way.

### Becoming an admin

Everyone starts pending, and only an admin can approve. To bootstrap yourself
the first time, with the emulators running:

```sh
npm run grant-admin -- faisal@oursabeel.com
```

Sign in as `faisal` first (so the account exists), then run that. **The app you
already have open will un-gate within a second** — no reload, no sign-out. That
live claim refresh is deliberate and worth watching.

From then on, approve everyone else in-app under **Manage people**.

> Emulator data is wiped when you stop the emulators, so you'll re-do this each
> session. That's intentional — a clean slate every time.

## Tests

```sh
npx sabeel-ci check-app   # what the shared tooling assumes of this repo
npm run lint              # ESLint, the version check, no control bytes in sources
npm run typecheck
npm run knip              # dead code: unused files, exports, dependencies
npm test                  # unit: shared, functions and the app's pure logic
npm run test:emulator     # rules + real triggers/callables against the emulators
npm run test:e2e          # full browser flow: sign-in, approval, live un-gating
```

CI runs all of them, and every browser suite (below).

`npm run test:emulator` is `sabeel-ci test-emulator`: it builds, frees this
checkout's ports, then runs the functions workspace's two passes against
different emulator sets. `test:emulator:rules` runs without the Functions
emulator, so a write fires no trigger: it first rehearses the board-ownership
migration scripts end to end (`scripts/migration-e2e.mjs`, on an empty
project), then the rules suites. `test:emulator:functions` runs the triggers
and callables. A resident Gradle daemon is reported, not stopped:
`SABEEL_STOP_GRADLE=1 npm run test:emulator` stops it, and every other
checkout's with it, since they share one registry.

The browser suites are npm scripts, each `bash scripts/e2e.sh <suite>`, which
starts the emulators and an Expo web dev server on the `web` port, runs the
suite, and stops both (the server's log is `shots/e2e-web-server.log`):

| Script | Suite |
|---|---|
| `npm run test:screens` | every screen at every width (below) |
| `npm run test:e2e` | the full flow |
| `npm run test:e2e:attachments` | attachments |
| `npm run test:e2e:stats` | Stats |
| `npm run test:e2e:richtext` | the rich-text editor |
| `npm run test:e2e:typing-perf` | typing cost on a busy screen against an empty one |

They are the list CI runs, one runner each (`ci.browserSuites` in
`ci-tools.json`); `scripts/e2e-all.sh` runs them all here, one at a time
(`scripts/e2e-all.sh richtext web` for some, by short name). They write
screenshots to `shots/`, and on failure dump what each page actually displayed —
much faster than guessing.

### Dead code: knip

`npm run knip` reports unused files, exports and dependencies, and CI runs it
(`ci.knip` in `ci-tools.json`). A clean run is **empty**. Nothing outside this
repo consumes it, so anything unused is deleted, not deprecated; a finding is
either dead code or a gap in `knip.json` to close at its cause, never a reason
to widen an ignore list. **A workspace that uses a package declares it**:
hoisting is a resolution accident, not a dependency.

`knip.json` has the same shape as the LMS's and the time tracker's:

- **Entries per workspace.** The root's are `scripts/*.mjs`; the app's are
  `App.tsx`, `metro.config.js`, `public/**/*.js` and the `.web` seams, which
  the bundler resolves and no import names; the functions' are `src/index.ts`
  (esbuild builds the bundle, so nothing maps `main` back to the source) and
  the tests.
- **`ignoreExportsUsedInFile` for types and interfaces**, so a type exported
  beside the function that takes it is not a finding.
- **The app ignores `expo-updates`, `@expo/metro-runtime` and
  `expo-system-ui`**: knip's Expo plugin infers them from Expo's defaults and
  attributes them to `app/app.json`, where none appears. Do not install them
  to quiet the report.
- **`ignoreBinaries`: `firebase` and `expo`**: the global CLI, and the app
  workspace's own, which the root's `dev:web` and `dev:android` run from
  `app/`.

Before deleting an export knip calls unused, **grep `.ts` AND `.tsx`, then
typecheck**: its only consumer may be a `.web.tsx` seam (`rerankColumnIfNeeded`
was deleted on exactly that basis). And **never list `@sabeel/shared` in
`functions/package.json`**: esbuild bundles it into `functions/lib/index.js`,
and listed there Cloud Build tries to install a private package from the
public registry and the deploy fails (`docs/INHERITED-STACK.md` lesson 3b).
The root declares it, which knip accepts for the functions too.

### Every screen, every width

One harness covers this — it seeds, signs in, walks every authenticated screen
at five widths, **asserts**, and writes a screenshot of each:

```sh
npm run test:screens                   # the CI set
SWEEP_FULL=1 npm run test:screens      # + device profiles
SWEEP_WIDTHS=320 npm run test:screens  # one width, while iterating
```

→ `shots/screens/<width>-<screen>.png`, one per screen per viewport.

**Review a sweep in its report.** The sweep also writes every check
(`results.json`) to `shots/screens/`, which is emptied at the start of each run;
`npx sabeel-ci screens-report` turns them into one page: every screen at every
width side by side, the failed checks beside the screenshot they are about,
and what changed against a baseline sweep as before / after / difference. A
filter narrows it to a screen or a width, or to what failed or changed.
`manifest.json` beside the page holds the same data for an agent.

```sh
npx sabeel-ci screens-report shots/screens --baseline-from-main   # → shots/screens-report/index.html
npx sabeel-ci screens-report shots/screens --baseline <dir of screenshots>
```

`--baseline-from-main` compares with the report of the latest successful CI
run on main (it needs `gh`). CI builds the report on every sweep, pass or
fail, and keeps it for 30 days as the run's `screens-report` artifact; the run
page's summary lists the failed checks and the changed screens and gives the
command that downloads the page: `gh run download <run id> -n screens-report`.

What it asserts, and the bug each one is there for:

| Check | Caught in the wild |
|---|---|
| the page never scrolls sideways | the classic responsive failure a top-of-page screenshot never reveals |
| no two same-layer controls overlap | search chips crowding the board dropdown — at one width and not another |
| every screen has a Back or a tab bar | Stats shipped with neither and was a **dead end on a phone browser** |
| the right board layout rendered | columns vs swipe, against the breakpoint read from `theme/layout.ts` |
| targets under 44px | reported, not failed — informational |

The widths straddle the breakpoint rather than looking thorough: one below, one
at, one above, one wide. A layout bug on one side of it is invisible from the
other, which is how `Screen`'s phone-only spacing gap survived.

Two rules this encodes, both learned expensively:

- **A tour that cannot fail is a screenshot generator.** The tour it replaced sat
  entirely inside a try/catch that logged and continued, so it reported success
  either way — and it had rotted to clicking "People" as a top-level button long
  after that moved into the More sheet.
- **An unauthenticated screenshot proves nothing about the app.** A colour change
  once shipped blind and had to be redone: content text had drifted to
  `text.muted` (~2.7:1), every token value was correct, and only the *rendered*
  authenticated screen showed it.

`app/src/ciCoverage.test.ts` fails if CI ever stops running this.

### The migration scripts

`scripts/backfill-board-owners.mjs`, its inverse, `rename-manager-role.mjs` and
`verify-board-owners.mjs` are run by hand against **production** a handful of
times each, so nothing else exercises them. This does, against seeded awkward
data, driving each as a real subprocess because three of their gates ARE exit
codes: `scripts/migration-e2e.mjs`, which `npm run test:emulator` runs first in
its rules pass, on an empty project with no Functions emulator, so no trigger
adds writes it would have to reason about. CI runs it on every push. Alone:

```sh
JAVA_HOME=$(npx sabeel-ci jdk21) firebase emulators:exec \
  --project demo-sabeel-kanban --only firestore,auth "node scripts/migration-e2e.mjs"
```
 `docs/DEPLOY.md` § Restoring across the board-ownership
migration says when to reach for the scripts themselves.

**And against the shape of the real database.** The fixtures above contain every
awkward case deliberately, which makes them the harder test and also an invented
one: production may hold a case nobody thought of, or none of them. So the same
harness can replay the structure that actually exists —

```sh
GCLOUD_PROJECT=sabeel-institute-kanban node scripts/dump-migration-shape.mjs
JAVA_HOME=$(npx sabeel-ci jdk21) firebase emulators:exec \
  --project demo-sabeel-kanban --only firestore,auth \
  "node scripts/migration-e2e.mjs --shape migration/shape-sabeel-institute-kanban.json"
```

The dump is READ-ONLY and writes two files into gitignored `migration/`: the
recovery manifest (real uids, emails and claims — step R1's safety net, since
custom claims are in no backup) and a REDACTED shape carrying only what the
migration branches on. No names, no addresses, no board titles, no cards; uids
become `u1..uN`. The replay seeds an emulator from the shape, runs the real
scripts in the real order, and asserts invariants rather than ids — every board
ends with the owners the shape predicts, the ownerless ones are exactly those
whose creator had left, nobody is handed claims they did not have, and the round
trip through both undo scripts leaves membership untouched.

Run both. Neither substitutes for the other.

### Native flows on the Android emulator

`npx sabeel-ci native-e2e` runs the Maestro flows in `maestro/` against the
debug build: it builds and installs the APK, starts the emulators (`sabeel-ci
emulators`), seeds them through the web app (`scripts/seed-emulators.mjs`,
with a web dev server on the `web` port for it, since `ci-tools.json`'s
`native.seedWeb` is set), serves the JavaScript from Metro on 8081
with `EXPO_PUBLIC_USE_EMULATORS=1`, and runs every flow, or the one you name
(`npx sabeel-ci native-e2e maestro/board.yaml`). It needs one booted emulator
(`npx sabeel-ci emulator headless`) and installs the pinned Maestro itself
(`npx sabeel-ci install-maestro`). Screenshots, Maestro's JUnit report and the
emulator, web, Metro and device logs land in `shots/native/`. It refuses a held
8081 or web port and stops only what it started.

`maestro/board.yaml` signs in, pages and swipes the columns, opens a card, types
into the native rich-text editor, bolds a word and saves, mentions Sara in a
comment through the editor's popover (the comment must read `@sara` and name
her as mentioned, the check `app/src/mentionSeam.test.ts` asks for when the
editor library moves), long-presses to select, and opens every tab, each
checked by text only that screen shows. A debug build
puts "Open debugger to view warnings" over the tab bar whenever the app logs a
warning, and the toast takes the taps meant for the tabs, so the runner starts
Metro with `EXPO_PUBLIC_E2E=1` and `app/index.ts` then tells LogBox to ignore
warnings; they still reach `logs/metro.log`.

**On the iOS simulator**: `npx sabeel-ci native-e2e --ios` (macOS) builds the
debug app for the simulator with `sabeel-ci ios-sim-build` (a prebuild scoped
to iOS, the committed `Podfile.lock`, `xcodebuild` for `iphonesimulator`),
installs it on a booted iPhone simulator, and runs the same flows. Each flow
names its app `appId: ${APP_ID}`, which `native-e2e` sets to the build it
installed, since the Android and iOS builds differ (`npx sabeel-ci check-app`
fails a flow that names its own). The flows find the dev sign-in row by its
heading, "Dev sign-in (emulator only)" (testID `dev-sign-in`), the same in every
Sabeel app. On iOS a pressable card's texts are one accessibility label and
Maestro matches a label whole, so texts inside a card or a row are matched as
part of one (`"Fundraising 2026[\s\S]*"`).

**Two narrow retries**, each logged loudly: a debug build sometimes dies in
React Native's `MountingCoordinator::pullTransaction` as it loads from Metro
(never a release build), and Maestro's iOS driver sometimes loses an element it
is snapshotting and reports the device unreachable. When the device log or the
report shows exactly that, the flows run once more and the first try's log is
kept; any other failure stands. A failed run also keeps Maestro's view of the
screen (`logs/hierarchy-at-failure.json`), the labels to match against.

The **Native** workflow runs the same command on GitHub's emulator
(`sabeel-ci ci-avd`) on every main push, every release tag, every pull
request that changes the flows, their seed, `ci-tools.json` or the
`package-lock.json` that pins ci-tools, and by hand, and keeps
`shots/native/` as the `native-<sha>` artifact. Its `ios` job runs `--ios` on a
macOS runner for release tags, by hand and for pull requests that change
the flows, and keeps the same folder as `native-ios-<sha>`.

### Screenshots for the user manual

Different job, different script. `screens-e2e.mjs` asserts; this one only
produces the images `docs/USER-MANUAL.md` embeds, at the two sizes
`npx sabeel-ci render-manual` lays out for:

```sh
scripts/dev.sh web              # emulators + web + seed, and WAIT for the seed
node scripts/manual-shots.mjs   # every image → docs/manual/img/
node scripts/manual-shots.mjs stats search   # or just the ones that changed
npx sabeel-ci render-manual     # rebuild docs/USER-MANUAL.pdf (needs uv and google-chrome)
```

It covers **every** image the manual uses except `pending.png`, which needs an
account that has signed in and not been approved — and the dev seed approves
everyone it creates. Cover new screens here when you add them: an image with no
generator is an image that quietly goes stale, which is exactly what happened to
`search-*` when only six of the twenty were covered.

**Native is a separate check** — web is not evidence about native rendering. To
look at the real Android app against seeded data:

```sh
npm run dev:android           # debug build, emulator-backed (dev sign-in row)
npx sabeel-ci emulator shot NAME
```

Two traps that cost time here: a debug build loads its JS **from Metro at
launch**, so `EXPO_PUBLIC_USE_EMULATORS` must be set when Metro starts and Metro
must be restarted with `--clear` after config changes; and `expo run:android`
printing BUILD SUCCESSFUL is **not** proof the APK installed (if the shared AVD
drops mid-run, a stale build stays on the device). Confirm with
`adb shell dumpsys package com.sabeelinstitute.kanban.debug | grep versionName` before
trusting a native screenshot.

## A five-minute tour

With the emulators running and the app open:

1. Sign in as **faisal** → you land on "Waiting for approval".
2. In a terminal: `npm run grant-admin -- faisal@oursabeel.com`. **Watch the app
   un-gate by itself** — no reload, no sign-out.
3. **New board** → it starts with To Do / In Progress / Done.
4. Add a few cards. On web, drag them between columns. On Android, long-press a
   card for the "Move to…" sheet.
5. Tap a card for the detail screen: rich-text description with a toolbar (bold,
   italic, both lists, link), assignees, due date, priority, labels.
6. **Settings** on the board → add a column, add a label, add a member. Try
   deleting a column that still has cards; it refuses and says why.
7. Sign in as **sara** in a second browser (or private window), approve her under
   **People**, add her to the board, and assign her a card. Her view updates live.
8. **My work** → everything assigned to you across every board, overdue first.
9. Confirm the brand palette renders correctly (the app is light-only).

## Where things live

- `docs/PRODUCT_BRIEF.md` — decisions and data model. Start here.
- `docs/PHASE_STATUS.md` — what's built, and the **deploy log**: what shipped,
  when, and what it broke.
- `docs/USER-MANUAL.md` — the guide the team reads; `USER-MANUAL.pdf` beside it.
- `docs/DEPLOY.md` — deploying, the release APK, Google Play, rollback.
- `docs/BRAND.md` — the colour authority. Read before any design decision.
- `docs/INHERITED-STACK.md` — what the sibling time-tracker already paid for.
- `docs/STACK-GOTCHAS.md` — a stub; the traps live in the public
  `expo-firebase-stack` skill, because they are true for anyone on this stack.
- `TODO.md` — the console work only you can do.
