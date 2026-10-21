# Running the app locally

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
    --jdk21-aliases SK --repo "$PWD"
```

`--jdk21-aliases SK` is what sets `SK_JDK21_HOME`, which `scripts/jdk21.sh`
reads to find JDK 21 without disturbing the Gradle default. The scripts here
fall back to `~/opt/jdk-21` and then to whatever `java` is on `PATH`, so a
machine set up differently still works — but the variable is the reliable route.

```sh
npm install     # once
```

## The quickest look: web

Two terminals.

**Terminal 1 — emulators** (Firestore, Auth, Functions):

```sh
npm run emulators
```

> **This checkout owns ports 61200-61207** (firestore 61200, its websocket
> 61201, auth 61202, functions 61203, ui 61204, hub 61205, logging 61206,
> storage 61207) and **61210** for the Expo web dev server. The sibling Sabeel
> repos own 61000+ and 61100+.
>
> Three of them share this machine. On the defaults 8080/9099/5001/9199,
> whichever suite started second would kill the other's Firestore — and the
> victim's symptoms would look like bugs in its own code. 61200+ because this box's
> ephemeral range is 32768-60999 and Firebase's own defaults stop at 9499, so the
> block collides with nothing chosen at random or by the CLI.
>
> `functions/test/unit/emulatorPorts.test.ts` holds firebase.json, `app/src/env.ts`,
> `scripts/lib/ports.mjs`, `dev.sh`'s PORTS and `e2e.sh`'s WEB_PORT in step, and
> refuses a sweep list containing anything this checkout does not own.
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
Emulator, port taken`, or worse, a dev server that answers on 61210 while serving
code from a different checkout. `stop` re-checks the ports afterwards rather than
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
> included — can enable it. **`scripts/emulator.sh` handles this on its own**:
> it checks per launch and adds `-accel off` only when there is no KVM, so an
> accelerated machine is untouched and runs at full speed.
>
> Start it through that script rather than by hand. `-accel auto` — the default
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
scripts/emulator.sh headless     # boot the tb_emu AVD (or `window` to watch it)
npm run dev:android              # build, install, launch (~2 min the first time)
```

The AVD runs **headless** by default, so nothing appears on your desktop. Either
use `scripts/emulator.sh window` to watch it live, or take screenshots:
`scripts/emulator.sh shot my-screen` → `shots/my-screen.png`.

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

Screenshot what you see: `scripts/emulator.sh shot my-screen` → `shots/`.

> **Metro port note.** Port 8081 is shared with your other React Native projects.
> The Android emulator reaches Metro at `10.0.2.2:8081` — your machine, directly —
> so `adb reverse` cannot redirect it. If another project's Metro holds 8081, this
> app silently loads *that project's bundle* and shows a confusing red screen.
> `npm run dev:android` refuses to start in that case and names the offending
> process.

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
npm run lint
npm run typecheck
npm test              # unit: shared + functions
npm run test:emulator # rules + real triggers/callables against the emulators
npm run e2e           # full browser flow: sign-in, approval, live un-gating
```

`npm run e2e` writes screenshots to `shots/`, and on failure dumps what each page
actually displayed — much faster than guessing.

### Every screen, every width

One harness covers this — it seeds, signs in, walks every authenticated screen
at five widths, **asserts**, and writes a screenshot of each:

```sh
bash scripts/e2e.sh scripts/screens-e2e.mjs                   # the CI set
SWEEP_FULL=1 bash scripts/e2e.sh scripts/screens-e2e.mjs      # + device profiles
SWEEP_WIDTHS=320 bash scripts/e2e.sh scripts/screens-e2e.mjs  # one width, while iterating
```

→ `shots/screens/<width>-<screen>.png`, one per screen per viewport.

**Review a sweep in its report.** The sweep also writes every check
(`results.json`) to `shots/screens/`, which is emptied at the start of each run;
`scripts/screens-report.mjs` turns them into one page: every screen at every
width side by side, the failed checks beside the screenshot they are about,
and what changed against a baseline sweep as before / after / difference. A
filter narrows it to a screen or a width, or to what failed or changed.
`manifest.json` beside the page holds the same data for an agent.

```sh
node scripts/screens-report.mjs shots/screens --baseline-from-main   # → shots/screens-report/index.html
node scripts/screens-report.mjs shots/screens --baseline <dir of screenshots>
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
codes:

```sh
. scripts/jdk21.sh
firebase emulators:exec --project demo-sabeel-kanban --only firestore,auth \
  "node scripts/migration-e2e.mjs"
```

CI runs it on every push. `docs/DEPLOY.md` § Restoring across the board-ownership
migration says when to reach for the scripts themselves.

**And against the shape of the real database.** The fixtures above contain every
awkward case deliberately, which makes them the harder test and also an invented
one: production may hold a case nobody thought of, or none of them. So the same
harness can replay the structure that actually exists —

```sh
GCLOUD_PROJECT=sabeel-institute-kanban node scripts/dump-migration-shape.mjs
firebase emulators:exec --project demo-sabeel-kanban --only firestore,auth \
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

`bash scripts/native-e2e.sh` runs the Maestro flows in `maestro/` against the
debug build: it builds and installs the APK, starts the emulators, seeds them
through the web app (`npm run seed`), serves the JavaScript from Metro on 8081
with `EXPO_PUBLIC_USE_EMULATORS=1`, and runs every flow, or the one you name
(`bash scripts/native-e2e.sh maestro/board.yaml`). It needs one booted emulator
(`scripts/emulator.sh headless`) and installs the pinned Maestro itself
(`scripts/install-maestro.sh`). Screenshots, Maestro's JUnit report and the
emulator, web, Metro and device logs land in `shots/native/`. It refuses a held
8081 or 61210 and stops only what it started.

`maestro/board.yaml` signs in, pages and swipes the columns, opens a card, types
into the native rich-text editor, bolds a word and saves, long-presses to select,
and opens every tab, each checked by text only that screen shows. A debug build
puts "Open debugger to view warnings" over the tab bar whenever the app logs a
warning, and the toast takes the taps meant for the tabs, so the runner starts
Metro with `EXPO_PUBLIC_E2E=1` and `app/index.ts` then tells LogBox to ignore
warnings; they still reach `logs/metro.log`.

The **Native** workflow runs the same command on GitHub's emulator
(`scripts/ci-avd.sh`) on every main push, every release tag, every pull request
that changes the flows or their scripts, and by hand, and keeps `shots/native/`
as the `native-<sha>` artifact.

### Screenshots for the user manual

Different job, different script. `screens-e2e.mjs` asserts; this one only
produces the images `docs/USER-MANUAL.md` embeds, at the two sizes
`render-manual.py` lays out for:

```sh
scripts/dev.sh web              # emulators + web + seed, and WAIT for the seed
node scripts/manual-shots.mjs   # every image → docs/manual/img/
node scripts/manual-shots.mjs stats search   # or just the ones that changed
python3 docs/render-manual.py   # rebuild docs/USER-MANUAL.pdf
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
scripts/emulator.sh shot NAME
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
