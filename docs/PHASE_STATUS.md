# Phase status

Live build status **and** the detailed phase plan. Phases derive from
`docs/PRODUCT_BRIEF.md`; a commit lands at each phase boundary. Claude works
autonomously *within* a phase and checks in at boundaries.

**A phase is not complete until its exit criteria are met and verified by
actually looking** — an adb screenshot for Android, a Playwright screenshot for
web. "The code looks right" is not verification.

| Phase | What | Status |
|---|---|---|
| 0 | Scaffold + CI + theming | **complete** (2026-07-19: 15 tests green; verified by screenshot on `tb_emu` and web export; esbuild inlining of `@sabeel/shared` verified). The derived dark palette this phase shipped was **removed** on 2026-07-21 — the app is a single light theme. |
| 1 | Auth + approval + roles | **complete** (2026-07-19: 83 tests + 11 e2e checks green; live un-gating verified on web AND Android by screenshot) |
| 2 | Boards + membership | **complete** (2026-07-19) |
| 3 | Columns + cards + ordering | **complete** (2026-07-19) |
| 4 | Mobile board | **complete** (2026-07-19, built alongside Phase 3 — the native board was written once, in its final swipe-paged form, rather than twice) |
| 5 | Card richness | **complete** (2026-07-19) |
| 6 | My Work | **complete** (2026-07-19) |
| 7 | Bulk actions | **complete** (2026-07-19) |
| 8 | Comments + mentions | **complete** (2026-07-19) |
| 9 | Activity history | **complete** (2026-07-19) |
| 10 | Notifications | **complete** (2026-07-20). In-app inbox, per-event prefs, mute-a-board, and push on Android, the web and iPhones; what is confirmed on a device is in `TODO.md` § I and § D2. |
| 11 | Search + archive | **complete** (2026-07-19) |
| 12 | Polish + deploy readiness | **complete** (2026-07-19) |
| 13 | Production deploy | **complete** (2026-07-20) — live at sabeel-institute-kanban.web.app; APKs published; indexes probed in production |
| 14 | ClickUp import + launch | **complete** (2026-07-26) — three boards imported from a CSV export in one pass; `scripts/import-clickup.mjs` and the `sourceId` field remain so a re-run would update, not duplicate. See `docs/MIGRATION.md`. |
| — | Since launch | The app is **in production and in daily use**. Work now ships as numbered releases rather than phases; the **deploy log** below is the running record. |

## What works today (2026-10-16)

Every phase is complete and the app is **live and in daily use** at
<https://sabeel-institute-kanban.web.app>, on Android through Play internal
testing, and on iPhones through TestFlight:

- Google sign-in restricted to `@oursabeel.com`, enforced server-side, with
  admin approval that un-gates the app live. A rejected account is told why
  rather than left spinning. One more address, the store reviewers'
  `apps-reviewer@oursabeel.com`, signs in with a password and is always a member
  (v0.12.0).
- Admin people-management: approve, reject, disable, change roles.
- **The institute's rules, accepted once** before any board, and **Report a
  problem** in More, which keeps the report and emails it to the institute's
  administrators (v0.12.0; `docs/STORE-RELEASE.md` § 4).
- **Authority is two independent things** — an org role (member / organizer /
  admin) and per-board ownership. A plain member can own a board; only an admin
  sees a board they were not added to. `docs/PERMISSIONS.md` states it fully.
- Boards with columns and membership; favourites and recents. **Labels are
  org-wide**, one set every board shares — any member creates one, admins
  rename, recolour and delete.
- Cards with **rich-text** descriptions and comments — bold, italic, bullet
  list, ordered list and link, and deliberately nothing else. Both editors are
  WYSIWYG with a toolbar; markdown is the storage format and nobody types it.
  Also assignees, all-day due dates, priority, labels, subtasks, and **file
  attachments** (10 MB each, any type, named before they upload, downloaded
  through short-lived signed URLs).
- Archive, and delete by that board's owners and admins; boards archive and
  never hard-delete.
- Web: multi-column board with real drag-and-drop. Android: swipe-paged single
  column with a "Move to…" sheet.
- Multi-select and bulk move/assign/archive/delete on both surfaces, including
  cross-board move and copy.
- Comments with @mentions — the picker opens **at the caret**, like code
  completion, rather than above the field — per-card **comment subscriptions**,
  and a tamper-proof per-card activity history.
- Notifications: in-app inbox with unread badge, per-event preferences,
  per-board mute, and a daily due-soon sweep. An alert can be put **back to
  unread** to deal with later — which notifies nobody, because push is sent when
  the entry is created and nothing watches it afterwards — and the list filters
  to unread only.
- My Work across every board, and search across the boards you belong to, with
  filters for archived, overdue, priority, label, board and assignee that
  survive navigating away, and a sort by last activity in either direction.
- **Stats** (admins): cards created and archived, comments, active
  people and file counts by day, calendar week or calendar month, server-counted
  and stored so the screen opens instantly. Selecting a bar breaks it down —
  which boards, or which people.
- Sabeel brand palette (Option 1) and logo; single light theme, no dark mode.

**Tests: 709 unit + 409 emulator integration + 736 browser e2e checks**, the last
across four suites — access and board flow (176), attachments (21), the stats
chart at nine widths (280), and every screen at five widths (259). Rich text (35)
and typing performance (3) run beside them, and the migration scripts (96) run
first in the emulator suite's rules pass. All of them run in CI on every push,
and `app/src/ciCoverage.test.ts` fails if a suite is ever left out of the
workflow.

See `docs/DEV-TOOLING.md` to run it, `docs/USER-MANUAL.md` for the user guide and
`docs/DEPLOY.md` for the production checklist.

### Known gaps, stated plainly

- **Push delivery is unverifiable locally.** FCM needs a real project, so the
  emulator suite proves the triggers fire, the preference logic, and that inbox
  entries are written — but not that a phone buzzes. Verified in production.
- **Push arriving is confirmed on Android only.** The web's VAPID key is
  deployed and an iPhone push is proven on the simulator; a browser and a
  TestFlight install still need a person to watch one arrive (`TODO.md` § I,
  § D2).
- **Board filters** (by assignee/label/priority *within* a board) exist in
  `@sabeel/shared` with tests, but are surfaced only through Search, not as a
  filter bar on the board itself. Deliberate for now — a filter bar is a row of
  board nobody can see.
- **Two accepted residuals on attachments**, both measured and neither a bug to
  re-fix: a signed URL already handed out keeps working for up to an hour after
  someone leaves a board, and there is no cap on how many files one card may
  hold. Both are fine below fifty colleagues; neither survives untrusted users.
- **A simultaneous double-create can make two labels with the same name.**
  Uniqueness is case-insensitive and checked on the client only.
- **The @mention popover works on Android, and `adb` cannot show you that.**
  Settled on a device 2026-08-29 with screen recordings: the list opens, is
  anchored at the caret, and draws over the sections below it. An earlier
  emulator session concluded the opposite — no `Mention` node in the view
  hierarchy across four input paths, including hardware key events and `@` as
  the first character of an empty composer, each with the editor demonstrably
  focused. **That conclusion was wrong**, and it is worth keeping the shape of
  the error: every one of those checks was sound, the editor really did have
  focus, the characters really did land, and the popover really did not appear —
  because `adb`-injected input does not drive this editor's mention detection.
  A negative result from a harness that cannot exercise the feature is not
  evidence about the feature. Verifying anything behind this editor's focus or
  IME needs a real keyboard: a device, or an emulator someone types into.

  The device pass then found a real bug that no browser check could see — the
  list closed itself 200ms after opening, because lifting the editor with
  `zIndex` re-parents the focused input on Android. Fixed in v0.11.1; see the
  deploy log.

Faisal's console tasks are tracked in `TODO.md`.

---

## Phase 0 — Scaffold, CI, theming

**Goal:** an empty but real app that builds, tests and renders on both surfaces.

Scope: npm-workspaces monorepo (`app`, `functions`, `packages/shared`);
`tsconfig.base.json` (strict); flat ESLint config; `firebase.json` with
firestore + hosting + emulators (**no storage**); `.firebaserc` placeholder;
Vitest wired for shared + functions; GitHub Actions CI (lint → typecheck → unit →
emulator); the AVD and emulator-suite runners (`npx sabeel-ci emulator`,
`npm run test:emulator`); Expo app with
react-native-web; **semantic theme tokens, single light theme (no dark mode)**.

**Exit criteria**
- [x] `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:emulator` all
      pass — 15 tests (7 shared, 2 functions unit, 6 rules).
- [x] CI green on a push — run 29675519239, all steps passed including the
      emulator integration tests.
- [x] Hello screen screenshotted on `tb_emu` **and** the web export, in both light
      and dark: `shots/{android,web}-{light,dark}.png`.
- [x] No color literal outside `app/src/theme` — ESLint `no-restricted-syntax`
      rule rejects hex/rgb/hsl literals everywhere else.
- [x] **Bonus, deliberately pulled forward:** verified esbuild inlines
      `@sabeel/shared` into the functions bundle with no external `require` left.
      That is `docs/INHERITED-STACK.md` lesson 1 — the sibling project's first
      deploy failed on it, and it is cheaper to prove now than at Phase 13.

**Notes**
- Metro port 8081 is contended on this machine; `sabeel-ci preflight-metro`
  guards it. See CLAUDE.md § Dev & test loops.

## Phase 1 — Auth, approval, roles

**Goal:** the right people, and only the right people, can get in.

Scope: Google sign-in on both surfaces (`hd=oursabeel.com`); auth-create Cloud
Function enforcing the verified `@oursabeel.com` domain server-side; `pending` →
admin approve/reject; `setUserAccess` callable (admin-only) setting `role` and
`status` claims + mirroring to the user doc; gate screens for pending/rejected/
disabled; admin user-management screen; `scripts/grant-admin.mjs`.

**Exit criteria**
- [x] A non-`oursabeel.com` account is rejected by the *function*, proven with the
      consent screen bypassed — integration tests create users straight through
      the Admin SDK, including look-alike domains and unverified addresses.
- [x] New user lands `pending`; admin approves; the client picks up the claim
      change live without a manual sign-out. **Verified on web (e2e assertion
      that the URL never changed) and on Android by screenshot, with no
      interaction with the device between grant and un-gate.**
- [x] Rules tests cover every role × status combination (all 12).
- [x] Only admins can promote; a member cannot escalate themselves — tested at
      three levels: pure logic, the real callable over HTTP, and rules.

**Tests:** 32 shared + 11 functions unit + 40 emulator integration = 83, plus 11
browser e2e checks (`npm run test:e2e`).

**Two traps found and documented** (`docs/INHERITED-STACK.md` lessons 8 and 10):
the emulator project-id mismatch, and React Native needing
`experimentalForceLongPolling`. Both produce "the app hangs on a spinner while
the server says everything worked".

## Phase 2 — Boards and membership

**Goal:** boards exist, with the access model fully enforced in rules.

Scope: board CRUD (create = manager/admin); board settings (name, description,
columns, labels); membership add/remove; the **remove-member callable** that also
unassigns; board list with favorites + recents; board archive.

**Exit criteria**
- [x] Rules tests: member sees only their boards; manager sees all; member cannot
      create a board, edit settings, or add anyone — including the subtle case
      that a member cannot *remove themselves* either (it would look like
      leaving but strand their card assignments).
- [x] Removing a member unassigns them from that board's cards, in one batch —
      `removeBoardMember` callable, with `countMemberAssignments` so the UI can
      warn how many cards are affected before asking.
- [x] The full rules matrix from the brief is covered by tests, including that a
      member cannot list boards by claiming to be someone else in the query.
- [x] Narrow, field-scoped preference self-writes on `users/*` (favourites,
      recents, notification prefs) — `hasOnly()` so role cannot be smuggled in
      alongside a legitimate change.

## Phase 3 — Columns, cards, ordering ⚠️ technical core

**Goal:** correct, concurrent-safe card ordering.

Scope: `rankBetween` in `@sabeel/shared` with **property-based tests**; card CRUD;
column create/rename/reorder; column delete blocked while non-empty; web
drag-and-drop; lazy column re-rank on collision.

**Exit criteria**
- [x] Property tests: `rankBetween` always returns a strictly-between value;
      1000 sequential same-position inserts never collide or degrade (they also
      stay under 30 characters); 1000 consecutive prepends and appends; and a
      500-move random shuffle that re-checks the strict ordering invariant after
      every single move.
- [x] Rules reject a card whose `columnId` is not on the board — including a
      column id borrowed from a *different* board.
- [x] Rules reject assigning someone who is not a board member, which is the
      invariant the My Work collection-group rule depends on.
- [x] **Concurrent drags under injected latency** — done. Latency is injected
      between each client's read and its write, which is the window where a lost
      update happens; without the delay the writes serialise by luck and prove
      nothing. Covers interleaved moves in one column, moves to different
      columns, ten simultaneous moves, a deliberate rank collision, and a move
      racing an edit of the same card.

## Phase 4 — Mobile board ⚠️ technical core

**Goal:** the phone experience that justifies the project.

Scope: swipe-paged single-column board with position indicator; "Move to…" sheet;
long-press drag to reorder within a column; full-screen card detail; board
switcher bottom sheet.

**Exit criteria**
- Screenshots on `tb_emu` of: board, swipe mid-transition, move sheet, card
  detail, board switcher — light **and** dark.
- Reorder-drag and page-swipe gestures never trigger each other.
- Every live query goes through `useLiveQuery`/`useLiveDoc`.

## Phase 5 — Card richness

Scope: markdown description + formatting toolbar + rendered display (sanitized,
no raw HTML); assignees (**restricted to board members**); all-day due date
picker; priority; per-board labels with legible fixed colors.

**Exit criteria**
- Rules reject assigning a non-member. Tested.
- `dueDate` round-trips as `YYYY-MM-DD` with no timezone drift, tested across at
  least three timezones.
- Markdown renders identically on web and native; injection attempt is neutralized.

## Phase 6 — My Work

Scope: the cross-board collection-group query; grouping by due state (overdue /
today / this week / later); becomes the phone's landing screen.

**Exit criteria**
- [x] Collection-group index committed to `firestore.indexes.json` (still needs
      a **production** probe at Phase 13 — the emulator does not enforce them).
- [x] Rules tests: a user reads a card they're assigned to; **cannot** read a
      card on a board they don't belong to (being assigned to one card does not
      open the rest of that board); cannot list all cards globally; cannot query
      someone else's assignments.
- [x] Board names resolve with **no** extra reads — taken from the user's own
      board list, which is sound precisely because assignment implies membership.
- [x] The collection-group rule lives at `match /{path=**}/cards/{cardId}`; a
      board-scoped rule does not apply to collection-group queries at all.

## Phase 7 — Bulk actions

Scope: multi-select (web checkbox + shift-click; phone long-press); bulk move,
archive, delete, assign; batched writes preserving selection order at the destination.

**Exit criteria**
- Bulk delete is manager/admin-only, rules-tested for the bulk path too.
- Clearing a 40-card column then deleting it is a small number of gestures.

## Phase 8 — Comments and mentions

Scope: comment thread on card detail; @mention autocomplete over board members;
edit (author) and delete (author/manager/admin); "edited" marker; `commentCount`
maintained by trigger.

**Exit criteria**
- Rules: `authorUid` must equal the caller; non-author cannot edit.
- `commentCount` stays correct across create/delete, including concurrent writes.

## Phase 9 — Activity history

Scope: trigger diffing card before/after → `activity` subcollection; timeline on
card detail; rank-only changes deliberately not logged.

**Exit criteria**
- Clients cannot write activity at all. Rules-tested.
- A reorder produces no activity entry; a column move produces exactly one.

## Phase 10 — Notifications

Scope: FCM push; `users/{uid}/notifications` inbox + unread badge; per-event
preference screen; per-board mute; due-soon scheduled function.

**Exit criteria**
- Notification event list **confirmed by Faisal** before build starts.
- `ORG_TIMEZONE` and due-soon lead time pinned.
- No self-notification; muted board produces nothing; opt-out respected.
- Client can only flip `read`. Rules-tested.

## Phase 11 — Search, filters, archive

Scope: global client-side search across member boards; board filters (assignee,
label, priority, due); archive view + restore.

**Exit criteria**
- Search finds a card on a board not currently open.
- Works offline over already-cached boards.

## Phase 12 — Polish and deploy readiness

Scope: empty states, error states, loading states; `docs/USER-MANUAL.md` with
screenshots; `docs/DEPLOY.md`; Sentry wired **and observed delivering** on all three surfaces (web, Android, functions — the last confirmed 2026-07-20); accessibility
pass; release keystore.

**Exit criteria**
- Every screen has a designed empty and error state.
- Manual covers every user-visible feature, screenshots current.

## Push notifications — wired 2026-07-20

Found broken and fixed the same day. The send path in
`functions/src/notifications.ts` had always been there, but nothing on the client
ever registered a device token: `auth.ts` initialised `pushTokens` to `[]` at
provisioning and no code touched it again, so every send saw an empty list and
returned early. The inbox, the per-event preferences and mute-a-board all worked,
which is what made it look finished from the outside.

What it took:

- `app/src/notify.ts` / `notify.web.ts` — a new platform seam. Native takes the
  FCM token from `Notifications.getDevicePushTokenAsync()` (**not** an Expo push
  token — that routes through Expo's service, which the functions do not use).
- Tokens moved from an array field to the subcollection
  `users/{uid}/pushTokens/{token}`, matching the time tracker. Two devices
  registering at once cannot race, and rules can scope write access to a
  person's own tokens without opening the rest of their user document. The
  `pushTokens` array is gone from the type, the rules allowlist and the brief.
- Registration fires once per uid on the first signed-in snapshot in
  `session.ts`, and unregisters on sign-out — a push targets the DEVICE, so
  otherwise a handed-on phone keeps receiving the previous account's
  notifications.
- The Android build had no FCM config at all: `googleServicesFile` in `app.json`,
  the `com.google.gms:google-services` plugin in both gradle files, and
  `android/app/google-services.json` committed (public client config, same class
  as the web config).
- The send path now prunes tokens FCM reports as
  `registration-token-not-registered` / `invalid-registration-token`. Nothing
  else ever would: an uninstall or a factory reset leaves a token behind forever.
- Rules tests cover the subcollection — own tokens read/write/delete, pending
  users may register (registration precedes approval), nobody may write to
  another person's collection **including an admin**, and nobody may read
  another person's devices.

Delivery is confirmed on an Android phone. The web's VAPID key is deployed, and
iPhones are sent through Apple; what is still to be watched arriving is in
`TODO.md` § I and § D2.

## Phase 13 — Production deploy

Scope: real project in `.firebaserc`; deploy rules, indexes, functions, hosting;
bootstrap first admin; **production index probe**; Android release APK via GitHub
release.

**Exit criteria**
- Every composite index verified **in production** — the emulator does not enforce
  them (lesson 6).
- Callables verified reachable (lesson 2 — the 403 trap).
- Release APK verified production-mode by screenshot before publishing.

## Phase 14 — ClickUp import and launch

Scope: `scripts/import-clickup.mjs` (extract → reconcile → apply); the
mapping conversation with Faisal; dry-run, then apply to production; then onboard
the team.

**Exit criteria**
- Dry-run output reviewed and approved by Faisal before any write.
- Re-running the import updates rather than duplicates (idempotent via `sourceId`).
- Nothing unmapped is silently dropped — unmapped entries are hard errors.
- Spot-check imported boards against ClickUp before opening access.

---

## Deploy log

### 2026-10-24 — Icons on slow connections; a smaller website — v0.13.2

- **Icons appear on a slow connection.** The website downloaded a font of
  2,234 icons to draw the few dozen it uses, and gave up after 12 seconds:
  on a slow connection every icon on screen stayed blank. The app now
  carries a 7 KB font of exactly its own icons, on the website and the
  phone apps alike.
- **The website is smaller**: about 40% less to download on a first visit
  (904 KB of code and a 156 KB font before, about 630 KB in all now). The
  build leaves out code the app never calls, including the parts of the
  error reporter it does not use.
- The browser tests now also run on the website exactly as it is built for
  release, so a part left out by mistake fails a test first.

### 2026-10-23 — v0.13.0 for iPhones and the GitHub APK — v0.13.1

- **The same app as v0.13.0, now on every channel.** v0.13.0 reached the web
  and Google Play internal testing only: Play Console's automatic protection
  was on for Kanban, so Play's APK opened only when Play had installed it, and
  the GitHub release and TestFlight waited. Protection is off, as it is for
  the LMS and the Time Tracker, and v0.13.1 goes to Play, the GitHub release
  and TestFlight.
- What v0.13.0 brought, for anyone updating from v0.12.2: phones on Android 7
  and newer can install the app; sign-in says what went wrong ("Cannot reach
  the server…") and the next tap opens the account chooser again; tapping a
  notification on the web opens its card; "Please update" when an old version
  is retired; after moving to a new phone, sign in again, since Android no
  longer backs up the app's data.
- The release APK on GitHub is the one Play signs, so it and a Play install
  update each other. A phone with v0.12.2's APK uninstalls it once.

### 2026-10-23 — Android 7 and newer; sign-in says what went wrong; web notifications open their card — v0.13.0

- **Phones on Android 7 and newer can install the app**; it was Android 13
  and newer. Attachments still need no storage permission on any version:
  "Photo library" and "Files" hand over only the item picked, and only "Take a
  photo" asks for anything, the camera, when it is tapped.
- **Sign-in says what went wrong.** A sign-in the server cannot answer reads
  "Cannot reach the server. Check your connection and try again." instead of a
  bare code, and the next tap of Sign in with Google opens the account chooser
  again, so a different account can be picked.
- **Tapping a notification on the web opens its card**, in the open tab or a
  new one.
- **"Please update"**: when an old version is retired, the app asks for the
  update rather than misbehaving.
- **After moving to a new phone, sign in again**: Android no longer copies the
  app's data, the stored sign-in included, into a backup.
- Expo 57.0.30 and React Native 0.86.3 with the month's patch updates; the
  backend on firebase-admin 14; Android crash reports read as source in Sentry.
- The release APK on GitHub is the one Play signs, so it and a Play install
  update each other. A phone with v0.12.2's APK uninstalls it once.

### 2026-10-21 — Dependency and security maintenance — v0.12.2

No feature change. The backend (functions only; rules and indexes unchanged)
and the web went out earlier the same day from `b7d03d1`; this release brings
the phones to the same dependencies.

- Routine dependency updates within the supported Expo SDK: Lexical 0.52 (the
  web editor), React Native Web 0.21.4, Vitest 4.1.11, and the grouped patch
  updates from Dependabot. Native modules are unchanged.
- CI builds every pull request for Android, iOS and the web without
  credentials, installs the backend alone from its lockfile and loads it, and
  main now takes changes only through pull requests that Faisal merges.
- Checked before release on the AVD with a debug build against the
  emulators: sign-in, board paging and swipe, opening a card, a rich-text
  description saved with bold, My Work, Search, Alerts, More, and long-press
  selection; no crash or error in logcat.

### 2026-10-17 — Android stops waiting minutes on a dead connection — v0.12.1

Clients only, no backend change. The fix is native, so Android needs this
build; web and iPhone get the two smaller changes.

**A label delete on Android sat 2.5 minutes, then reported
`deadline-exceeded`, then happened anyway.** The Cloud Run logs showed no
request from the phone for that whole window, then every tap at once, each
answered in 1 to 6 s. Firestore kept working meanwhile. React Native builds
its OkHttp client with every timeout at 0 and no HTTP/2 ping, so a connection
that dies silently holds every call to that host until Android's TCP stack
gives up; once five are stuck, OkHttp queues the rest behind them. The
Functions SDK's 70 s deadline is a `Promise.race` that cancels nothing, so the
abandoned delete still ran when the connection broke.

**Now:** `app/android/.../NetworkClient.kt` gives that client a 30 s HTTP/2
ping and a 10 s connect timeout. Reproduced with OkHttp 4.9.2 against an h2
server and a proxy that silently kills a connection: the stock client was
still hanging at 200 s; with the ping the call is retried on a fresh
connection and succeeds at 58 s, inside the deadline. On the AVD, with new
connections to the functions emulator dropped, the label count gives up at
the connect timeout instead of hanging.

**Cloud Storage is exempt from the ping**, through a sibling client with its
own pool. A ping queues behind upload bytes already sent, and Google's servers
allow 1 MiB in flight (measured: `INITIAL_WINDOW_SIZE` 1048576 on Storage,
Functions and Firestore alike). Below about 280 kbit/s a healthy upload
connection would be declared dead: a 2 MiB upload at 200 kbit/s failed at
60 s with the ping and succeeded in 85 s without, and Storage does not retry a
failed chunk. Through the exemption it succeeds in 85 s, the same as before.
React Native's cancel-by-tag still reaches the handed-off call.

**Also:**

- A label count or assignment count that FAILS says "Could not check how many
  cards…" instead of "No cards use it" or "not assigned to any cards", which
  called a delete harmless when the app did not know.
- Deleting a label that is already gone counts as done instead of an error.
  The label list trails the server, so a quick second tap names a label
  deleted a moment ago. The server still answers `not-found`.
- **Slow reads are reported**, like slow writes: a live list or document
  that takes 5 s or more to hear from the server, or is left unanswered that
  long, goes to Sentry as `Slow read: LABEL took Nms` at warning, with
  `cacheShownFirst` and `alsoWaiting` (other reads still waiting: several
  point at the connection, one alone at that query). The People list once took
  5-10 s, the admin's own row first, and reads leave no server log. On the AVD
  with the Firestore emulator blocked, People showed only the cached row and
  then reported `Slow read: users took 17773ms`, `cacheShownFirst: true`; the
  browser e2e suite raised none.

### 2026-10-16 — The institute's rules, Report a problem, and a patient first sign-in — v0.12.0

The three entries below, released together: web, the download page, Play
internal testing and TestFlight build 14. The backend went out with the rules
entry (2026-10-16); this release changes no function or rule.

- **The institute's rules, once.** The next time you open the app it shows the
  institute's rules for what is posted here; tap **I agree** to carry on. Once
  per account.
- **Report a problem**, in More: write what or who you are reporting and what
  is wrong. It goes to the institute's administrators by email.
- **A slow first sign-in is "Still setting up your account"**, with Try again,
  never "Wrong account".
- **On Android**, the card editor no longer comes up a line short.
- **On iPhone**, the box before Google sign-in names the app "Sabeel Kanban".

### 2026-10-16 — A slow first sign-in is "still setting up", never Wrong account — in v0.12.0

**Released in v0.12.0.** Clients only, no backend change.

**A genuine colleague could be told "Wrong account".** The app waited ten
seconds for the profile `onUserCreate` writes on a first sign-in and then
concluded the server had refused the account. A cold start of that trigger can
take longer in production. And on the Firestore emulator the profile can be
missed outright, which is what failed `web-e2e` in 3 of 5 runs on clean
`main`: measured with a script that starts the emulators cold for each sign-in
and logs the listen channel against the document's server-side create time,
21 of 48 first sign-ins lost the write, and every loss had the profile written
while the client's listen for it was still being registered (between the
listen request and its answer). The listener answered "does not exist" and
never heard of the write. The stale answer sticks to the listen TARGET, which
the web's persistent cache keeps with its resume token: listening again, a
direct read from the server, a token refresh and a plain page reload all kept
it (4 of 4 reloads stuck); a new target, from an emptied cache, heard the
server every time (4 of 4).

**Now:** time refuses nobody. While the profile is missing, the app asks Auth
whether the account still exists (`accounts:lookup`, at 3 s and every 5 s;
`app/src/auth/accountLookup.ts`, the same as the time tracker's), and only
Auth answering "not found", which is how `onUserCreate` refuses an outside
address, shows **Wrong account**. Past 15 s the screen says **"Still setting
up your account"** with **Try again** and Sign out. Try again is a fresh
connection (`app/src/freshConnection*.ts`): on the web the Firestore cache
emptied, once no write is waiting to be sent, and the page reloaded; on a
phone the connection closed and reopened. Every browser suite and the dev seed
settle a first sign-in through that Try again (`scripts/lib/signin.mjs`) and
print how many needed it.

**The rules' wording** (same branch, its own commit): "post only what belongs
to your work, post nothing abusive, harassing, hateful, sexual or otherwise
objectionable, and never abuse another member. The institute tolerates
neither." `RULES_VERSION` stays 1: the meaning is the same.

### 2026-10-16 — The institute's rules, and Report a problem — in v0.12.0

**Released in v0.12.0**, together with the 2026-10-13 entry below; the
backend was deployed on 2026-10-16, before the clients. **Order:** the IAM grant in `docs/DEPLOY.md` § Prerequisites, item 5;
then rules and functions (`acceptRules`, `reportProblem`); then the clients. A
client that shows the rules screen before `acceptRules` exists cannot get past
it.

Both pieces of the shared store decision 4 (decided by Faisal 2026-10-16; the
`sabeel-app-stores` skill; `docs/STORE-RELEASE.md` § 4, which has the whole of
what, where and which test):

- **The institute's rules, accepted once per account.** After approval and
  before anything else, an active account that has not accepted
  `RULES_VERSION` sees "Before you continue" with **I agree** and **Sign out**,
  and App.tsx mounts nothing behind it: no nav, no deep link, no tapped
  notification. `acceptRules` records `rulesVersion` and `rulesAcceptedAt` on
  the user document for an active caller and the version shown only;
  `firestore.rules` keeps both fields from the client. Every existing account
  sees it once, on its next sign-in or app open.
- **Report a problem**, in More: one field and Send, and a line saying
  administrators can take a post down or remove someone from the app entirely.
  `reportProblem` refuses an inactive caller, empty or overlong text and a
  sixth report in an hour, storing and sending nothing; otherwise it stores
  `reports/{id}` and emails it from `apps-noreply@oursabeel.com` to
  `apps-reports@oursabeel.com` with Reply-To the reporter, by keyless
  domain-wide delegation through `report-mailer`. The email is
  multipart/alternative: plain text with one line per paragraph, and HTML with
  the same facts, the person's words escaped. A failed send keeps the report
  (`mail.status: 'failed'`), tells the person so, and is not retried. Clients
  can neither read nor write `reports`. The privacy policy and the manual say
  what a report carries.
- **@mentions on Play: argue first** (Faisal, 2026-10-16). Blocking is all or
  nothing: a person who wants someone stopped reports them and an
  administrator removes that account from the service; mention notifications
  can be turned off altogether. `docs/STORE-RELEASE.md` § 4 and the review
  notes say so; a per-person mute is built only if Google objects.

**`e2e-all.sh` reported every failed suite as passed.** A `|| true` after the
filtered pipeline ran whenever pipefail failed it, and PIPESTATUS then held
`true`'s status. Found when this branch's first web run failed and the script
printed "all 2 e2e suites passed". Fixed: the suite's status is read straight
after the pipeline, and an "E2E aborted" line is no longer filtered away.

**Verified (2026-10-16, on this branch):** lint, typecheck, knip (nothing new);
unit 709 (shared 463, functions 121, app 125); emulator 409 (rules 249,
functions 160); browser e2e: web 176, screens 259 at five widths, attachments
21, stats 280, rich text 35, typing performance 3, migration 96. Shown red with
the code mutated: the `reports` rule opened; the acceptance fields made
self-writable; each callable's activity check; the hourly limit and its window;
the version check; keeping the first acceptance; recording a failed send;
Reply-To; header sanitising; encoded-word splitting; the delegation scope and
the token Gmail is called with; the HTML escaping of the text, the name and
the quotes; the HTML part's text; a hard-wrapped plain paragraph. **Not
verified here:** the real Gmail send from a deployed function (the grant is a
deploy step; the delegation itself was proved by hand on 2026-10-16), and the
native apps (no AVD used; the coordinator runs the device pass). The web
suite's first sign-in failed 3 times in 5 runs with the provisioned user
document never reaching the client ("Wrong account"); clean `main` failed the
same way, so it is not this branch, and the next run passed.
### 2026-10-13 — The Android editor's first height, and one build of Lexical — in v0.12.0

**Released in v0.12.0.** Functions, rules and the two blocking functions were
deployed on 2026-10-15, and iPhone builds 11–13 went to TestFlight before the
web and Play caught up.

**The Android editor could come up a line short.** `react-native-enriched-html`
parses a value with its own parser only inside `<html>…</html>`, and
`RichEditor` seeded it bare. The view still rendered it correctly, through the
library's HTML normaliser, but the first height measurement
(`MeasurementStore.getInitialText`) skips the normaliser and measures the tags
as plain text, and on first mount the later correction does not reach layout.
Measured as one run of text, a document of several paragraphs or a list comes
out shorter than it lays out. Found in the sibling LMS app, which ported this
editor: from cold starts on an AVD its box came up a line short every time,
495 px for 542 px of text, the last line hidden. The seed is now enveloped;
every tag `markdownToHtml` emits (p, br, b, i, a, ul, ol, li) is in that
parser's vocabulary.

**The web bundle carried both of Lexical's builds.** Its default entry imports
the development and the production build and picks one at run time; Metro does
not tree-shake. `app/metro.config.js` resolves the `production` export
condition for Lexical's packages and their subpaths in an export
(`development` under the dev server), and nothing else's. From the export's
source map: Lexical 988 → 445 KB minified, every Lexical file a `.prod.mjs`;
the bundle 4.18 → 3.63 MB, 1,032 → 902 KB gzipped.

**Verified:** lint, typecheck, unit; the web export measured before and after.
No build was made, at Faisal's direction, so neither fix has run on a device
here; the envelope was measured on the LMS app's AVD with the same library
version (1.1.0), and CI runs the e2e suites against the dev server's
`development` resolution. **Committed, not shipped:** it goes out with the next
release, whose version this heading takes.

**iPhone builds on GitHub (2026-10-15).** `.github/workflows/ios.yml` builds a
signed `.ipa` on GitHub's macOS runners and, as a separate opt-in job, uploads
it to TestFlight. Never on a push; started by hand only, and an upload only
with Faisal's go-ahead. A runner signs MANUALLY (`IOS_PROFILE_NAME` in
`build-ios.sh`), with the team's one Apple Distribution certificate, shared
with the LMS, and this app's App Store profile, both from secrets: automatic
signing there would mint a certificate every run until Apple's limit stopped
both apps' builds. The Mac keeps automatic signing. The job asserts the
exported `.ipa` — push entitlement `production`, no `get-task-allow`, the CI
profile, a clean stamp — and keeps a build record, the source map and the
resolved `Podfile.lock`. `build-ios.sh` also gained gates that fail in seconds
on a wrong, expired or mismatched profile, and a refusal of
`EXPO_PUBLIC_USE_EMULATORS`. Nothing in the app changed. Certificate and
profile expire 2027-10-16 (`TODO.md` D2). **Verified:** shellcheck, actionlint,
lint and unit; each new gate failing as meant against real profiles on the
Mac; the manual-signing project edit read back from a copy of the project.
The first run (38832559073, build only, from `921a5fa`) was green in 14
minutes: signed by the distribution certificate, every assertion on the `.ipa`
passed, Sentry received the source map and symbols, and no secret value
appears in its public log.

**The pods are pinned.** `app/Podfile.lock`, from that run, is copied into the
generated `app/ios/` before `pod install`, and the build stops if anything
resolves differently. Unpinned, the Mac had shipped v0.11.3 build 10 with
AppCheckCore 11.3.1 and GoogleUtilities 8.1.2 while GitHub resolved 11.3.2 and
8.1.5, with no npm change between: the Mac's local CocoaPods specs index was
stale, which also made a plain `pod install` fail against the pin. It now runs
with `--repo-update`. Proved on the Mac: PODS identical to the pin.

**On TestFlight as v0.11.5 build 11 (2026-10-15)**, the first upload from
GitHub: run 38834302593, from `f0185af`, which carries both fixes above. Web's
v0.11.5 does not, so this build's label runs ahead of what the version means
elsewhere until the next release, whose version this heading takes. Apple
validated it before the upload; App Store Connect reports it VALID and in
testing for "Sabeel Kanban Internal", with export compliance already answered;
it expires 2027-01-13.

**iPhones get notifications (2026-10-15).** They never had: the app filed
Apple's own device token as an Android one (`platform: 'android'`), the
functions sent it through FCM, and FCM refused it with `invalid-argument`,
which is deliberately not a prune code, so the dead rows were never cleaned up
either. Now an iPhone files `{ platform: 'ios', apnsEnvironment }`, the Apple
service read from its provisioning profile, and `functions/src/messaging.ts`
sends iPhones straight to Apple (`apns.ts`, HTTP/2 with the team's APNs key,
the `APNS_KEY` secret) and everything else through FCM as before. The tap data
travels in Apple's `body` dictionary, the one place expo-notifications reads it
on iOS. An old 'android' row holding a hex token is pruned unsent; the same
phone files itself correctly on its next start, overwriting the row in place
when the token is unchanged. Sending never throws: `notify` writes the inbox
first, and a retried trigger would duplicate it. The rules admit exactly the
two row shapes, both of which every older client already writes.
**Verified:** unit (632, with mutation checks on each guarantee), emulator
(rules 240, triggers 132; the shape test fails against the old open rule);
Apple accepts the key for this app on both services
(`npm run check:apple-push`); and on the simulator a debug build filed its row
through the rules, a real sandbox push from `scripts/send-test-push.mjs`
showed a banner, and tapping it opened the card. Not verifiable here: a
production delivery, and a tap with the app in the background or closed —
a TestFlight build on a phone. **Deploy order:** the `APNS_KEY` secret (set),
then functions and rules, then the iPhone build; older builds keep working
throughout, and their iPhone rows are pruned as before.

**The functions deploy needed a lockfile.** The first deploy of this batch
failed in Cloud Build for every function: with no `functions/package-lock.json`
the buildpack generates one, and its npm crashes doing so (`reading
'edgesOut'`, reproduced here with npm 10.9.2). Unchanged functions had been
restoring a cached build, which is why it had never shown. The lockfile is
committed, made from `functions/package.json` alone with the versions the
suites ran against; npm 10 installs from it, and the built bundle loads all 24
functions on that install. `docs/DEPLOY.md` has how to regenerate it.

**An email sign-in, for one address, as a member (2026-10-15).** For the store
reviewers' account, decided by Faisal in three steps that day: "sign in thru
email should never be able to be an admin or manager. Just a member."; "should
only accept that one email. The sign in page shouldn't indicate its a special
thing for a reviewer."; and an ordinary board for it, "no special code for app
reviewer". The sign-in screen gains a plain **Sign in with email** link; the
project moved to Identity Platform so two blocking functions can hold the door:
`beforeSignUp` refuses every client sign-up but a colleague's first Google
sign-in on the domain (a password sign-up always), and `beforeSignIn` refuses a
password sign-in for any address but `PASSWORD_SIGN_IN_EMAIL`. Behind them,
firestore.rules and storage.rules give a password session for any other
address nothing, the one address acts as a member whatever its claims
(`sessionAccess`, the rules' `role()`, and `actorOf`, now the only reader of the
token in any callable), and `setUserAccess` refuses another role for a
password-only account. On the web, a Google sign-up the gate refuses says "Only
@oursabeel.com accounts can use this app." instead of reporting a fault. The
account and its board are made by an admin in ordinary ways
(`docs/STORE-RELEASE.md` § 3, The review account); nothing in the code knows
about reviewers but the address. **Verified:** unit (665), emulator (rules 244, triggers 142, both
blocking functions running), each lock mutation-checked against its own test
(the rules address lock, the member lock, the storage lock, `beforeSignIn`,
`beforeSignUp`, the promotion lock, `actorOf`, the restated literal), and the
web e2e drives the door: refused for another address and a wrong password in
the same words, and for the one, signed in and a member though its claims say
organizer (red with the app's lock removed). The suite's check of an owner's
"Nobody available to add" now waits for its callable, which it raced and lost
on the build Mac. **Deploy order:** functions
with both blocking functions, registered as the project's blocking triggers;
then rules; then the Email/Password provider switched on; then the account.
**Deployed the same night**, in that order: both blocking functions registered
as the project's `beforeCreate` and `beforeSignIn`, then both rule sets, then the
provider on. A stranger's `accounts:signUp` through the public API is refused
(`SIGN_UP_REFUSED: self-signup`). The account was made through the Admin API,
provisioned pending by `onUserCreate`, approved as a member as `setUserAccess`
writes it, and is the only other member of an **App Review** board of five
sample cards; signed in through the public API it sees that board alone, and
reading another board is refused. The web sign-in screen goes live with the next
hosting deploy; iPhones get it in build 13.

**Builds 12 and 13 on TestFlight (2026-10-15/16).** v0.11.5 build 12 (run
38842511184, from `4d96791`) carries iPhone push through Apple; build 13 (run
38850556753, from `e15365d`) adds the email sign-in. Both uploaded from GitHub,
both VALID in "Sabeel Kanban Internal". `ios.buildNumber` is 14 for the next
upload, which also carries the Return keys below.

**Return keys on the email form (2026-10-16).** On a phone the keyboard covers
**Sign in** while the address field has focus, so the form is now driven by its
Return key: **next** in the address field moves to the password, **go** there
signs in. `TextField` takes `enterKeyHint`, which react-native maps on both
phones and react-native-web renders as the input's attribute. **Verified:** the
web e2e signs the one address in by keyboard alone (red before the change: no
hints, focus not moved, no sign-in); on an iOS 26.5 simulator the keyboard
showed the next key with the Passwords bar, Return moved to the password, Return
signed in as a member, and iOS offered to save the password.

**The dev scripts stop only what they started (2026-10-16).** `e2e.sh` left
its web server running after every run: its last line `exec`ed firebase, which
discarded the EXIT trap. It now records the server's pid, stops it and every
descendant on exit or on a signal, fails the run if it cannot, and refuses a
held 61210 instead of killing it. `dev.sh stop` freed Metro 8081 and idb 10882
by port and ran `pkill -9 -f idb_companion`, killing other sessions' processes
on the build Mac; it now stops only the process groups it recorded in
`.dev-pids`, reports anything else on this checkout's ports, and never touches
the shared ports. One helper file, `scripts/lib/procs.sh`, serves both.
**Verified** on the build Mac: a failing suite's exit code passes through and
nothing is left; a TERM to `e2e.sh` mid-suite exits 143 within seconds with its
whole tree gone; `dev.sh web` then `stop` ended all 19 processes (the detached
Firestore java included) while another checkout's Metro and idb kept their
pids; a foreign holder on a checkout port is reported, not killed; `android`
refuses a held 8081. `devScripts.test.ts` and the port test fail against the
old scripts.

### 2026-09-20 — A Google 503 at sign-in stops paging — v0.11.5

**Two pages, same class, no defect.** `SABEEL-KANBAN-WEB-C`: Google's Firebase
Installations service answered 503 to the auth-token request that web push
registration makes at sign-in — twice, since the SDK retries a 5xx once — and
`registerPush` caught it, reported it, and returned false. Sixteen days earlier
`SABEEL-KANBAN-WEB-B` was the same path with the browser offline. In both the
person saw nothing: the token doc that browser already holds is untouched (the
server prunes only tokens FCM rejects outright), so its pushes keep arriving,
and the next page load registers again. Environment, not code — the same
distinction the slow-write monitor got when it moved to `warning`.

**Only the report level changes, and only on the silent path.** `registerPush`
now reports `installations/app-offline`, and `installations/request-failed`
with a 5xx `serverCode`, at `warning`; a 4xx there is the project or the key
and stays an error, as does everything else. `enablePush` is untouched: a
failure behind the button is one the person just watched happen. Five tests in
`notify.web.test.ts`, mutation-checked three ways — the change reverted, the
predicate loosened to every `request-failed`, and the button demoted too — each
caught by the test that names it.

**Verified:** lint, typecheck, unit. **Shipped 2026-09-20 from `67913fa`** to
web hosting alone — the stamp read back off the live bundle and sign-in screen,
and the new branch present in it. Android and iOS carry nothing from this
change and were not rebuilt; Play and the download page stay at v0.11.4. Both
Sentry issues archived until escalating, with the reason on each. The mobile
project shows no push-registration failure of any kind in 90 days, so the native
`registerPush` keeps its default level until one appears.

iOS build 11 (2026-10-15) carries this version's label but was built from
`f0185af`, with the two fixes of the entry above.


### 2026-09-17 — One icon per push, and a banner in every state — v0.11.4

**Found on a phone, in the shade, by looking at two pushes side by side.** Two
mention pushes from this app, minutes apart, with two different small icons: the
monochrome glyph tinted raspberry on the one that arrived with the app closed,
and the full launcher icon crammed into the small-icon slot, untinted, on the one
that arrived with the app open. Same channel, same text, same app.

**Two components draw a push on Android, and each reads its own manifest keys.**
A push arriving with the app in the background or closed is drawn by the FCM SDK
from `com.google.firebase.messaging.default_notification_*`. One arriving with
the app OPEN reaches `onMessageReceived` instead and is drawn by
expo-notifications — `notify.ts` sets a handler that says to show it — from
`expo.modules.notifications.default_notification_*`, and with that pair absent
`ExpoNotificationBuilder` falls back to `applicationInfo.icon`, the launcher
mipmap, with no tint. Read in the installed library source, not inferred. The
manifest set only the FCM pair, under a comment that correctly said the config
plugin does nothing in this bare workflow and then covered one presenter of two.
The device pass that verified the icon on 2026-08-28 sent its push to a closed
app, which is the configured path, so it photographed the correct icon and never
exercised the other presenter. The fix is the second pair, pointing at the same
two resources, and `functions/test/unit/notificationIcon.test.ts` holds the pairs
together: it went red on the unfixed manifest, on either expo key deleted, and on
either icon pointed at the launcher mipmap, each with a message naming the key.

**Proven on the emulator with the presenter that was wrong, before and after.**
A local notification is drawn by the same builder as a foreground push, so one
was posted through expo-notifications' own native module in the shipped v0.11.0
debug build and again in a build of this fix, and `dumpsys notification` read
back: `icon id=0x7f0e0002` (`mipmap/ic_launcher_round`), `color=0x00000000`
before; `icon id=0x7f0700b4` (`drawable/ic_notification`), `color=0xff83114f`
after. Both shades were looked at: an empty grey ring, then the glyph in
raspberry. The APK's binary manifest carries all four keys resolving to those two
ids. What this does NOT prove is an FCM push arriving at a phone with the app
open — no emulator receives one — so the next device pass sends one push with
the app closed and one with it open and checks the two icons match; TODO.md § I
says so.

**The web half is a product decision, made the same day: a push shows whether
the app is in the foreground, the background or closed, on both surfaces.** A
push arriving at a focused browser tab drew nothing, by design — the service
worker's own comment called it deliberate, on the argument that the Alerts badge
was already moving in front of the person. Reversed. Reading the Firebase
messaging SDK's worker to implement it turned up a second defect in the path the
decision was about: with a `notification` payload present, the SDK's worker
shows the push ITSELF and then calls `onBackgroundMessage`, where ours showed it
again — two banners per background web push, the SDK's one untagged, without an
icon and a dead end on click (its handler stops propagation and, with no link
configured, does nothing). Never seen, because web arrival is the still-open
item in TODO.md § I. The worker now handles the `push` event itself, with no
Firebase SDK in it at all: one listener, one presenter, no visibility split, no
duplicate, and no second copy of the Firebase config for `check-web-template.mjs`
to hold in step — that check is gone with the config. Minting the token needs
only a registration, which is unchanged. The worker also `skipWaiting`s on
install: a new worker waits by default until every tab of the app is closed,
which would have kept anyone with a standing tab on the old one for weeks, and
this one intercepts no fetches, so there is nothing to wait for.
`app/src/firebase-messaging-sw.test.ts`
runs the worker in a fake scope: the first test holds a visible, focused window
of the app open and requires the banner anyway, and went red on a visibility
check put back, on `waitUntil` dropped, on the tag rule changed, and on the
previous worker.

**Verified:** lint, typecheck, **587 unit** (446 shared, 102 app, 39 functions),
`check-web-template`. **Not verified, and cannot be here:** arrival on either
surface — TODO.md § I has the procedure for both, now including the app-open case
on each.

**Shipped 2026-09-18 from `424a54d`:** web hosting (stamp read back off the
live bundle and the sign-in screen; the live worker byte-identical to source),
the download page and GitHub release `v0.11.4` (four ABI splits, release-signed,
source maps up), and Play internal testing (versionCode 11004). No iOS build was
cut — nothing in this release touches it; if one is, it takes `buildNumber` 11.


### 2026-08-29 — Native @mentions notified nobody — v0.11.3

**Found on the iOS build Mac while verifying build 9, and it is the worst bug
this app has shipped**, because it was silent. Picking someone from the mention
list stored their handle WITHOUT the `@`. The popover opened, the chip
rendered, the comment posted, and the person was simply never told. Every native
build since 2026-07-30 carried it. Web was never affected.

**Mechanism, reproduced from source before it was fixed.** The native editor
hands the insert to the library: `setMention('@', handle)`. The library keeps
the indicator in an ATTRIBUTE —
`<mention text="sara" indicator="@">sara</mention>` — and
`packages/shared/src/richtextHtml.ts` had no case for that node. Its documented
behaviour for an unknown tag is to unwrap it, so the tag went and `sara`
remained. `extractMentions` scans stored markdown for `/@handle/`, found
nobody, `mentionUids` came out empty, and `onCommentWritten` paged nobody.

**The fix is not the converter case; that is the symptom.** Two editors were
each deciding what inserting a mention MEANS, and had disagreed for a month.
`mentionInsertion` in `@sabeel/shared` is now the one definition, returning the
indicator, the native node's display text and the literal both surfaces must
store. Both call sites derive from it. While doing that a THIRD copy turned up —
web had `activeMentionQuery`'s regex written out inline — which now calls the
shared matcher too. The converter gained its `<mention>` case as well, so the
node round-trips whatever the call sites do.

**Three layers of test, because the obvious one would not have prevented this.**
The converter tests pin a shape WE wrote down, so they would keep passing if the
library renamed the attribute while production went quiet again. So: a
convergence test builds what each surface produces for the same roster and
asserts byte-identical markdown and the same uid — including the bug as an
assertion, that `extractMentions('hi sara there')` is `[]`; and
`app/src/mentionSeam.test.ts` couples to the LIBRARY's own source, pinning the
verified version, the `indicator`/`text` attribute names in its parser fixture,
and that `setMention` still takes the indicator separately. It reads files with
no try/catch on purpose: a missing file must fail, because "cannot check" and
"checked, fine" must never look alike.

**Already-posted comments are not repaired.** `onCommentWritten` reads
`mentionUids` rather than re-deriving, so mentions made from a phone since
2026-07-30 stay unsent. The download page says so in as many words.

**Verified:** lint, typecheck, **575 unit** (441 shared, 96 app, 38 functions),
237 rules + 132 emulator integration, rich-text 35/35, web 150/150, sweep 229.


### 2026-08-29 — A mention cannot span a line break — v0.11.2

**Reported from a device:** after typing a bare `@` and moving the caret to the
line below without picking anyone, the whole roster opened again with the caret
nowhere near the `@`. Picking from that list would have inserted the handle on
the wrong line and left the `@` orphaned above it — a wrong result, not just
noise.

**The cause is a parity bug in the editor library, and its own iOS code states
the intended rule.** On selection change it checks the word at the caret and, if
that is not a mention, the word BEFORE it. iOS refuses to make that step across a
newline and says so: *"we want to check for the previous word ONLY if the
separating character was a space newlines don't make it"*, using
`whitespaceCharacterSet`, which excludes newlines. The Android implementation
does the same walk with `Character.isWhitespace`, which includes `\n`, so it
stepped over the line break, found the bare `@`, and reported an active mention
whose query was a line break. `mentionSuggestions` trims, a trimmed line break is
empty, and empty means "show everyone".

**The fix is our own invariant, asserted at the boundary.** `isMentionQuery` is
now the single statement of what a mention query may contain — the rule that was
always implicit in `activeMentionQuery`'s character class — exported from
`@sabeel/shared` and applied where native takes the library's word for it. Web
needed no change and could not have had the bug: it derives the query from the
anchor TEXT NODE up to the caret, so a new line is a different node and matches
nothing. Two surfaces disagreeing about what a mention IS, is exactly what one
shared definition prevents. The upstream Android/iOS divergence is worth
reporting, but the guard is right regardless of which library version is
installed.

**And the second render path is gone.** The popover no longer has a "no caret
measured" branch that draws inside the editor: `anchorForField` produces a real
screen-coordinate anchor from the field's own box, so the overlay draws every
case. That deletes `styles.lifted` from both editors — the `zIndex` lift that
cost the input its focus on Android — along with `aboveField`, the inline
render, and the `onOpenChange` plumbing that existed only to drive it. The rare
path can no longer carry a hazard the common one has already solved.

**Verified:** lint, typecheck, **565 unit** (8 new: 4 pinning `isMentionQuery`
against `activeMentionQuery`, 4 on `anchorForField`), and the browser suites
including a new end-to-end check that a line break closes the list. The device
half — that the popover still opens, still sits at the caret, and no longer
reopens on the next line — needs a phone, and web cannot prove any of it.


### 2026-08-29 — The mention list stopped closing itself — v0.11.1

**On a device the popover opened, drew at the caret, and vanished again in
under a quarter of a second.** Eighteen appearances across two screen
recordings, every one of them 200-233ms long. That is `BLUR_GRACE_MS`
exactly, which named the mechanism: the editor was losing focus, the grace
timer was running, and `useMentionPolicy` was closing the list because
`open` requires `focused`.

Frame-by-frame at 60fps gave the order, and it is the opposite of the
obvious guess. The list appears with the keyboard FULLY UP; the keyboard only
starts dismissing about 80ms later. So the list's own appearance cost the
editor its focus.

**What is established, and what is not.** `styles.lifted` put `zIndex` and
`elevation` on the focused input's ANCESTOR at exactly the moment the list
opened, and removing it is the change. The precise mechanism is NOT proven.
An initial claim that RN implements `zIndex` by re-parenting was checked
against the source and is wrong for this app: `ViewGroupDrawingOrderHelper`
only computes a custom drawing order, and under Fabric — which this app runs —
`ReactViewGroup.updateDrawingOrder` is a documented no-op because "z-order is
managed at the C++ layer". A Fabric reorder applied as remove+insert would
detach and re-attach the view and would explain the focus loss, but that has
not been read or instrumented. Treat it as the leading hypothesis, not a fact.

What IS solid is the evidence: deterministic on every open, Android only,
duration pinned to `BLUR_GRACE_MS`, and the list appearing ~80ms BEFORE the
keyboard moves. Web never showed it at any width, which is what makes this a
device-only seam whatever the mechanism turns out to be.

The lift is now scoped to the inline no-caret FALLBACK, which is the only
path that still draws the list inside the editor, and it uses `elevation`
alone — which raises the draw order on Android without touching the view
tree. The anchored path needs neither, because `MentionOverlay` draws it at
the app root.

**Verified:** lint, typecheck, 33 rich-text and 229 sweep checks still green
on web, which is exactly what they were before — the bug was never visible
there, and that is the point worth remembering about this one.


### 2026-08-29 — Alerts you can re-flag, a named switch, a caret-anchored mention list — v0.11.0

**Three things the team hit in daily use, and the one real bug was found by
looking at a screenshot of a passing suite.**

**An alert could be marked read but never unread.** There was no way to say "I
saw this, deal with it later". The row now carries one envelope icon that shows
the state and flips it, beside the existing dismiss — one control, not two, the
shape the Owner switch and the People screen's access toggle already use.

This needed **no server change at all**, and the reason is worth stating because
it is a property of the trigger layout rather than of any code that could be
read for correctness: push is sent INLINE by `notify()` at the moment an inbox
entry is created, and **nothing watches `users/{uid}/notifications/**`**. So an
update to `read` reaches no server code and can page nobody. The rules already
allowed the write — `hasOnly(['read'])` is phrased on the affected KEYS, not on
the value, so it permitted both directions before anyone needed the second one.
Both facts are now pinned by tests, because the day somebody adds an
`onDocumentWritten` on that collection to recompute a badge, marking a week of
alerts unread would re-page the whole organisation and every existing test would
still pass. The integration test uses a real comment as its control, so an
unchanged count means the triggers were alive and silent rather than absent.

Beside it: an **unread-only filter** — a selected icon, not a chip, because that
bar already carries two 44pt boxes and a labelled chip does not fit 320px. It
narrows in the QUERY (`where('read','==',false)`, on the index that already
existed) rather than filtering the loaded page, or an unread entry sitting behind
fifty read ones would be hidden exactly when the filter was most wanted. Its
state lives in a view store, not `useState`: opening an alert unmounts the
screen, and a filter you cannot return to is not a filter.

**The Owner switch had no visible label.** It carried an `accessibilityLabel` and
nothing else, so a sighted owner met a bare switch beside every name — and the
manual cheerfully told them to "turn on **Owner** on their row", describing
something that was not on the screen. Columns and Labels both open with an
explanatory line; Members now does too, branched on whether you can manage the
board, and with a third case for a board that has no owners at all. Per-row
labels were never an option: 320px has no width for one, and repeating it down
every row is the thing that was asked against.

**The @mention list is now anchored to the caret.** It was
`bottom: 100%; left: 0; right: 0` — above the WHOLE field — so on a long comment
the list sat hundreds of pixels above the "@" that opened it. It now behaves like
code completion: below the caret line, flipping above when the space below cannot
show a usable list, clamped inside the field. The arithmetic is a pure module
with unit tests, because it is the only part of a two-surface,
device-dependent problem that can be pinned without a device.

Web reads a real DOM range rect. **Native has no caret API whatsoever** — the
editor library's selection event carries character offsets and its Android
emitter puts exactly two keys on the wire — so the coordinates come from
`react-native-keyboard-controller`, already a dependency for `KeyboardScroll`,
which tracks the focused input at the OS level and reports selection x/y. That is
one worklet, the first in app code, and it earns its place because nothing else
in the tree can answer the question. `react-native-reanimated` is now declared
rather than borrowed transitively, and the stale "this stack ships no reanimated"
note in `ReorderList` has been corrected instead of left to mislead.

**The bug the suite could not see.** With the popover moved below the caret, the
**Comment button drew straight across the list of names** — and every assertion
passed, at every width. react-native-web gives every `View`
`position: relative` AND **`zIndex: 0`**, so every View is a stacking context and
the popover's own `zIndex: 10` was sealed inside the editor, unable to out-paint
a later sibling at the same rank. The old upward placement had hidden it
completely by opening into the empty space above the toolbar. Found by opening
the screenshot, which is the entire argument for the rule that says to.

**And the first fix for it was half a fix.** Lifting the editor over its own
siblings cleared the Comment button and stopped there, because that was the
symptom that had been seen. The card's **Activity** section — a later sibling of
the whole comments Card, not of the editor — still drew over the THIRD name.
Measured, not guessed: `elementFromPoint` at the centre of the "Mention Sara" row
returned "Faisal created this card", and a click on that row timed out because
the row was not hittable. **A person could not pick the third person on the
list**, on web, in a release that had passed every check.

The lesson is the general one about this stack: **a stacking context cannot be
escaped from the inside.** Raising the Card too would have fixed that one case
and broken again the next time a section was added after the editor, because the
rule it depends on — "nothing is drawn after me" — is stated nowhere and checked
by nothing. So the popover is no longer rendered inside the editor at all. It is
published to `MentionOverlay`, a layer that is the **last child of the app root**,
and positioned in screen coordinates; `anchorForCaret` stays field-relative,
which is what keeps its sideways clamp meaning "inside the field", and each
editor adds its own field origin. The no-caret fallback still renders inline,
where `bottom: 100%` is the only thing that refers to anything, so the designed
Android fallback is untouched. A view store rather than a context carries it, so
opening the list re-renders that layer alone instead of the whole app on every
keystroke.

**The guard that was missing.** The position assertions all passed while the
button drew across the names, because *where is it* and *what is on top of it*
are different questions and only the first was being asked. `richtext-e2e` now
asks the second, with `elementFromPoint` — the question a click asks — on
**every row, not just the first**. Every row matters: the list is drawn downward,
so whatever follows the editor reaches the BOTTOM of it first, and a first-row
check passes cleanly against exactly this bug. It also widens the query to a bare
`@` before probing, because one candidate is never far enough down to reach
anything, and it clicks the LAST row, which is what a covered row cannot do.

**Also:** the Alerts tab announced only "Alerts" to a screen reader, whatever the
badge said; the count is now in the accessible name. That changes the accessible
NAME, and three suites matched it exactly — so every `Alerts` selector moved to a
prefix match in the same change, or this would have shipped as a green suite that
had quietly stopped finding the tab.

**Verified:** lint, typecheck, **557 unit** (432 shared + 36 functions + 89 app,
9 of them new), **132 emulator integration** (3 new), and every browser suite —
150 web (4 new), 229 across the five-width sweep (a new `card-mention` state at
each width), **33 rich-text** (2 positioning checks and 3 that ask what is on
TOP of the list), 21 attachments, 280 stats, 3 typing-perf, and 96 migration.

Moving the popover to a root layer also broke an existing assertion in a way
worth recording, because it is this stack's favourite shape: the placement check
found the popover as "the first absolutely-positioned div whose text starts with
Mention", and the overlay wrapper now matches that first. The check did not
error — it measured the whole viewport and reported the popover 423px from a
caret it was sitting beside. The selector is now a `testID`, which is exact. The mention popover, the two-icon alert row and
the Members line were each read off a rendered screenshot rather than inferred
from a green check — which is how the button-over-popover bug was found.

**The Android caret path is not yet verified on a device.** What was proven
without one, because it catches the failures that otherwise only surface there:
`expo export --platform android` bundles the whole app (7.8 MB Hermes), so every
new import resolves on the native graph; and transforming `RichEditor.tsx`
through `babel-preset-expo` shows the `'worklet'` directive became a worklet
factory with no bare directive left. That last one matters because
`babel-preset-expo` adds the worklets plugin only when the package resolves, and
an uncompiled worklet does not error — it simply never runs, which is a failure
wearing success's face.

What remains is the single question a device answers: whether
`useFocusedInputHandler` reports coordinates for `EnrichedTextInput`. **If it
does not, nothing breaks** — `caret` stays null, `nativeAnchor` returns null, and
the popover keeps the placement it has today. That is the designed fallback, not
a hope.

**A launcher bug found while trying, and worth more than the release.**
`scripts/emulator.sh` has never been able to start an AVD on a host without KVM,
on any machine, since it was written — `-accel auto` does not fall back for an
x86_64 image, it exits at once with *"x86_64 emulation currently requires
hardware acceleration!"*. Only an explicit `-accel off` selects the software CPU.
The script now detects this per launch and passes the flag only when needed, so
an **accelerated machine is completely unaffected and keeps the fast path**.
Verified in both directions before shipping, because getting it backwards would
have pushed a good machine onto the slow path.

### 2026-08-28 — The Android device pass web push never got — v0.10.2

**The seam was called total on both surfaces and had only ever been run on one.**
v0.10.1 shipped saying "Android unverified on device", and this is that pass. It
found three defects, none of which any suite could have caught: every unit test,
both e2e flows and the width sweep passed identically before and after each one.

**Signing in raised the system permission dialog on *Waiting for approval*.** The
account is not approved at that point and not one board is visible — there is
nothing yet to be notified about, and no reason given for the ask. That is the
web bug the previous release existed to fix, left in place on native on the
argument that Android permits a prompt from anywhere. It does, and that is the
trap: **Android 13 spends the prompt**, so a second refusal fixes it for good.
The worst moment to ask was also very nearly the last chance to, and someone who
declined there had one ask left — the nudge card — and then only Settings. It
also meant the card was dead weight on Android, always arriving after the OS had
already asked. `registerPush` is now silent on both surfaces, registering only a
device that is already permitted, and `enablePush` behind the button is the only
thing that may prompt. Verified on the device: sign-in leaves the permission
untouched, with no `USER_SET` flag — nothing asked, nothing spent.

**"Open settings" led to a closed loop.** A blocked device was told to open
system settings; turning notifications on there and coming back left the screen
still reading *"Notifications are blocked for this app on this device"*, beside
the same button back to the setting just fixed. `dumpsys` said `granted=true`
throughout. `App.tsx` renders one screen per route, so returning from an
external activity remounts nothing and re-runs no effect, and the only way to
make the screen honest was to navigate elsewhere and back — which it never
suggested. `useCheckOnForeground` re-reads on every return to the front. One
implementation covers both surfaces: react-native-web maps `AppState` onto
document visibility, so a browser tab returning from its site-settings panel
re-reads the same way.

**The emulator gate made the whole thing unreachable from the only build we can
put on a device.** It sat on the first line of `registerPush`, above the channel
setup and above the permission request, so a local run could never once raise
the Android dialog or create the channel. Worse, `enablePush` then answered
'denied' for a device that had merely not been asked, so the nudge card vanished
on a press that had done nothing — a failure wearing success's face, and the
exact shape the release before this one was written to eliminate. The gate now
stops at the token, where the web sibling stops, and everything above it is real
on a local build.

**A fourth defect, introduced by the second fix and caught the same way.** With
the foreground re-read in, pressing *Enable notifications* on the device made the
card VANISH rather than report the failure — the silent hide that v0.10.1 had
just removed, back again by a different route. The OS permission dialog is its
own activity, so allowing it returns the app to the front and fires the very
re-check that was added for settings changed outside the app; that re-check reads
the permission alone, cannot see whether a token was filed, found "granted" and
concluded the card was no longer needed. Two independent flags let it overwrite
what the press had just recorded, so one state owns the card now — hidden, offer
or failed — the shape `ColumnNameEditor` already uses, and an in-flight attempt
owns its own outcome. Neither browser suite could have caught it: web grants
permission without ever leaving the page, so no foreground event collides with
the attempt, and both suites were green with the bug present. The transition is
`afterRecheck` in its own dependency-free module for that reason, with tests,
because a pure function is the only part of a two-source race that can be pinned
down without a device.

That one is worth stating plainly: the fix for a silent failure reintroduced a
silent failure, every suite stayed green across both, and what caught it was
looking at the screen after the change rather than before.

**Five more, from review cycles run after the device pass** — because four
defects surviving two prior review rounds is an argument for more rounds, not
for confidence.

- `isSupported()` probes IndexedDB, and an `open()` can hang rather than fail —
  a blocked upgrade, a locked-down window. Unguarded that left `pushPromptState`
  pending for ever, so the "This device" section never rendered and the nudge
  never appeared: no throw, no log, the control silently absent. It is raced
  against a timeout now, the same shape `claimToken` already used for
  `serviceWorker.ready`, and timing out reports unsupported rather than nothing.
- The notifications screen re-claimed a token on **every** return to the front —
  which on web is every tab switch, because react-native-web maps that onto
  document visibility. A service-worker registration, an FCM round trip and a
  Firestore write, per tab switch, telling us nothing the first one had not.
  Once per account now; the token listener is what catches a rotation.
- The nudge's in-flight guard was a flag, so the first of two presses in the same
  frame cleared it while the second was still running. A count.
- "This device can't show notifications" was shown for two different situations:
  a browser that genuinely cannot, and a device that granted permission and then
  failed to register. It was wrong about the second — blaming the hardware for
  something the app failed at, to someone who has just pressed Allow.
  "Notifications can't be set up on this device" is true of both.
- "Not now" stayed clickable while an attempt ran. On web the page is still
  interactive behind the permission chip, so a dismissal could be overwritten by
  the attempt landing after it — the card returning against a stored flag saying
  it had been waved away. Disabled while busy, as `Button` already does.

Also fixed, and unrelated: `npm run dev:web` still served the abandoned port
8086 after the port move, while `dev.sh web` waited on 61210 and `seed-dev.mjs`
fetched 61210 — so the documented web dev loop could not complete at all, and
left a server on a port `dev.sh stop` does not sweep. The guard that exists for
exactly this missed it twice over: it reads only `scripts/`, and only the
`host:port` form. It reads `package.json` and `--port N` now.

**Twelve review cycles in total, run until two consecutive found nothing.**
After the five above: the sweep was made to ASSERT the nudge is in the shot
rather than merely stubbing it into one — otherwise the stub could stop working
and the card would vanish from every screenshot with every check still green;
the screen was taught to forget its filed token whenever permission stops being
granted, closing a hole the "register once" optimisation had opened two cycles
earlier; the native seam got the three totality tests the web sibling already
had, since that asymmetry is how the two halves drifted apart twice; and
DEVELOPING.md stopped claiming the e2e asserts the dev row's absence from the
exported bundle, which it cannot — the strings are in the bundle and the check is
on the render. Two of the twelve findings were regressions from fixes earlier in
the same pass, both from adding a guard or a cache without tracing its
invalidation.

**Verified on the device, which is the point of the release**: no dialog at
sign-in; the dialog raised from the button press; `dumpsys notification` showing
one channel for the package, `sabeel-alerts` at `mImportance=4`, with the stale
"Default" gone; **Open settings** landing on App info; and the panel correcting
itself on return with no navigation. Delivery itself still needs a real phone
against production — an emulator cannot receive an FCM message — and that stays
open in `TODO.md` § I.

Every new assertion was checked by mutation: the fix reverted, the suite watched
to go red, the fix restored. One of them did not go red at first — the device
mock held permission at 'default' after the grant, which no real device does —
and it was rewritten rather than kept.

### 2026-08-20 — Board owners can add members, which they never could — v0.10.1

**The promise was half-kept.** `docs/PERMISSIONS.md` and the manual both say a
board owner can "add and remove members". Removal worked — it is a callable.
Adding never did: `firestore.rules` allows `list` on `users/` to admins alone, so
a non-admin owner's directory query was refused and the picker read *"Only admins
can browse the full directory."*

**The shape is why the v0.9.0 review missed it.** That pass enumerated every
WRITE against its rule and found nothing, because the write was fine —
`membershipOnlyGrows()` explicitly let an owner extend `memberUids`, and an owner
who somehow knew a uid could have added them. What was gated more narrowly than
the control was **the read that feeds it**. Writes were checked; the reads that
make them reachable were not.

**Applying that lens everywhere found nothing else, for a structural reason.**
Assignees, mentions, Search's *Assigned to* and subtask links all offer people
who are ALREADY on the board, and `memberProfiles` is denormalised onto each
board precisely so none of them needs the directory — `SearchScreen.tsx` says so
in a comment. Adding is the only control whose subject is by definition *not* on
the board yet. The class has exactly one member.

Also swept and clean: every callable's gate against `PERMISSIONS.md`, and every
other owner capability, all of which read only the board document or
board-scoped cards.

**Both halves are callables now.** `addBoardMember` and `listAddableUsers`, gated
on `canManageBoard` exactly as removal is. The list returns **names only** — a
picker needs something to tap, not everybody's address — and refuses accounts
that are not `active`, so an owner cannot route around the approval queue by
adding somebody before an admin has decided about them.

**It closes an adjacent hole.** Board update validates `memberProfiles` only as
`is map`, and rules cannot cross-reference `users/`, so while the CLIENT supplied
the profile an owner could write any name or address against a uid. The server
reads it from `users/` now, which removes the possibility instead of trying to
validate it. A test asserts a caller-supplied `evil@example.com` is ignored.

**So `membershipOnlyGrows` became `membershipIsServerOnly`**: neither
`memberUids` nor `memberProfiles` may change on a client board update at all. The
admin exemption went with it, deliberately — both callables gate on
`canManageBoard`, which is true for an admin on any board, so the capability is
unchanged and only the direct client write is gone. Board *create* still sets
`memberUids: [creator]`.

**One transitional cost, stated plainly.** The rules deploy refuses the OLD
client's member-add write. Web updates the moment hosting deploys, but an Android
user still on v0.10.0 who tries to add somebody, or an admin tapping *Join this
board*, gets a refusal until Play updates them. Rare action, loud failure, and
self-correcting — but it is real, and it is the price of tightening the rule in
the same release rather than staging it.

**Verified:** 235 rules and 131 function tests on the emulator (+1 and +10), and
`web-e2e` **143/143** with its 141 existing checks untouched, which is what shows
the callable swap is transparent. The two new e2e checks assert *which* empty
state a non-admin owner gets — this suite seeds two people and both are members
by then, so "nobody available to add" is the truthful answer, and it is a message
only a SUCCESSFUL directory lookup can produce.

### 2026-08-18 — The app stops creating accounts — v0.10.0

**Why this exists at all.** Both stores require in-app account deletion *only if
the app supports account creation*. Apple 5.1.1(v) has no "directs elsewhere"
escape; Google's rule closes that gap only when the app itself points at the
signup. Satisfy neither trigger and the requirement never engages.

The deletion flow that would otherwise be owed is not a button. It is a decision
about what happens to organisation-owned content when a board owner removes
themselves — cards other people are working on, comments others replied to,
boards they solely own — and the honest answer is that the institute keeps them,
which is an awkward thing to build a "delete everything about me" flow around.
Not creating accounts in the first place is cheaper and truer.
`docs/STORE-RELEASE.md` is the full statement, with sources.

**The whole change is one gate.** `signInWithCredential` is the line that creates
an account. `GoogleSignin.signIn()` above it is pure Google OAuth and touches
nothing in this project, which is the window: the native path now asks a new
`accountExists` callable first and never reaches that line for an identity with
no account.

Nothing detects a platform, and nothing needed to. `app/src/auth/google.ts` is
already the native-only half of a seam whose web half is `google.web.ts` — the
file *is* the platform. Web keeps self-service sign-in exactly as it was, because
web is where accounts are created.

**The gate asks about existence, not status**, and that is what kept it small.
Pending and disabled accounts already EXIST, so signing them in creates nothing;
they sign in and `App.tsx` routes them to the waiting and disabled screens
exactly as before. Verified rather than assumed: `setUserAccess` sets a claim and
revokes refresh tokens, it does **not** set Firebase Auth's own `disabled` flag,
so a disabled user still authenticates and the claim catches them.

| State | Mobile | Creates an account? |
|---|---|---|
| No account | Refused before `signInWithCredential` | the only case that would |
| Pending | Signs in, waiting screen | no |
| Disabled | Signs in, disabled screen | no |

**Three details that are load-bearing rather than tidy.**

The refusal is a returned outcome, never a thrown error. `toUserMessage` calls
`captureError`, so throwing would report every un-provisioned colleague to Sentry
as an application fault and bury the real sign-in errors underneath them.

It signs out of Google on refusal. Google remembers the chosen account and
`signIn()` silently reuses it, so without this someone who picked the wrong
account could never switch — the refusal would be a dead end rather than a retry.

**The refusal message deliberately does not say where to get an account.** "Sign
in on the website first" is, almost verbatim, the second trigger — an app
directing users to an account creation flow outside itself. It would cost the
exemption to say the helpful thing. The instruction lives in the onboarding
email, and there is a comment at the call site so nobody adds it back.

**`accountExists` verifies GOOGLE's token, not Firebase's.** `verifyIdToken` on
the Admin SDK checks tokens Firebase issued; what arrives here is issued by
`accounts.google.com`, because the user has not signed in to Firebase yet — that
is the entire point. So it uses `google-auth-library`, now a declared dependency
rather than one inherited transitively from `firebase-admin`, and it pins the
audience to the web client id: without that, a token minted for any other OAuth
client would pass. `GOOGLE_WEB_CLIENT_ID` moved to `@sabeel/shared` for the same
reason `EMULATOR_PROJECT_ID` did — two surfaces must agree on it exactly.

The callable is unauthenticated, necessarily: there is no session yet, and
establishing one is the thing being gated. That is safe because the caller has
already proved control of the address by presenting a Google-signed token for it,
and it returns one boolean. Not role, not status, not why — a helpful extra field
would be an enumeration oracle. A test asserts the response has exactly one key.

**Public pages, served outside the app bundle.** `/privacy`, `/get-app` and
`/support` are static files in `app/public/`, which Expo copies into `dist-web`
verbatim, with hosting rewrites ahead of the SPA catch-all. This matters: the
app's routes are behind authentication, so a client-side `/privacy` would return
an empty shell to a store crawler and to a reviewer who is not signed in — the
only two readers who have to be able to fetch it. Asserted by fetching all three
anonymously against the hosting emulator and checking they are not the SPA.

The privacy policy is linked **inside the app** as well as from store metadata,
which 5.1.1(i) requires and which store metadata alone does not satisfy. It is on
the sign-in screen too, because a reviewer reaches that before anything else.

**iOS privacy manifest.** `expo.ios.privacyManifests` was absent, so Expo wrote
no `PrivacyInfo.xcprivacy` and nothing declared what the app collects. Apple has
rejected uploads for this since May 2024, by email, *after* a twenty-minute
archive has been built and signed. `check:ios` now fails without it, and fails on
a manifest that contradicts itself by marking a data type as used for tracking
while declaring `NSPrivacyTracking: false`.

**Verified in production the same day**, on Android, which is the half no test on
this machine can reach. A personal Google account got the refusal; a Workspace
account signed in straight afterwards, which also proves the sign-out-from-Google
step ran; and production Auth gained **no new account** from the refused attempt —
checked directly rather than read off the screen. That last one is the entire
compliance claim.

**Not in this release:** App Review submission, the unlisted request, and App
Store Connect metadata. iOS goes to **TestFlight** first, and owes the same
three-part check on a real iPhone.

### 2026-08-17 — Board authority becomes per-board — v0.9.0

**The largest access change since launch, and it runs against live data.** It is
NOT a normal release: rules, functions and both clients all move, and they move
in a fixed order with a data migration in the middle. **`TODO.md` § K is the
sequence and every command**; `docs/PERMISSIONS.md` is the model, and
`docs/DEPLOY.md` § Restoring across the board-ownership migration is what a
restore from before it has to re-run.

**It ran, in full, on 2026-08-17, and every step is verified.** Two things about
the execution are worth keeping, because both are reusable and neither was in the
plan.

The compat rules' propagation was proved by **reading the deployed ruleset back
off the Rules API and diffing it** against the commit that was supposed to be
live, then re-running that commit's rules suite against the fetched bytes. The
plan had called for renaming a board from a signed-in client, on the correct
grounds that a green `firebase deploy` proves nothing. Byte-identity plus a green
suite is the same proof and a stronger one: rules evaluation is deterministic
given source, token and document, so identical source cannot behave differently.

The deploy and the claims rename were **chained in one command** rather than run
one after the other. That window — where nothing recognises the old role but
accounts still hold it, so no admin can disable or restore one — is the only
genuinely dangerous gap in the sequence, and it came to two seconds against a
two-minute target. Anything with a "do this immediately after that" step should
be one command; a human watching a deploy finish is the slowest part of it.

Ownership was also assigned **before** the flip rather than after. R2's rules
exempt an admin from the ownership pin precisely so that is possible, and doing
it first meant nobody was briefly stranded on a board with no owner. One board is
deliberately left ownerless — an archived import with no members and no cards
that nobody has ever touched. `verify-board-owners.mjs` reports it every run,
which is correct: it is a state to know about, not a fault to clear.

**What changed.** `manager` meant three unrelated things at once — administer any
board, curate the org's labels, read Stats — and one consequence was that every
manager saw and could administer **every** board. Bearable while there were a
handful of boards, the opposite of least privilege as they multiply.

Board authority moved onto the board: a `boardOwnerUids` array. Its entries can
be anybody who is a member, so a plain member can own a board and an organizer
can own none. The org role kept exactly one power, creating a board, and was
renamed `organizer` to say so. Label curation and Stats both became **admin-only**.
**Only an admin now sees a board they were not added to.**

**Three decisions that are load-bearing rather than tidy.**

The creator of a board is protected — only an admin can take `createdBy` out of
`boardOwnerUids`, including on the creator's own behalf — and the rule is phrased
on the CHANGE, not the value. A value-shaped invariant ("the creator must always
be an owner") would have made every board an admin had legitimately demoted a
creator on permanently uneditable.

Ownership is always checked WITH membership, never alone. That is what lets the
rules skip a `boardOwnerUids ⊆ memberUids` subset check. The subset does hold —
`removeBoardMember` clears both lists in one batch, which also stops
`addBoardMember` silently restoring authority when somebody is re-added later —
but it holds because that code is right, and rules cannot check an Admin SDK
batch at all. A subset RULE would convert any lapse there, or any restore from a
backup predating the shape, into a board that bounces the next client write and
only an admin can repair: the labels failure mode with a routine action as its
trigger. The pairing makes the same lapse inert instead.

Board CREATE now requires `boardOwnerUids == [creator]`. Deliberate: it turns "an
app too old to know about ownership made a board only an admin can ever manage"
from a silent, permanent condition into a visible failure at creation.

**Two more the review pass found, both in the same family.** The creator clause
checked the OWNER list alone, reasoning that dropping the creator from
`memberUids` "forces" dropping them from `boardOwnerUids` — nothing forces that,
so a write carrying `memberUids: [me], boardOwnerUids: [me, creator]` unseated
the creator through the other door. And a client board write could SHORTEN
`memberUids` at all, which matters because "assignees are board members" is
enforced on card writes only: a board-side removal left the person's
`assigneeUids` behind, and the card read rule's assignee arm kept handing them
access to the very cards the removal was for. Membership may now only grow from
a client, with admins exempt as the repair path; removal is `removeBoardMember`,
which clears assignments, subscriptions, membership and ownership in one batch.

**A refused board read no longer claims the board is missing.** Being removed
from a board you have open ends its listeners with `permission-denied` — a
bug-shaped event while a manager could read every board, an ordinary one now.
Every screen answered it with "Board not found" or with advice to wait for a
connection problem to clear.

**In the app.** Every board surface computes `canManageBoard(user, board)` once;
`sessionCan.manageBoards` is gone, because a helper taking no board would be a
button that always fails. The settings entry point is now always present and its
NAME changes with what it opens — `Board settings` for an owner, `Board members`
for everyone else, which is a read-only roster with owners marked. Each member
row carries an Owner switch, confirmed in **both** directions, with the creator's
row locked for anyone but an admin. Disabling an account warns the admin when
that person solely owns a board, names it, and proceeds anyway.

**The migration.** Four scripts, both inverses written before either forward one
ran, all four rehearsed end to end against seeded awkward data by
`scripts/migration-e2e.mjs`, which CI runs on every push. The backfill refuses a
board with no `createdBy` rather than mint an owner no uid can match, writes an
honest empty list where the creator has left the board, and asserts every uid it
is about to name could already administer a board under the OLD rules — judged by
the CLAIM, because that is what the rules read, not by the user document. The
rename refuses to run at all while any active board is still missing its owner
list, so the order is enforced rather than only written down; it never mints
claims for an account that had none, because renaming a mirror is a rename and
creating claims would be a grant; and its revert restores both halves exactly as
recorded rather than deriving one from the other. That last one is the emergency
path, and deriving would have let an account in that could not sign in before.
That claim check is what makes shipping the clients before the rules flip safe.
`rename-manager-role.mjs` flushes and re-reads its manifest before the first
claim moves, because custom claims are in no backup at all.

A field addition is outside a Firestore restore's reach entirely — an import
merges by document id, so it recreates what was deleted and cannot remove what
was wrongly added. `scripts/unbackfill-board-owners.mjs` is the only undo the
backfill has.

**Also.** `scripts/restore-auth.mjs` now validates the restored role against the
current set and stamps `claimsUpdatedAt`; without both, a restore from a backup
predating this release would reinstate `manager` on accounts that then sat on a
stale token for an hour.

**iOS: build 6, and a gate that paid for itself on the run that created it.**
All three surfaces are on this release from the same commit, `26b01f1` — iOS
followed web and Android the same day and is `VALID` on TestFlight, confirmed by
asking the App Store Connect API rather than by reading `Upload succeeded` off
the build. Apple rejected the same three dSYMs as last time
(`React.framework`, `ReactNativeDependencies.framework`, `hermesvm.framework`),
which is Expo 57's precompiled binaries and costs nothing here: Sentry took the
app's own dSYM in the same build.

The first archive died after twenty minutes at the first framework it signed,
with `errSecInternalComponent` — an error that names no keychain and arrives
only once prebuild, `pod install` and sixty-odd targets have already run. The
Mac is reached over ssh; the login keychain unlocks at **GUI login** and there
is no GUI login, so codesign could read the certificate and not use its private
key. `security find-identity` reported four valid identities throughout, which
is what makes the failure read as a signing-configuration problem. `build-ios.sh`
now signs a throwaway copy of `/bin/echo` as its last gate, so `--check` catches
this in about a second; both halves of the predicate were proved — a locked
keychain made on purpose, and a bogus identity — rather than assumed from one
observation.

The `.ipa` was checked **before** the upload, not after, since a build number
cannot be reused once Apple has seen it: entitlements (`aps-environment`
`production` and `get-task-allow` `false`, against `development`/`true` in the
archive, which is the substitution the export performs), `CFBundleVersion`, a
build stamp carrying no dirty `+`, and `IS_DEV`/`USE_EMULATORS` both compiled to
`false`. That same archive was then re-exported with `destination: upload`, so
what Apple holds is the artifact that was verified rather than a rebuild of it.

**Push on iOS remains unproven.** The entitlement is right in the exported
`.ipa`, but whether the APNs key reached Firebase correctly can only be seen on
a physical device — it is the first thing to check on this build.

**And the destination is reopened.** August 12th's "internal TestFlight while
stabilising, then Unlisted App Distribution" recorded a decision that has not in
fact been made. Internal TestFlight is the standing channel until Faisal
finalises the route; unlisted remains the leading candidate and the survey
behind it still holds. Nothing on a reviewed route starts meanwhile — no review
account, no App Review submission — because both are hard to walk back and
neither is needed to get builds to a developer.

### 2026-08-15 — Naming a file, drilling into a bar, and a search that sorts — v0.8.0

Four features, independent of one another. **Server and rules changes are in
this one** — the first three releases since v0.7.5 were client-only. No new
index: the sort key is derived in memory, over cards already fetched.

**1. A file is named before it uploads.** Picking a file now opens a sheet with
its name in a field, its size and kind beside it, and an Upload button. The
timing is structural, not a preference: the attachment document IS the upload's
authorization, and clients may never update it, so the gap between the pick and
the `setDoc` is the only place a name can be chosen. Renaming afterwards would
need a new callable, an object-metadata rewrite and an activity type; declined.

The extension is shown and not editable, because it is load-bearing in four
places — the kind badge, the browser's download filename, the on-disk cache name
on Android, and what `ACTION_VIEW` and the share sheet read to pick a viewer.
`splitAttachmentName` is now the ONE definition of where a name ends and its
suffix begins, shared with the badge and with the truncation inside
`sanitizeAttachmentName`, which had its own copy of the arithmetic. The sheet
also took over the 10 MB check, which used to fire after the pick as an error
and now states a fact about the file before anything is written.

Verified end to end on the emulator: a file renamed in the sheet lands under the
new name, the original is gone from the row, the **activity log** shows the new
name (written server-side from the stored document, so this proves the rename
reached the document rather than just the screen), and the kind badge still
reads PNG. The suite's hostile-name case was moved to type THROUGH the field
rather than through the picker — the field is a new route for a bad name to
reach the document and has to be cleaned by the same code.

**2. Selecting a bar in Stats breaks it down.** Only while one is selected: with
nothing selected the panel would have to cover the whole loaded year, a
different question and a fan-out nobody asked for. Active people answers WHO
(the uids are already in hand, so it costs no read); every other metric answers
WHERE — boards ranked biggest first, each a way through to the board.

No schema change: every event already writes the board scope and `_all` in one
batch, so the rows sum to the bar by construction, and the panel shows any
shortfall as an explicit unattributed row rather than dropping it. Reads are one
document per board per month the bucket spans, cached by scope and month, and
**none at all** when the screen is scoped to a single board. The month in
progress is never cached, because the chart is live so today's bar moves and a
frozen breakdown under a moving bar is the worst kind of wrong.

Three things had to move for this. `aggregate` now derives each bucket from
`valueBetween` over that bucket's own day range, so the chart and the breakdown
run the same function over the same days rather than agreeing by coincidence.
Scope, period, metric and the selected bar moved into a view store, because
tapping a board unmounts the screen. And the bucket range is clamped to the
loaded window — a week bucket at the left edge starts on its Sunday, up to six
days before anything loaded, so an unclamped query would count days the bar did
not.

**A bug this exposed, fixed here.** The period figure was
`points.reduce((s, p) => s + p.value, 0)` — right for every counter, and for
`activePeople` the exact distinct-count error `aggregate`'s own docblock warns
about. It summed sixty daily distinct counts, so the period could report more
people active than the organisation has. It now unions.

**3. Search sorts by last activity.** Best match (the default, and exactly the
old behaviour) / Newest first / Oldest first. With an empty box the first two
agree — correct, not a duplicate; they diverge only when there is a query.

"Last activity" needed a new field. `updatedAt` is client-written on a card EDIT
and never moved for a comment or a file, so a card with ten new comments sat
where it was. **`lastActivityAt` is trigger-owned**, bumped by the comment
trigger and by `bumpAttachmentCount` — both already wrote to the card document,
so it is one more field in a write that was happening anyway, and it inherits
their best-effort posture. Rules pin it across a client update exactly as
`attachmentCount` is pinned, with `.get(…, 0)` on both sides so cards predating
it stay editable. **No backfill and no index**: the sort key is
`max(lastActivityAt, updatedAt, createdAt)`, so an old card falls back, and
`createdAt` is the floor — without it a card missing both would read as epoch
zero and pin to the TOP of "Oldest", looking like an answer. Editing a comment
is the one thing that does not move it; that path returns before the trigger's
write.

**4. Search's filters were reorganised.** `Filters` absorbed priority and gained
Assigned to. Priority is now **multi-select across all five values including
None** — it shipped as two chips, Urgent and High, that turned each other off,
so "the things that matter" could not be asked for. Assigned to needed no shared
work at all: `CardFilters.assigneeUid` has been implemented and tested since
Phase 11 and had simply never been wired to a control. Its candidates come from
the boards' `memberProfiles`, since only admins may list `users/*`.

The sections are an **accordion, closed on open, one open at a time**, and the
geometry decides that rather than taste: the sheet is bounded to 80% of the
viewport, which at 320x568 leaves a body of ~334pt against ~290 for one open
section. Exactly one fits, and two would put a capped scroller inside a capped
scroller — on iOS the inner one takes the gesture and does not chain. Each
header carries its own state (`Board: Fundraising 2026`, `Labels (2)`), the
shape the boards screen's archived section already uses; four headers reading
just `Board`, `Labels`, `Priority` would show nothing about what is filtering.
No new `Collapsible` primitive: a secondary `Button` plus a conditional render.

Picks apply immediately and the sheet stays open, which cost two things that had
to be handled rather than discovered — the footer now says `Done` (a `Sheet`
prop defaulting to `Cancel`, because ten e2e steps across four scripts click a
button named exactly `Cancel`), and the sheet carries its own clear-all, since
the row's is behind the modal.

**Found while reviewing, fixed here.** Signing out cleared the live-query cache
but not the view stores, so search filters survived a user switch on a shared
device. Stores now register themselves, so the next one added is covered without
anyone remembering.

**A review pass over the four features, and what it found.** The fifteen that
changed what a screen says, in descending order of how wrong it was, and a tail
of smaller ones after them:

- **The Stats breakdown reported a shortfall that did not exist.** `unattributed`
  subtracted a one-shot `getDocs` figure from the LIVE subscribed one driving the
  chart, so on the default view any colleague creating a card anywhere printed
  `Boards not listed 1` — which the panel's own docblock says means a board this
  reader cannot see. `_all` now rides in the same fan-out, so both sides of the
  subtraction come from the same moment.
- **An ordinary dot in a filename became an un-editable extension.** `Notes on
  v1.2 planning` split into `Notes on v1` + `.2 planning`, and the sheet renders
  the suffix as fixed text — so the name could not be repaired by the person
  renaming it. An extension is now ASCII-alphanumeric with at least one letter,
  which keeps `.7z` and `.tar.gz` and rejects prose and dates.
- **The naming sheet could show one name and store another.** `maxLength` bounds
  typing, not a pre-filled value: on web a 300-character picked name rendered in
  full and was truncated server-side, and Android truncated the display while the
  draft kept all 300. The field is seeded from `sanitizeAttachmentName` and
  confirms through `joinAttachmentName` — which had zero production callers, so
  the one join with a round-trip property was not the shipped path.
- **Only the FIRST bar selection scrolled its breakdown into view.** `onLayout`
  fires on mount and on layout CHANGE, so a second bar whose panel came out the
  same shape never moved the page — the exact "tapping a bar looks like it did
  nothing" the mechanism exists for. An effect on the selection spends a
  remembered y; the layout records it.
- **`commentCount` was pinned nowhere.** In the card's key list from the
  beginning and constrained by no rule, so any active member could set it to
  anything, and `onCommentWritten` only ever increments — a forged value never
  self-corrects, and there is no backfill for it. All three trigger-owned fields
  now go through one `triggerOwnedUnchanged()`.
- **Pinning `lastActivityAt` secured nothing on its own**, because Search orders
  by `max(lastActivityAt, updatedAt, createdAt)` and `updatedAt` is
  client-written with its value constrained nowhere: `updatedAt: 9e15` pinned a
  card to the top of "Newest first" for everyone, permanently. Both client stamps
  are now bounded to "not in the future", with an hour of clock slack.
- **Clear-all silently reset the sort.** `clearSearchFilters` was `store.reset`,
  which restores `sort: 'best'` — contradicting the note added beside it that a
  clear-all must not reorder a list it was not asked to reorder.
- **`aggregate` was quadratic**, re-scanning the whole series once per bucket:
  349 x 349 entry visits for the default daily view, re-run on every stats write
  org-wide. Measured against this repo's own `lib/`: 0.99 → 0.06 ms/call for
  `cardsCreated` and 1.11 → 0.07 for `activePeople` on V8, with byte-identical
  output. Each bucket still comes from `valueBetween` over its own range — it is
  just handed its own days, and the test that pins the two together now runs
  over all three bucketings.
- **The month cache could be evicted mid-flight.** `fetchOneScope` decided what
  was cached BEFORE its `await` and read it back after, while every other scope
  was concurrently evicting; the loser silently contributed zero and inflated the
  residual. It also threw away months the range query had already paid for.
- **Two controls answered to "Clear all filters"** — the screen's icon and the
  sheet's button, both in the tree while the sheet is open. The sheet's says
  `Clear all`. The same collision was one org-wide label away in the chip row
  itself: labels are created by any member, so one called `Urgent` announced
  identically to the priority chip beside it. The active-filter chips now say
  what tapping them does and name their facet — `Remove the Urgent priority
  filter` — which is both unique and more useful, since those chips are not
  toggles. `Archived` and `Overdue` are, and keep their state suffix.
- **A capped scroller inside a capped scroller.** The Filters sheet's rows
  scrolled inside 220pt within the sheet's own bounded scroller; on iOS the inner
  one takes the pan and does not chain, and a web sweep cannot see it. The sheet
  is the one scroller now, and the docblock's arithmetic — which omitted the four
  44pt section headers — says what it actually costs.
- **Search collapsed three states into two**: a failed board read rendered as
  `Nothing to show`, and a live filter as `Unavailable board` or `Someone no
  longer on a board`. Definite claims made from an absence of information.
- **A fan-out per bar tap under `Active people`**, one read per board, rendered
  nowhere.
- **`oldest` was not the reverse of `newest`** for cards sharing a timestamp —
  common after an import or a bulk copy, since `bulkCopyToBoard` stamps one
  `Date.now()` across a batch. The title tie-break turns with the direction, so
  the browser suite's assertion is now a property rather than a coincidence.
- **A staff headcount was written into a code comment and the deploy log.** This
  repo is public; a bound (`more people than the organisation has`) carries the
  identical point. A second instance from an earlier release went with it.

Also: `joinAttachmentName`'s documented round trip was false for any stem ending
in a space (`Q3 report .pdf` renamed itself on attach) and is now held by seeded
fuzz rather than a hand-written list; `sanitizeAttachmentName` is idempotent, so
running it twice on the way to storage cannot shorten a name by one character;
the importer MERGES, so a re-run no longer wipes assignees, labels and the
trigger-owned counters, and it no longer writes `commentCount` the trigger is
already incrementing; a long board name in the breakdown ellipsises instead of
pushing its figure off a 320px screen; and `getStatsView`/`clearStatsView` had no
callers.

**Verification.** 467 unit tests, 207 rules + 99 function tests on the emulator
(nine new rules tests: the `commentCount` pin, the future-stamp bound in both
directions, and the card whose stored stamp is ALREADY in the future — which is
why the update test is on the change rather than on the value, or
`subscribeToCard` would stop working on a card nobody could fix).
`scripts/attachments-e2e.mjs` 21/21.
Every e2e helper that the reorganisation broke was fixed in the same batch —
notably `pickInFilters`, which needed to expand a section AND close the sheet:
without the close, three later assertions would have matched the sheet's own row
and **passed while proving nothing**. `stats-e2e.mjs` seeded only the `_all`
scope, so its new drill-down assertions would have been vacuous; it now seeds
three board scopes with an exact split, and asserts the rows add up to the bar.
The screen sweep gained a Filters-sheet capture and a stats-with-a-bar-selected
capture, since a structural check cannot see a panel that is never opened.

Three checks were added for the review fixes above, each aimed at a failure a
green suite had been reporting as a pass: `stats-e2e.mjs` taps TWO bars of equal
value from a reset scroll position, because equal bars give equal-length lists
and that is precisely the case a layout-driven scroll cannot see; `web-e2e.mjs`
counts the controls answering to `Clear all filters` with the sheet open, and
asserts that clearing the filters leaves the chosen sort alone. Browser totals:
web 116, stats 280, screens 202, attachments 21.

**iOS: build 4, and a dry run that had never been dry.** The iOS surface ships
from the cloud Mac on its own runbook, after the other three. Cutting this one
cost two bugs in `scripts/build-ios.sh`, both on the `--no-upload` path, which
meant **the only way to build this app for iOS was to publish it**:

- The App Store Connect key was resolved inside the `if [ "$UPLOAD" = true ]`
  branch, as its name suggests it should be. But `-allowProvisioningUpdates`
  *mints the distribution signing assets through that key*, so the archive needs
  it as much as the upload does. Resolved for every build now; only the
  issuer-id and key-file checks stay behind the upload flag.
- `"${AUTH[@]}"` on an empty array dies under `set -u` — macOS ships **bash
  3.2**, where expanding an empty array counts as unbound. The script exits
  quoting `AUTH[@]: unbound variable`, naming a variable declared four lines up,
  and the bug is unreproducible in any newer shell. Now `${AUTH[@]+"${AUTH[@]}"}`,
  proven by running both forms rather than by reading them.

This is the `publish-apk.sh --check` lesson again, from the other end: a gate
worth writing has to be free to exercise, and a route nobody takes is a route
that can be broken from the day it was written.

**What the `.ipa` proved, which nothing had checked before.** `aps-environment`
is `development` in the entitlements file and in the archive, and
**`production`** in the exported `.ipa` — the export re-signs against the App
Store profile and substitutes it, with `get-task-allow` going `true` → `false`
in the same step. So the long-open question of whether a prebuild preserves the
Push Notifications capability was the wrong question: `expo-notifications`
applies its own config plugin automatically and writes the entitlement on every
prebuild, and `ios.entitlements` in `app.json` neither is nor should be
involved. `docs/IOS-BUILD.md` records both halves.

The dev sign-in row was confirmed absent the only way that actually works. The
JS bundle is Hermes bytecode and `strings` finds `Dev sign-in (emulator only)`
in a perfectly good release build — Metro does not fold constants across module
boundaries, so the JSX compiles in and is never reached. A `--no-bytecode`
export of the same release bundle shows `IS_DEV = false` and
`USE_EMULATORS = false`, independently, which is what the two-condition gate in
`devSignIn.ts` was written for.

**Build 4 is on TestFlight**, from commit `644173d`, confirmed `VALID` by asking
the App Store Connect API rather than by reading `Upload succeeded` off the
build. Apple's own symbol upload rejected three dSYMs — `React.framework`,
`ReactNativeDependencies.framework`, `hermesvm.framework` — which is expected and
not worth chasing: those are Expo 57's **precompiled** React Native binaries and
ship without DWARF. It costs nothing here, because crash reporting goes to
Sentry, and Sentry's upload of the app's own dSYM succeeded in the same build.

**A TODO item deleted rather than done.** "Export the iOS distribution
certificate as a `.p12`" assumed the Android keystore rule — a private key on
one machine and nowhere else. `security find-identity` on the Mac that has
shipped every iOS build finds four *development* certificates and **no
distribution certificate at all**: signing is cloud-managed, minted at export
and discarded. There was never anything to back up. The credential that cannot
be recreated is the Admin `.p8`, already in Drive.

### 2026-08-13 — The slow writes that were really a file picker — v0.7.8

**Client only.** No `functions/src`, `packages/shared/src`, `firestore.rules`,
`storage.rules` or index changes, and **nothing a user can see** — this is
telemetry accuracy. It also carries v0.7.7 (symbolication + the iOS route) to
web and Android, which had no reason of their own to ship it.

**Sentry was filing `Slow write: uploadAttachment took 9278ms` repeatedly, and
none of them were slow writes.** `useAction.run` wraps a whole user action in
`timed`, and the upload action *starts* by opening the system file picker. The
stopwatch was running while a person browsed their files, framed a photo, or
answered the camera prompt. Backing out of the picker was reported too — a slow
write for a write that never happened.

The same defect one function over: `openAttachment` ends at
`IntentLauncher.startActivityAsync`, which uses `startActivityForResult` and
resolves from `onActivityResult` — so the promise is held until the reader
closes the document. The share fallback (`expo-sharing`) has the same shape, and
that is also the iOS path.

Measured on the emulator against the shipped build, then against the fix:

| Interaction | Before | After |
|---|---|---|
| Attach a file, ~33s in the picker | `uploadAttachment took 37992ms` | silent |
| Open a file, ~21s in the viewer | `openAttachment took 20935ms` | silent |
| Take a photo (permission + framing), 104s total | would have been ~104000ms | silent |

The `openAttachment` report landed **100ms after Back was pressed**, which is the
whole mechanism in one number.

**`timed` now charges only what this app is answerable for.** Its callback gets
an `untimed` helper and wraps the regions whose duration is not ours: the picker,
the viewer/share hand-off, and the byte transfer — that last one because it is
proportional to file size and uplink (the cap is 10 MB), so a large attachment on
a poor connection clears a threshold written for a metadata write. What stays
measured is `setDoc` and the callables, which should be quick whatever the file
weighs. The excluded total rides along as `waitedMs`, so a report still shows the
whole picture.

`busy` deliberately still spans the picker — it is what stops the attach control
taking a second tap. The two spans were the same region and should not have been.

**Round two on this monitor, and the threshold did NOT move again.** 2026-07-24
answered the same class — a cold-started callable inside the timed region — by
turning the volume down (error → warning, 3s → 5s). Tuning a measurement you know
to be wrong only hides it; this fixes what the region measures. A cold
`finalizeAttachment` can still trip 5s and should, because that is real latency
someone waits for.

Guarded by `app/src/slowWrites.test.ts` (8 cases, fake timers), which was
falsified against the old behaviour first: reinstating the un-subtracted clock
fails exactly the four exclusion cases and no others.

Also: `app/src/sentry.ts` still claimed source-map upload was "deliberately not
wired", untrue since v0.7.7.

Verified: lint, typecheck, 44 unit tests, `attachments-e2e` on web, and the three
interactions above on the AVD — each run against the shipped build first, so the
silence afterwards means the code changed rather than the test being weak.

### 2026-08-12 — Crash reports you can read, and the iOS route — v0.7.7

**No user-visible change on any surface.** This version exists so the first iOS
build carries an honest number: v0.7.6 shipped from `493816a`, and the tree has
moved since, so an iOS build stamped 0.7.6 would have contained code that never
shipped as 0.7.6 on web or Android. The rule is one version across three
surfaces, and it only means anything if the version identifies the code.

**iOS goes out first at this version.** Web and Android are unaffected by
anything here — the Android change is inert without a token in the environment —
so they can pick 0.7.7 up on the next release that has a reason of its own.
Nothing is required of them to unblock the iOS build.

**Symbolication, at parity.** Both native platforms now upload source maps and
debug symbols, on one set of names: `SENTRY_ORG`, `SENTRY_PROJECT`,
`SENTRY_AUTH_TOKEN`, read from the build shell. iOS through
`@sentry/react-native/expo` registered **bare** in `app.json` — options are
written verbatim into `ios/sentry.properties` and this repo is public. Android
through `sentry.gradle`, applied from `app/android/app/build.gradle` and **gated
on the token**, because a config plugin runs at prebuild and that folder is
committed and never prebuilt.

The gate is the safety property, and it was verified rather than assumed: with no
token the release build registers **zero** Sentry tasks — diffed off the Gradle
task graph — so CI, a fresh clone and any machine without the token build exactly
what they built before, and the release path never depends on reaching sentry.io.

The token itself needed no work: the organization token already used by the
sibling time-tracker (`org:ci`) reaches every project in the org. Confirmed by
probe against the kanban project — releases and `files/dsyms/` answer 200, while
org-level endpoints answer 403, which is the right shape for a build secret. The
native Sentry project was renamed from `…-android` to `…-mobile`, since iOS now
reports into it; renaming a slug does not touch the DSN, which carries the
numeric project id.

**Distribution route settled: internal TestFlight while stabilising, then
Unlisted App Distribution permanently.** Unlisted is a normal App Store app that
is not searchable and appears in no chart — link-only, no user cap, no expiry, no
App Store Connect accounts for colleagues and no MDM. It suits the sibling
recordings app equally. Apple Business Manager custom apps were rejected: they
need a D-U-N-S number, reach unmanaged personal devices only through
country-locked redemption codes, still require App Review, and are a one-way door
— an app distributed privately through ABM needs a brand-new App Store Connect
record before it can be made unlisted. The Enterprise Program needs 100+
employees.

**What the first real `pod install` cost.** Every gate passed, and had always
passed — but no iOS pod integration had ever COMPLETED, so two failures sat past
the gates where nothing could see them. Neither announces itself:

- **`AppCheckCore` cannot be integrated as a static library.** Expo's autolinker
  already enables modular headers for the dependencies of Swift packages, but
  only ONE level deep: `ExpoAdapterGoogleSignIn` → `GoogleSignIn` is covered,
  `GoogleSignIn` → `AppCheckCore` → `GoogleUtilities`/`RecaptchaInterop` is not.
  Fixed with `expo-build-properties`, `ios.extraPods` naming those two pods with
  `modular_headers: true` — the remedy CocoaPods itself prints, scoped to the
  two pods that actually lack module maps. Deliberately **not**
  `useFrameworks: 'static'`: that changes linkage for all 112 pods, and the
  precompiled React Native xcframeworks this build uses are documented to fail
  under it — which is why `forceStaticLinking` exists to mop up after it.
- **The build archived a pod instead of the app.** The scheme was read as
  `schemes[0]` of the WORKSPACE, which carries a scheme for every pod once they
  integrate — 131 of them, `AppAuth` sorting first. Archiving a pod **succeeds**:
  the archive simply holds no app, and the only symptom is
  `exportArchive … expected one {}` a step later — an empty set of valid export
  methods, because a static library has none. Discovery now asks the app
  `.xcodeproj`, which knows exactly one scheme, and the archive is asserted to
  contain an app while the scheme that built it is still in hand.

### 2026-08-12 — The taps a scroller was eating — v0.7.6

**Client only.** No `functions/src`, `packages/shared/src`, `firestore.rules`,
`firestore.indexes.json` or `storage.rules`, so functions do not redeploy.

Reported from a phone as slowness in the link dialog: "no immediate response…
sometimes several seconds" between pressing **Add link** and anything happening.
It was not slow. **The taps were being discarded.**

**The evidence, from the screen recording rather than from a theory.** Stepping
the frames: the touch indicator lands inside the button on all three taps, so
delivery was never the problem. The button's measured fill is `#83114F` at full
strength through taps one and two — a `Pressable` that never entered its pressed
state, so no handler ran — and 0.8 opacity on the third, which is the one that
worked. 3.5 seconds and three taps for one press. Throughout, the caret is still
blinking in the URL field.

**Cause.** `Sheet` puts its content in a `ScrollView`, whose default is
`keyboardShouldPersistTaps="never"`. React Native then takes the responder in
the CAPTURE phase whenever any `TextInput` is focused, so the control under the
finger never becomes responder — RN's own source says the first tap is meant to
go to the scroll view and the second to the interior view. Under edge-to-edge it
does not stop at one: the guard is "an input is focused AND a keyboard may be
open", and the second half is cleared by `keyboardDidHide`, which this app does
not reliably get. The keyboard goes away, the field keeps focus, and the sheet
goes on eating taps.

Web was ruled out first, by measurement rather than by elimination: a standalone
bench mounting the real `RichEditor.web` outside Firebase put the click at
16–105 ms across a short and a 40-paragraph description, with and without 25
comments and a second editor on the page. There was never a slow path to find.

**Fixed everywhere the shape occurs, not just in the dialog.** `Sheet`, the
board pager and its card list, the wide board's two scrollers, and the three
pickers — assignees, subtask links, board members — which were three copies of
the same capped list under a filter field. Those three are now one `PickerList`
in `ui.tsx`, because a fourth picker written by copying a third would have
copied the bug.

**The guard is lint, and it is lint on purpose.** Every e2e suite here is
Playwright on web; this is native responder behaviour with no DOM equivalent, so
no test can see it. `no-restricted-syntax` now requires every scroller in
`app/src` to state a `keyboardShouldPersistTaps` — "say something" rather than
"say handled", since `always` is right for a scroller with nothing tappable in
it. Writing it exposed a second trap worth recording: flat config **replaces** a
rule rather than merging it, so the new block silently disabled the hardcoded-
colour rule over the same files and lint still passed. Both selector sets are
now composed into each block, and both were falsified separately — one
deliberate violation each, both seen red, then reverted.

**Two more defects the recording showed, in the same dialog.** The label field
was reseeded from the live editor selection on every parent render, so opening
the sheet — which moves focus off the editor — could blank both fields: 3 of 12
opens on the bench. The fields are now unmount-scoped and the selection is
captured once, when the sheet opens. And the dialog had **two Cancel buttons**,
one above the other, because `Sheet` already supplies one.

The two fields were also indistinguishable once filled — placeholders vanish,
and there were no labels — which is why the recording shows the same URL pasted
into both. They now carry visible labels, address first, and the address takes
the focus since it is the required one.

`richtext-e2e.mjs` gains the link dialog, which had no coverage at all: the
selection prefills the label, an unsafe scheme is refused, exactly one Cancel,
and the stored markdown is `[docs](https://ok.test/page)`. The Cancel count has
to be scoped to `role="dialog"` — react-native-web's Modal supplies that — since
the description editor behind the overlay has a Cancel of its own and a
page-wide count reads 2 whether the bug is present or not. It was written
unscoped first and failed for that reason.

**Verified.** `richtext-e2e` 28/28, the width sweep 182/182, `web-e2e` 106/106,
419 unit tests, lint and typecheck.

**And verified on Android, which is the only surface that can show it.** On the
AVD, with the keyboard up and the address field focused, ONE tap on Add link
closes the dialog: the sole significant change across an 8-second screen
recording is the dialog going away, 2.73 s in against a tap injected at ~2.5 s.
The device was confirmed to be running this code first — the sign-in stamp read
`v0.7.6 · 86e724d+` — because a bare `expo start` does not regenerate
`app/src/build-info.ts`, and it had been sitting at v0.7.5 from the last build.

The causal proof is the reverse: **removing `keyboardShouldPersistTaps` from
`Sheet` and letting Metro reload reproduces the report exactly** — one tap, the
dialog stays open. Restoring it makes the same check pass again. That check
lives outside the repo, in the session scratchpad, deliberately: CI has no
emulator, and a suite nothing invokes is not coverage.

### 2026-08-03 — Typing stops re-rendering the world — v0.7.5

**Client only.** No `functions/src`, `firestore.rules`, `firestore.indexes.json`,
`storage.rules` — and, unlike v0.7.0, no `packages/shared/src` either, so the
functions bundle is genuinely untouched and functions do not redeploy. Checked
with `git diff` against the v0.7.4 tag, not assumed.

Reported from a phone: the description editor was "unusable on Android, and like
a slide show on web". Three separate causes, all fixed, plus the pattern behind
the third fixed everywhere it occurs.

**The two acute bugs.** A native `defaultValue` was recomputed from
`initialMarkdown` on every render, so the editor re-seeded itself between
keystrokes and the caret snapped back — repeated spaces were impossible. And
`Sheet`'s backdrop carried `accessibilityRole="button"`, which react-native-web
maps to a real `<button>` ELEMENT wrapping the whole dialog, TextInput included;
the browser then treated a space typed in the field as activating it, so any
sheet with a field in it closed mid-word. It cost a label called "waiting on" its
space. Native renders no button element, which is why Android never showed it.

**The chronic one: drafts held in screens.** A text draft changes on every
keystroke, so a screen holding one re-renders every live-query list, markdown
render and `.map` it draws, per character. Ten instances, all moved into the
component that owns the field.

Measured before and after, by `scripts/typing-perf-e2e.mjs`:

| | before | after |
|---|---|---|
| Card description, 25 comments | 45.1 ms/char | 8.0 → 4.2 |
| Comment box, busy vs empty card | 21.1 vs 4.8 (4.41x) | 5.3 vs 5.2 (1.02x) |
| Add card, busy vs empty board | — | 1.5 vs 1.6 (0.94x) |

45ms/char is a ceiling of about 22 characters per second, which is why it read as
a slide show. The suite asserts a **ratio**, never a stopwatch reading: absolute
ms/char on a shared runner moves over 3x between runs, so an absolute threshold
would be either useless or flaky, and a check people learn to ignore is worse
than none. It was seen RED on the comment regression before the fix and green
after, so it can fail.

**What this retires rather than avoids.** `CardScreen` held `title`,
`titleDirty`, `editingTitle`, the same for the description, and an effect
re-seeding both. The two editors can be open at once and once shared one dirty
flag, so saving the title re-armed the effect and silently overwrote an unsaved
description — a long description lost with no error and nothing to undo.
Splitting the flag fixed it only while everyone remembered why there were two.
The screen now holds no draft and no seeding effect at all, so neither editor can
reach the other's state. A regression test for exactly that data loss was written
FIRST and seen passing on the old code, so it can report a change rather than
encode one.

Three `memo` wrappers (`Comments`, `ActivityLog`, `Attachments`) were **removed**,
not kept. They were a stopgap for the draft being in the wrong place; with no
per-keystroke render left they guarded nothing measurable while imposing a
standing requirement that every prop stay referentially stable forever. The
ratios held after removing them — measured, not assumed.

Also: every editor now closes only once its write LANDS, so a failed save leaves
your text on screen instead of discarding it behind an error. `ColumnNameEditor`
was changed to match `saveLabelName` rather than documenting that two editors one
screen apart differed. And `WideBoard.tsx` no longer calls `.sort()` on an array
owned by a `useMemo` during render.

Coverage went up alongside: comment editing, subtasks, title rename, Escape
closing the web composer, the composer emptying after a post, byte-equality
through the comment EDIT path, and a `board-compose` sweep entry — the first
screen in the sweep with any composer open at any width, which is the blind spot
that let the `<button>`-wrapping-a-`TextInput` bug ship.

Verified, re-run in full after the release bump: unit 419 (functions 383,
shared 27, app 9), emulator 291, and every e2e suite — sweep 182/182 at five
widths, web 106/106, stats 271/271, richtext 22/22, attachments 17/17, and
typing-perf 3/3 at ratios of 1.09 (comment) and 0.74 (description), against the
4.41x that started this.

**Two checks are NOT covered by any of that, and were done on the emulator
instead.** Every suite here is web-only, and the native `RichEditor.tsx` is a
different file from `RichEditor.web.tsx` — the original "unusable on Android"
bug lived in the native one, where no web suite could see it. So the comment
composer and a comment being edited were each typed into with repeated spaces
and read back with `adb shell uiautomator dump`, the method that proved the
original fix. Separately, `WideBoard.tsx` (the native tablet board) is reached
by no Playwright suite at all — Metro serves `WideBoard.web.tsx` on web and
`NarrowBoard.tsx` narrow — so its shared `AddCardForm` was checked by
screenshot at tablet width.

### 2026-07-31 — A real app icon — v0.7.4

Icon assets and config only. No functions, rules, indexes, shared package or
app source — checked with `git diff`, not assumed.

The app shipped with Expo's scaffold icon and a stray `#1F6FEB` adaptive
background left over from it. It now carries the Sabeel calligraphic mark with a
raspberry badge, matching the sibling apps: **one mark, one badge per app**, so
three Sabeel icons read as one family. `scripts/make-app-icons.py` builds all
three from `docs/brand/sabeel-mark.png` — the lockup with its wordmark removed,
since "SABEEL INSTITUTE" is a smudge at 48dp and costs the calligraphy its size.

**The geometry is measured, not chosen.** An adaptive icon's foreground fills the
whole 108dp layer and only the central 72dp survives the launcher's mask — 66.67%,
so the safe radius on a 1024 canvas is **341, not the 350** a "roughly two thirds"
reading gives. That 9px difference is real badge edge a circular mask would shave.
Within that circle the badge size, how low the mark sits, and the badge's bearing
all trade against each other; each bound came from rendering candidates and
counting the calligraphy pixels lost:

- **Badge 410px** (40% of the icon) hides zero strokes; 418px starts cutting the
  sweep.
- **Mark at cy=637** is the deepest that fits; at 643 its own descender reaches
  343 and leaves the circle. Dropping the mark is what frees the arc the badge
  needs — it grew from 296px to 410px, +92% in area.
- **Bearing 38°** is the flattest that costs nothing; 36° already hides 12px.

Mark and badge both land 338 from centre, three pixels inside the wall. The
script re-proves both invariants on every run and exits non-zero if either
breaks, so the numbers above cannot rot silently.

**Written as native resources, not left to prebuild.** All three repos commit
`android/`, so `app.json` alone changes nothing Gradle sees — and `expo prebuild`
would regenerate `build.gradle` and silently drop this repo's hardcoded
`minSdkVersion 33`. The script writes exactly what prebuild would (foreground at
108dp per density, legacy square and round at 48dp, both `mipmap-anydpi-v26`
XMLs, an `iconBackground` colour), so a later prebuild is a no-op rather than a
conflict.

Verified by compositing the shipped foreground over the declared background and
masking it as a launcher does: zero badge ink outside the circle mask, the ivory
ring renders as true ivory (no halo), and the launcher icon was read off the
emulator rather than inferred from the build.

### 2026-07-31 — A long name stopped evicting its own buttons — v0.7.3

Client only. No functions, rules, indexes, shared package or backfill —
checked with `git diff`, not assumed.

Reported as "why does that label have two coloured dots". The second dot was an
emoji typed into the label's NAME — not a bug, and not something the colour
picker can change. But the screenshot showed a real one: that row was the widest
on the screen and its **delete button was sliced in half by the right edge**,
with two neighbouring rows heading the same way.

The name was not allowed to give way, so it evicted the controls. Two causes:

- **Labels** — the name row now shrinks and wraps to two lines while the actions
  hold their width. Two lines rather than one, because a single line clipped it
  to "Waitin…" and a settings list you cannot read the names in is not much use.
- **Columns** — the same shape, found only because of the new check below.
  `ColumnNameEditor`'s row inherited react-native-web's `flex-shrink: 0`, and
  `ReorderList`'s row had `min-width: auto`; a flex item refuses to shrink below
  its content until both are answered.

**The sideways-scroll check was blind to it.** The overflow happened inside a
clipping ancestor, so the page width never changed and that assertion stayed
green through both bugs. The sweep now also asserts that **no control extends
past the right edge**, seeded with a label shaped like the one that broke —
emoji prefix and all. Verified by reverting each fix and watching the check
fail, then on a device: 9 row controls, 0 clipped.

### 2026-07-31 — Icon sizing, and three phone-testing findings — v0.7.2

Client only. No functions, rules, indexes, shared package or backfill —
checked with `git diff`, not assumed.

Faisal tested v0.7.1 on a phone. Everything below came from that, or from the
review passes it triggered.

1. **The column name flipped back and forth** while an arrow-driven move
   animated — 1 -> 2 -> 1 -> 2 on one tap, and never when swiping. The arrows
   set the page at once so the header answers the tap, then animate; every frame
   of that animation fired `onScroll`, which rounded the offset back to the
   column being left. Pages an animation passes through are ignored now, and a
   finger on the pager cancels the filter. Guarded by sampling the header DURING
   the transition — a screenshot of the settled state looks perfect.
2. **One icon ink size, 24, everywhere.** Four were in use (13/18/22/24) with no
   rule and three on the card screen alone. The 44x44 box is unchanged, so
   nothing reflows — but the two rows that were genuinely tight (4px) went to
   8px, because bigger glyphs are only free if the row can breathe.
3. **Delete column asks in a modal**, where the thumb is. The confirmation
   rendered as a Panel near the TOP of the screen and the "still has N cards"
   refusal went to the banner up there too — a screen away from the bin, and
   reading as one more card rather than an answer.
4. **The card's section icons were ~8px above their headings.** `Heading` put
   the 16px section gap on the TEXT, and flexbox aligns margin boxes, so the
   text sat lower than the icon. The gap moved to the row; measured 0px apart on
   device afterwards.
5. **The bulk bar could not fit one row and was bleeding off-screen.** Six 44px
   actions need 304px; a 320px phone gives 264. Dismiss moved beside the count,
   leaving five that fit. Two traps on the way: Yoga defaults `flexShrink` to 0
   (unlike CSS) so the row overflowed instead of wrapping, and the first wrap
   orphaned the close icon alone on a second line.

**Coverage added**: manager and member tours at both narrow widths — the sweep
had only ever run as an admin, which is the one place a bug is invisible to the
person who owns the app. 157 checks, and the whole sweep runs in 197s.

### 2026-07-30 — Board and navigation icon pass — v0.7.1

Client only. No functions, rules, indexes, shared package or backfill — checked
with `git diff`, not assumed.

Found by testing v0.7.0 on a phone: the board spent too much of a 320px row on
words, and the same labelled-button habit had crept back in four places.

**Changed**

1. **The pager is arrows.** `‹ Prev` / `Next ›` were full buttons with 16px
   side padding that stretched to the row height — together ~150px of a 288px
   usable width, taken from the column name. Now `chevron-left` /
   `chevron-right`, labelled *Previous column* / *Next column*. Deliberately not
   `arrow-back`: that glyph means "leave this screen" everywhere else.
2. **The column name is actually centred now.** The row is `text + gap + 44px
   pencil` and the parent centred that whole unit, so the name sat ~24px left of
   centre. A **balance spacer** mirrors the pencil on the left with a shrink
   weight of 999, so the name lands on the centre line, and a long name
   collapses the spacer and slides the pair LEFT rather than truncating early.
3. **The phone header is the board name and Back.** Archived cards and Board
   settings moved to the row along the bottom, beside `+ Add card` and the
   column delete — which is now a bin icon. `+ Add card` keeps its label: it is
   the primary action of the screen. Wide layouts are untouched.
4. **The archive list stopped shouting.** "Restore to the board" written out
   once per row, plus a Delete button per row, was two labelled buttons and a
   button-height band on every card. Both are icons on the card's own row now.
   **Delete also asks first** — it shipped firing on the first tap, one row from
   Restore, with nothing behind it.
5. **Back is one thing everywhere.** It was 7 icon sites against 7 that spelled
   the word; the word ones are now the arrow. `Back to boards` → `All boards`
   and `Back to inbox` → `Inbox`, because those reset to a root rather than
   popping, and because Playwright matches accessible names by substring — 15
   call sites looked up `Back` and could resolve to either.

**Two bugs the sweep caught rather than a human**

- Putting board actions in a per-column footer rendered **three** "Board
  settings" buttons — every column page is mounted so the pager can swipe. A
  strict-mode violation in Playwright; a screen reader would have announced
  three identical buttons. Gated to the visible page.
- The tour never left column 1, so the long-name behaviour would have shipped
  unphotographed. The seed now carries a deliberately long column name and the
  sweep asserts and screenshots that state. With the states added by the review
  below, the sweep now runs **151 checks** across five widths, up from 135.

**Five more found by a multi-pass review afterwards**, three of which predate
this release entirely — they were invisible because the sweep toured SCREENS at
rest and none of these are screens.

- **A board with NO columns was a dead end on the phone.**
  `columnDeleteBlocked` only refuses a column that still holds cards, so the
  last empty one can be deleted — and the board actions had just moved into the
  column footer, which a board with no columns does not render. Board settings
  is the only way to add a column back. There is now an empty state carrying
  those actions, and a seeded zero-column board asserts it.
- **Every column page sat in the accessibility tree at once.** All pages are
  laid out so the pager can swipe, so a screen reader walked nine columns of
  cards and heard "+ Add card" nine times. Off-screen pages are hidden with
  `aria-hidden` / `accessibilityElementsHidden` /
  `importantForAccessibility`. This one predated the release; it is the same
  defect the three duplicate "Board settings" buttons were.
- **Three glyphs for one action** — `✕` on web, `close` on native wide, a bin on
  narrow, and only the bin not danger-tinted. Both RN surfaces now use a danger
  bin. The web board's `✕` is left as it is, and is the remaining inconsistency.
- **The bulk-selection bar pushed the page sideways, and its own close button
  off-screen.** A manager sees six 44px actions; 6 x 44 is 264px, which is
  exactly the inner width at 320px before the gaps or the "N selected" count.
  Measured with the fix removed: **46px of bleed at 320, 6px at 360, none at
  390 and above** — so it never bit a modern phone, which is why nobody
  reported it. It wraps now instead. Pre-existing, and the bulk state had NO
  coverage at all; it is now toured at every width.
- **A member on a board with no columns** was the one combination neither fix
  had been tested against. Correct: the archive stays reachable, Board settings
  stays hidden, and the empty state's hint changes to say a manager must add
  the first column.

**A note on how two of those were nearly missed.** The first check written for
the page-clamp passed with the fix REMOVED — the ScrollView clamps its own
offset and `syncPage` repairs the index before it is visible — and chasing why
is what turned up the zero-column dead end. The first accessibility audit used
`querySelectorAll`, which ignores `aria-hidden`, so it reported the same numbers
before and after the fix. Both are the house failure: an instrument that cannot
see the thing it is pointed at.

Verified: lint, typecheck, unit, emulator, and all five e2e suites; screenshots
read at every width; Android checked by hand on `tb_emu`, including the archive
icons and the native delete confirmation.

### 2026-07-30 — Rich text for descriptions and comments — v0.7.0

Reverses the 2026-07-20 plain-text decision, which said to revisit "on an
explicit request from the team". Both of its reasons were retired on their own
terms rather than overruled: nobody has to learn syntax, because both editors
are WYSIWYG and **markdown is a storage format the user never sees**; and
"a rich editor means a WebView on Android" stopped being true when Software
Mansion shipped a native Fabric editor.

**The vocabulary is five elements** — bold, italic, bullet list, ordered list,
link. No headings, code, quotes, tables or images (attachments cover images).
That is not a compromise: measured against production, the team's real content
contains **zero** hand-typed markup, and its only structure is paragraphs, a few
lists and bare URLs. A small vocabulary is also what makes the round trip
provable.

**A platform seam, deliberately.** Lexical on web, `react-native-enriched-html`
on Android, each used only where it is strongest — the *experimental* part of
the native library is its web support, which we never load. The renderer, the
toolbar, the mention policy and the markdown↔HTML converter are all SHARED; only
"where is the caret" and "run this command" differ.

**Escaping is the correctness core**, not a detail. Typing `2 * 3 * 4` stores
`2 \* 3 \* 4` and renders as literal asterisks. The escape set is exactly the
parse set — `\`, `*`, `[` and a line-leading `-`/`+`/`N.` — and deliberately NOT
`_`, backtick or `~`, which are outside the vocabulary and would otherwise store
`snake\_case\_name`.

**What it fixed on the way.** Mid-text mentions now work: `activeMentionQuery` is
`$`-anchored, so in the plain-text box a mention had to be the last thing typed.

**Accepted residuals.** Underline can be set by a hardware Ctrl+U on Android,
markdown cannot express it, and the converter drops it — so the text visibly
un-underlines; the library exposes no opt-out. Link TEXT is searchable, link
TARGETS are not.

**Legacy content re-renders, by decision.** Ten list blocks now draw as lists and
six bare URLs became tappable. Verified against production first: all 103 real
descriptions and comments through parse-and-normalize with **zero words lost or
altered**, and through three converter cycles with **zero drift**.

**Surfaces: client AND functions.** No `functions/src`, `firestore.rules`,
`firestore.indexes.json`, `storage.rules` or backfill changed — checked with
`git diff`, not assumed. But `@sabeel/shared` did, and esbuild does **not**
tree-shake the new modules out of the functions bundle: grepping the built
`functions/lib/index.js` finds `parseRich`, `serializeRich` and `storedLength`
in it. So functions deploy too, even though **no function's behaviour changes** —
nothing server-side calls any of it. Worth knowing rather than assuming, because
"client only" was true of the last release and is not true of this one.

Verified: 419 unit (including a seeded 400-document round-trip fuzz), 291
emulator, and five e2e suites — attachments 17, web 91, stats 271, screens 135,
rich text 19. The rich-text suite proves byte identity across reload-and-resave,
that a rich paste is reduced before it reaches Firestore, and that the cap blocks
the WRITE rather than only the button.

**The cap counts CHARACTERS, not UTF-8 bytes** — measured, because the existing
test used ASCII and could not tell the two apart. Had `size()` been byte-based,
an accented or Arabic description would have passed `storedLength`
(`String.length`), been offered a live Save, and returned a bare
`permission-denied`. Two rules tests now pin it: 20,000 x `U+00E9` is 40,000
bytes and is accepted; 20,001 is rejected. The screen sweep now tours a card in
three states — at rest, description editor open, comment composer in use —
because an editor adds a toolbar row and a Save/Cancel row that exist in no
other state, and 320px is where they run out of room.

**Android: RUN BY HAND on the `tb_emu` emulator, 2026-07-30.** There is no
Playwright equivalent for the native surface, so this is a checklist rather than
a suite — but it is a checklist that was executed, not one that was written
down. Debug build against the seeded emulator backend
(`EXPO_PUBLIC_USE_EMULATORS=1`, so it cannot reach production), Fabric confirmed
in the bundle log.

| Checked | Result |
|---|---|
| The editor mounts, both surfaces | Toolbar of five icons on description AND comment composer |
| Keyboard up | Editor, toolbar row and Save/Cancel all stay visible — the risk the spike flagged |
| Markdown into the editor | Bold, italic, both lists and a link all load correctly |
| **Markdown back out, three cycles** | **Byte-identical each time**, read back with the Admin SDK |
| Escaping, rendered | `2 \* 3 \* 4` shows literal asterisks; `snake_case_name` stays bare |
| Editor type size vs the card | Measured off the screenshots: 1.007x — antialiasing, not a size difference |
| Mention popover | Opens above the input and lands fully on screen with the IME up |
| Largest system font (1.3x) | Toolbar stays one row, Save/Cancel do not clip, nothing overlaps |
| **A large paste** | Four pastes of a 5,878-char formatted description. Bold, italic and links all survived, and the app reported **exactly** "3512 characters over the 20000 limit" — 4 x 5,878 = 23,512, which is 3,512 over, so every character of every paste landed |
| The cap, on device | Save disabled with that reason on screen; tapping it wrote nothing (stored length still 5,878) |
| A mark over a selection | Select-all, tap Bold: the text goes bold, the button shows its active state, and the comment stored as `**ray**` |
| JS errors | None; the only warn-level line is an existing session log |

**Rotation is NOT a test on this app** — it is portrait-locked in both
`app.json` and `AndroidManifest.xml`, so the old checklist item asked for
something that cannot happen.

**One narrow gap remains: a paste from a BROWSER.** The paste above went through
the real Android clipboard and carried its formatting, so the paste path itself
is proven — but out-of-vocabulary HTML (a heading, a table, an image) arriving
from Chrome is still covered only by the shared converter's unit tests and the
web e2e, not on a device.

**`adb shell input text` is the wrong tool for this editor**, and that is a
harness limitation rather than a bug: it synthesises keystrokes faster than a
Fabric editor consumes them, so characters drop. It produced `Cir tepsit****fe
ria` once, which looks exactly like a converter fault and is not one — a slower
retry dropped characters but produced no asterisks. Drive the editor by
CLIPBOARD instead (`input keycombination 113 29 / 31 / 50` for
select-all / copy / paste): one event rather than a stream, and it behaves
perfectly.

**Both editors inherit a font from their platform rather than from the app.** On
web that shipped as Times at 16px against the app's sans at 15 until a manual
screenshot caught it; native's default is different again (14), so it is pinned
in `RichEditor.tsx`. The web half is asserted by `richtext-e2e.mjs`; the native
half is measured off a screenshot, above.


### 2026-07-29 — Two dead ends found by a new harness — v0.6.1

Client only. No functions, rules, indexes, shared package or backfill —
checked with `git diff`, not assumed, so the functions bundle is untouched.

**Fixed**

1. **Stats was a dead end on a phone browser.** It is a pushed screen, so the
   bottom bar does not render, and it shipped without a Back button — the only
   pushed screen in the app missing one. Android's hardware Back covered it;
   a phone browser has none, leaving only the browser's own gesture.
2. **Search opened the on-screen keyboard on phone browsers.** Autofocus was
   keyed off `Platform.OS === 'web'`, and a phone browser is web — so the
   keyboard opened over the results on exactly the surface the setting had been
   added to protect. It is a width question: now `&& isWide`.
3. **`Screen` gapped its children only on wide layouts.** The gap rode on the
   same style object as `maxWidth`, undefined on a phone. Measured: 390px
   reported `row-gap: normal` and gaps of [0, 0] where 1024px reported 8. The
   board opts out — `width="full"` never had the style at any width.

**The tooling that found them.** `scripts/screens-e2e.mjs` replaces four
hand-run screenshot scripts (`device-shots`, `responsive-shots`, `screen-tour`,
`manual-shots`, all deleted). Ten authenticated screens x five widths
straddling the breakpoint, screenshotted AND asserted: no sideways scroll, no
same-layer control overlap, a way out of every screen, the right board layout,
search focus by width. 115 checks, wired into CI, guarded by `ciCoverage`.

The four it replaced could not fail — the closest wrapped its whole body in a
try/catch that logged and continued, and had rotted to clicking "People" as a
top-level button long after that moved into the More sheet.

**Why these survived.** The card tile's test hook was a raw `data-testid` in
`WideBoard.web.tsx` — the web-only half of a platform seam. Nothing could
address a card on any other layout, so every existing e2e suite ran wide and
the phone board had no coverage at all. The handle is now on all three board
layouts and My Work.

Verified: 494 e2e checks green across all four suites (attachments 17, web 91,
stats 271, screens 115), 371 unit tests, lint and typecheck clean. Both new
assertions mutation-proven — each was made to fail by reverting its fix.

### 2026-07-29 — Shipped v0.6.0

Client only — no functions, rules, indexes or backfill. The only shared change is
`filterCards`' board filter, which nothing server-side imports (checked, not
assumed), so the functions bundle is untouched.

Web and APK deployed together. Search now keeps its filters across a card,
filters by board, and no longer opens the keyboard; the assignee picker filters
by text; and the sweep's fixes ride along — a pinned error banner, 44pt chips,
and `stats-e2e` running in CI for the first time.

### 2026-07-29 — Lateral sweep: four fixes, and a lot of looking that found nothing

Took the Search findings as classes rather than instances and swept the app for
each. Most classes came back clean, which is the honest headline — the app was in
better shape than the plan assumed, and several things I listed as suspects were
already handled deliberately.

**Fixed**

1. **The live-data error banner could scroll out of view.** Every
   `useLiveQuery`/`useLiveDoc` failure publishes to a global slot that `Screen`
   renders — a genuinely good safety net — but the banner sat INSIDE the scroll
   container, so on a long card or board it lived above the fold and a scrolled
   reader never saw it. Silent for exactly the people most likely to hit a
   rejected listener. Now pinned outside the scroller.
2. **`scripts/stats-e2e.mjs` never ran in CI** — 271 checks across nine viewport
   widths, green on a laptop, invisible to CI for a whole release. Now wired in.
3. **Nothing guarded that.** `app/src/ciCoverage.test.ts` now fails if any
   `scripts/*-e2e.mjs` is missing from the workflow, the sibling of
   `suite-coverage.test.ts` for the emulator lists. Mutation-proven: it names the
   missing suite.
4. **`FilterChip` had a 36pt touch target** against the 44 the app adopted in
   v0.1.22 — the lone outlier, since `IconAction`, `SheetOption` and the
   segmented control are all 44. Fixed with `hitSlop` in the component: 44pt of
   target, 36pt of ink, not a pixel moved on screen. That is the pattern
   CLAUDE.md already prescribes.

**Looked, found nothing** — recorded so nobody re-investigates:

- *Writes driven by possibly-failed reads.* `CardScreen`'s move and subtask
  creation both compute ranks from `boardCards.data ?? []`, but both controls are
  disabled behind `cardsReady` (`status === 'ready'`), so the fallback is
  unreachable. Already right.
- *Dangling favourites / recents / mutes.* Never pruned when a board is archived,
  but `sortBoardsForList` filters the LIVE board list by the id set, so a dead id
  simply never matches. No blank rows, no error. Restoring a board re-favouriting
  it is arguably correct.
- *A notification outliving its card.* Renders "Card not found — it may have been
  deleted" with a Back button. Tolerated visibly, which is the rule.
- *Stale-closure updates.* Six candidates, all false positives — they set from a
  different source (`card.data.title`), matched only because the variable name
  appears in the argument.
- *Async work outliving a screen.* Only TWO async effects exist in the app and
  both are guarded. An earlier count of "CardScreen: 11 awaits, 0 guards" was a
  bad measurement — it counted handler awaits, where the component is mounted by
  definition.
- *Client caps vs server limits.* All fourteen `maxLength` uses take the shared
  constant; no literals.
- *`unreadNotifCount` with two owners.* The risky path is a TRANSACTION that
  re-reads `read` before decrementing, `markAllRead` zeroes rather than
  decrements, and the nightly sweep RECOMPUTES from a `count()` query. Sound.

Two of my own measurements were wrong and the discipline caught both: the
async-effect count above, and a new test that failed with ENOENT because it
assumed vitest's cwd — it is the app workspace under `npm test` and the repo root
under `vitest --root app`. It is anchored to its own file now and verified under
both invocations.

Verified: 335 + 27 + 9 unit, 91/91 web e2e, 271/271 chart.

### 2026-07-29 — Review of the search work: five findings

Five passes over the new code and the components sharing its patterns.

1. **An active filter could become INVISIBLE while still narrowing.** A board can
   be archived and a label can be deleted while selected; both then drop out of
   the lists the chips are built from, so the chip vanished while the filter kept
   applying — zero results, no cause on screen, nothing to tap. Both now always
   render a chip ("Unavailable board", "Deleted label"). The rule is now stated
   and tested: **every active filter is visible and removable, even a broken one.**
2. **Every chip handler read stale state.** `!archivedOnly`, `priority === p`,
   `labelIds.filter(...)` all closed over the value from their own render, so two
   taps landing in one batch both computed from the same snapshot and one was
   lost. The store now takes a functional patch and every derived update uses it.
   `MentionField` was bitten by this exact thing — "key repeat is faster than a
   render" — so it was a known trap, not a theoretical one.
3. **The Filters chip lied to screen readers.** It announced "Filters filter,
   off": a filter state a sheet-opening action does not have. `FilterChip` now
   takes an accessibility override, and the chip is no longer a fake toggle.
4. **The same state-loss bug existed on two more screens.** My Work's
   Assigned/Subscribed choice — the phone's default landing surface, so the
   most-hit version — and the boards list's filter text. Rather than a third
   near-identical module, the mechanism was extracted to
   `app/src/viewState.ts` and all three now share it.
5. **`app/` had no test runner at all.** A `src/**/*.test.ts` file sat on disk
   and would never have executed — coverage that does not exist but looks like it
   does. Added a node-environment vitest config scoped to `.ts` only, so pure
   logic is testable while components stay with the Playwright suites and
   screenshots.

Every new assertion was mutation-checked, and two mutations had to be redone
because the first attempt proved nothing: one corrupted the READ path as well as
the write, and one broke the mode switch outright so the run aborted before
reaching the check under test. The faithful mutation — a store that works within
a mount and is not re-read on remount — fails exactly the three restoration
checks, reporting `text "" (wanted "Fix"), board chip false`.

Verified: 335 + 27 + 8 unit, 193 + 96 emulator, 91/91 web e2e, 271/271 chart.

### 2026-07-29 — Search remembers, filters by board, and stops grabbing the keyboard

Four things, three of them friction people hit and one a missing filter.

- **The keyboard no longer opens with Search.** `autoFocus` made sense while
  Search showed nothing until you typed; once it started BROWSING by default the
  keyboard covered the list the screen exists to show. Now web-only — there is no
  keyboard to pop on a desktop, and Search is a screen you open in order to type.
  Same `Platform.OS === 'web'` check `theme/layout.ts` already uses.
- **Back from a card restores the search.** `App.tsx` renders one screen per
  route, so opening a card UNMOUNTED `SearchScreen` and every `useState` in it
  died. Nothing about the nav stack was wrong — the state had to outlive the
  component, so it moved to `app/src/searchFilters.ts`, the same module-plus-
  listeners shape `nav.ts` uses. Session-only; kept across tabs too, since one
  rule is easier to predict than two.
- **A clear-all**, which the point above makes necessary. An `IconAction`
  (`filter-alt-off`) that exists ONLY while something is narrowing the results,
  so it is never a dead control. `hasActiveFilters` in `@sabeel/shared` already
  answered "is anything on" and now counts the board too, so the button cannot
  drift out of step with the filters themselves.
- **Filter by board**, without the screen becoming a pile of controls. The two
  UNBOUNDED lists — board and label — share one `Filters` sheet; the four binary
  toggles stay one tap, Archived especially, since Search is the route to the
  archive. Whatever the sheet selects returns as a removable chip, so "what am I
  filtering by?" is one row rather than scattered across five controls.
- **The assignee picker gained a text filter**, matching `Subtasks.tsx` rather
  than inventing a second idiom for the same job.

Two things found along the way. Search results carried no `testID` while board
tiles did, so a test could not open a card from Search — they now share the
handle. And the new clear-all rendered at `text.muted` (2.34:1), which is exactly
the contrast the caption audit had just moved away from; `IconAction`'s default
is now `text.secondary` for all 54 call sites. Icons are the ONLY label many
actions have — edit, delete, move, archive — so they are the last thing that
should be faint.

Verified: 335 + 27 unit (the board filter mutation-checked), 193 + 96 emulator,
90/90 web e2e including "open a card, press Back, everything is still there",
271/271 chart checks. The keyboard is the point of the first change and a green
suite says nothing about it, so it was confirmed by Android screenshot — no
keyboard, and the two chip rows laid out as designed.

### 2026-07-28 — A blocked popup no longer strands people — v0.5.1

Three colleagues could not sign in on the web. The white page they saw is
Firebase's own `/__/auth/handler`: "Unable to process request due to missing
initial state." Reproduced exactly by loading that URL with no state.

`authDomain` was already the hosting domain (`…web.app`), so the usual
storage-partitioning fix was in place — confirmed on the RUNNING app, not just in
source: the popup targets `web.app/__/auth/handler`. The cause was our own
fallback. A link tapped inside WhatsApp opens an in-app browser, the popup is
blocked, and we silently called `signInWithRedirect`. That returns to
`/__/auth/handler`, which needs the `sessionStorage` written before the bounce —
and the webview does not have it on return. Firebase then renders its error on a
page **this app is not running on**: nothing can catch it, there is no way back,
and re-opening the link lands on it again. Exactly what was described: first the
notice, then "unable to open browser", then eventually working after opening it
properly.

A blocked popup now hands the choice over instead: it says the window was
blocked, names the site to open in Safari or Chrome, and offers "Try anyway"
which runs the redirect explicitly — still the right answer on a desktop browser
whose popup blocker is merely set to block, which is what the fallback was for.

Verified by blocking `window.open` exactly as an in-app browser does and driving
the real exported bundle: the explanation appears, the button appears, and the
page does **not** navigate away.

**What this does not do:** make sign-in work *inside* the chat app's browser.
That is broken by the browser's storage partitioning, not by our code. People are
told to open it in a real browser, which works.

### 2026-07-28 — Shipped v0.5.0

Deployed in order: indexes → functions → rules/storage → backfill → hosting →
APK. Every surface in one batch.

- **Indexes** first, and the `months.days` exemption confirmed live (`indexes: 0`
  on the field), so the hottest document in the system is not carrying ~250
  index entries nothing queries.
- **Backfill** dry-run reconciled (96 cards / 49 comments) and then wrote 16
  month documents. Verified afterwards against the live truth: `bytesStored`
  3,348,094 and `filesStored` 5 **agree exactly** with a direct sum of the ready
  attachments.
- **Web** live and serving `0.5.0 · 711f09b` — checked by fetching the deployed
  bundle, not by trusting the deploy output.
- **APK** built, then installed and RUN before publishing (R8 strips
  reflection-reached classes, so a release build that was never launched is not
  verified). Launches clean at v0.5.0. Published as a release asset on the fixed
  `kanban-latest` tag; the pages repo still holds **zero** `.apk` blobs.
- **11/11 index probes** green against production after the deploy.

**One artifact, and it is permanent unless corrected: the deploy day itself.**
The backfill deliberately never writes today, and the triggers only gained the
counting code partway through 28 July — so the 18 cards created that day are
counted nowhere. Re-running `scripts/backfill-stats.mjs --write` on any later
day rebuilds 28 July from the source documents (which all still exist) and
`set`s it wholesale, so it is safely repairable and does not double count. Only
`bytesRemoved` for that day is unrecoverable, and it was zero.

The versioned GitHub Release failed on the first attempt with
`target_commitish is invalid` — the commits had not been pushed yet. Push first,
then publish.

### 2026-07-28 — Judgement calls from the review

Decided with Faisal after the review, one at a time:

- **The backfill now imports `todayInOrgTz`** instead of reimplementing the
  org-timezone day-key rule. It is the script that repairs drift in the live
  counters, so a second copy of the rule could only ever file the repair on
  different days than the thing it repairs — and it would look like it worked,
  because the numbers would move.
- **The chart's history window uses calendar months** (`monthsBack`) rather than
  330 days snapped to the 1st. `STATS_MONTHS_BACK` now means what it says at
  every month of the year; the property is asserted for all twelve.
- **The `'unknown'` actor fallback is left unguarded.** Traced and unreachable:
  rules require the author fields, every server sweep either sets `updatedBy` or
  produces no diff at all, and a delete returns no entries. A guard there would
  be defensive code at an internal boundary.
- **`Screen` spacing its children only on wide layouts is deferred** to its own
  change after v0.5.0. Real, and measured — the stats chips sat 9px under the
  dropdown where 16 was intended — but the fix moves the vertical rhythm of
  every screen at once and deserves a screenshot sweep of its own.
- **The muted-caption question in BRAND.md is closed** — see below.

### 2026-07-28 — Muted text that carries meaning moves to Hint

`text.muted` measures 2.07–2.92:1 depending on the surface: below AA, and below
even the 3:1 non-text floor on three of four backgrounds. `ui.tsx` already drew
the line — `Caption` is "text you could delete without losing information" — and
the failures were the places that rule was not being followed.

Thirty-five `Caption` sites moved to `Hint`. Seven remain, all disposable:
timestamps, the build stamp, a file's type, "current", two counts the adjacent
list already shows.

`Caption` was not the only route to the colour. `Body` had a `muted` variant and
**every one of its seven callers used it for meaning** — empty states,
instructions, "You are not a member of this board". Those are plain `Body` now,
and the prop is removed rather than left unused.

`text.muted` itself is NOT darkened: that would collapse the distinction with
`text.secondary`, so counts and timestamps would stop receding and every screen
would read busier. Same type size throughout, so this shifts no layout — a
colour change only, which is why it was safe to include here while the `Screen`
spacing fix was not.

### 2026-07-28 — Deep review of everything since v0.4.0

A multi-pass review before shipping v0.5.0, prompted by several errors that
shared one shape: **a check or a claim that can be true while the property is
false.** Five defects fixed, each with a test proven to fail without it.

1. **A permanent card delete never subtracted its files from the stored total.**
   `onCardDeleted` is `recursiveDelete` plus a bucket prefix sweep and never
   touches `applyDeleteAttachment`, where the counter lives — so "Files stored"
   climbed on every delete and could not self-correct, `bytesRemoved` being
   forward-only. Now read before the delete, recorded after it, with no actor
   (the deleted card's `updatedBy` is whoever last EDITED it).
2. **Comment counts bucketed on client-supplied `createdAt`.** Rules list it in
   `hasOnly` but never constrain its value, so a caller could place a count on
   any day — and address any month document it named. Now server time, like
   every other counter.
3. **The middle gridline lied about its own position.** `Math.round(max / 2)`
   against a line drawn at exactly half height: a max of 3 labelled it 2 while
   sitting at 1.5, and a max of 1 — an ordinary quiet day — put two lines
   marked zero on the same chart.
4. **The storage figure showed "0 B across 0 files" while still loading**, and a
   failed board read silently emptied the filter. Both are the `LiveState`
   trap: `data: undefined` means loading AND error.
5. **The trigger tests were date-dependent** — asserting a hardcoded `2026-07` /
   `28` against triggers that bucket on `Date.now()`. Green only on the day they
   were written; every later day would have looked like a broken feature.

Two instrument defects, which matter more than the bugs:

- **A failed functions build leaves the emulator running the PREVIOUS bundle.**
  A mutation that deleted a call orphaned its import, tsc failed, esbuild never
  ran, and the test went green — reported as "this test cannot catch the bug"
  when the truth was "the bug was never in the binary". Only trigger tests are
  affected; tests importing `../../src/*` run the source. Recorded in the
  expo-firebase-stack skill, along with the rule: **check the build's exit code,
  and prefer type-clean mutations.**
- **Two assertions passed vacuously**: one waited for a derived byte total to
  reach a value it could only reach by the work happening (a value that never
  moves cannot satisfy an equality wait), and one used `filter(...).length === 0`
  which is also true with no bars at all. Both now assert the event and the
  count.

Claims audit: every contrast figure in `palette.ts` and `BRAND.md` was
recomputed and matches exactly, old and new — including the open-question table,
which I nearly reported as wrong before checking its column headers. The volume
figures re-verified. The import-spike claim had already been corrected.

Verified after the fixes: 327 + 27 unit, 193 + 96 emulator, 84/84 web e2e,
271/271 chart checks across nine widths, **11/11 index probes against
production** (the stats probe had never actually been run), and the backfill
proven idempotent by two `--write` runs producing byte-identical documents.

### 2026-07-28 — Stats, and Account becomes More — v0.5.0 (built, not yet deployed)

A Stats screen for managers and admins: cards created, cards archived, comments,
active people, files added and files removed, one metric at a time, bucketed by
day / calendar week / calendar month, filterable to one board or all. Plus the
attachment bytes currently stored. The fifth nav item is renamed **More** and
sectioned ORGANISATION / YOU, because two of the things behind it (People,
Stats) are org administration rather than anything to do with your account — and
it now shows the running version, which previously appeared only on the screen
you leave when you sign in.

Counting happens at event time; there is no scheduled job. See
`docs/PRODUCT_BRIEF.md` § Stats for why, and for the rule the design exists to
enforce: a counter must never be able to damage, block or duplicate the thing it
counts.

Verified: 327 shared + 27 functions unit; 193 rules + 94 trigger tests in the
emulator, including a 30-card burst asserting exactly 30 `created` activity
entries (no trigger retried) and the counters reaching exactly 30. Four mutation
checks each went red on the intended test — UTC day key, dropped `_all` fan-out,
finalize hook hoisted above the ready guard, and `recordStat` allowed to rethrow.
Web e2e 84/84. A dedicated chart suite (`scripts/stats-e2e.mjs`) seeds a year of
dense data and runs **190 checks across nine viewport widths** (320→1600),
asserting at each that axis labels never overlap, are never truncated, are never
sliced by the scroll edge, that bars stay tappable, and that the page never
scrolls sideways. Looked at on web at 320/768/1600 and on Android — where the
More sheet, the calendar-strip axis, the gridlines and tap-to-read were all
confirmed by screenshot.

Period selection is a **segmented icon control**, not chips. Chips each turn on
and off, which says "combine any of these"; a segmented control is one object
with one part lit, which says "choose one". Rendered as two chip rows the six
controls read as a single wrapped set with two selections lit, and no amount of
space fixed that — a different SHAPE did. The spacing hierarchy behind it is now
asserted as a ratio (between groups ≥ 2× within a group), because absolute gaps
drift with the type scale.

Also found: **`Screen` gaps its children only on WIDE layouts.** The gap lives on
`styles.capped`, which is applied only when a maxWidth is set, so on a phone
every child is flush unless it carries its own margin. That is why the controls
sat nine pixels under the board dropdown. Fixed locally here rather than in
`Screen`, which would change every screen at once.

Four bugs the checks caught that reading the code would not have: every axis
label rendered as "2…" because react-native-web sizes `Text` inline and ignored
its width; a label sliced by the scroll edge turned "13 Jul" into "3 Jul", a
wrong date rather than a missing one; and the first truncation test passed while
the UI was visibly broken, because it searched `textContent` for an ellipsis that
only exists in pixels.

Backfill: `scripts/backfill-stats.mjs` rebuilds history from cards, comments,
attachments and the activity log. Dry-run by default, writes only under
`stats/**`, never touches today, and refuses to write if its reconstruction
disagrees with a direct count. Dry run against production reconciles (96 cards,
49 comments).

The 45-card day on 2026-07-25 was first taken for an import spike and captioned
as one on the screen. It is not: no `sourceId`, 45 distinct `createdAt` instants
across nine hours, three different people — a busy day, not a bulk write. The
real imports are 19 cards over six days. The caption was removed; it would have
told the team to discount their best day.

### 2026-07-28 — Subscribe to a card's comments — v0.4.0

You could only hear about a card's comments if it was assigned to you. Someone
who cares about a piece of work without owning it now gets a bell in the card
header, and the cards they follow under **My work → Subscribed**.

This narrows a recorded decision rather than overturning it. "No watchers" stays
true in the sense that mattered: a subscriber hears about **comments and nothing
else**. Notifying on every change was explored and dropped — `myCardMoved`
already ships off with the reason in the code ("on an active board this fires
constantly, and it is how notification fatigue starts"), and ten more triggers
beside it would be worse. Assignees are untouched.

**Subscribing grants READ, and that is the whole of the risk.** Putting a
Subscribed list in My Work forces it: the query is only legal because the read
rule can prove it is constrained to the caller, so it needs a subscriber arm
beside the assignee one. Four consequences follow, each mirroring `assigneeUids`:
subscribers must be board members (rules-enforced); `removeBoardMember` clears
them, or someone taken off a board keeps reading its cards; a cross-board move
drops those who are not members of the destination; and a copy carries none,
since a copy has no comments to have subscribed to.

Three mutations, each red on exactly one test: dropping the membership
constraint, dropping the assignee exclusion from the notification, and skipping
the clear on member removal.

`removeBoardMember` now pairs `boardId ==` with `subscriberUids array-contains`,
which is an equality plus an array-contains — **not** servable by automatic
indexes. The composite is in `firestore.indexes.json` beside the assignee one it
mirrors, with probes for it and for the My Work query, so a missing index cannot
be discovered in production the way the attachment sweep once was.

Smaller things worth recording. Subscribing writes `updatedBy` because the rules
pin it, but deliberately leaves `updatedAt` alone: `diffCard` ignores
`subscriberUids`, so no activity entry appears, no notification fires, and the
card does not jump to the top of Search's newest-first browse order. Following a
conversation should not look like doing work on it. And the notification order is
mention → assignee → subscriber with each group excluding the ones above, so
caring about a card in three ways still sends exactly one notification.

The `NOTIFY_EVENTS.length <= 6` guard — "every addition is a tax on attention" —
was raised to 7 with the justification written into the test, which is the point
of having the guard at all.

Three review passes over the change found five more things, two of which would
have shipped as real defects.

**The bell could silently do nothing.** Precedence was mention → assignee →
subscriber, so someone who had turned off "a comment on a card assigned to you"
and then deliberately subscribed to one card got NOTHING: the assignee branch
claimed them, and their preference dropped it. Subscription now outranks
assignment, because a per-card choice made by hand should beat a blanket
default, and the message text is identical either way so nothing else can tell.
Reverting the order turns exactly one test red.

**A failure in the Subscribed query took down the whole screen.** My Work is the
phone's landing surface; a secondary list must not cost you the primary one. The
error is now fatal only for the list being viewed, and a chip whose query failed
shows "?" rather than a count — reporting 0 for a query that errored is the same
"not loaded is not empty" lie that has bitten this codebase twice already.

Also: the e2e's "absent from Assigned" check sampled without a positive control
first, so it would have passed even if the list had rendered nothing at all;
`useMyWork`'s docstring — the one explaining why the query is legal — ended up
orphaned above the extracted mapper; and the brief's index list still claimed My
Work needed a single index.

One hypothesis was disproved by measuring rather than reasoning: removeBoardMember
issues TWO `batch.update` calls on the same card when someone is both assigned
and subscribed. Firestore applies both field masks rather than throwing or
clobbering — verified with a throwaway emulator probe rather than assumed.

Verified: 306 + 27 unit, 185 rules, 80 functions, web 77/77, attachments 17/17.
On the AVD: the bell fills raspberry when subscribed, and My work shows
"Assigned (0) / Subscribed (1)" with the same due-date grouping.

### 2026-07-27 — Four decided review items, and a nightly flake — v0.3.4

The four items from the v0.3.3 review that were held for a decision.

**The mention popover now closes when you look away.** A draft left ending in
`@sa` kept it on screen indefinitely. The close is DEFERRED by 200ms and that is
the whole design: a click fires mousedown → blur → click, so closing immediately
destroys the row being clicked and the pick silently never happens. Proven by
mutation — removing the grace period turns "picking a mention keeps focus in the
comment box" red and nothing else.

**Completing a mention can no longer overflow the comment cap.** `maxLength`
caps typing but says nothing about a value set in code, so a comment at 5000
characters ending in `@sa` posted at 5003 and failed with a bare
permission-denied. `completeMention` truncates. Truncation can land inside the
handle, leaving a mention that resolves to nobody — accepted, and it needs a
comment within a few characters of the cap to reach.

**Deleting a label counts live and archived cards separately.** "On 3 cards"
reads very differently when two of them are in the archive. Done with one
`select('archived')` read partitioned in memory rather than two `count()`
queries: `labelIds array-contains` plus `archived ==` needs a COMPOSITE index —
this project already carries one of that shape for `removeBoardMember` — and a
missing composite fails only in production, which is how the attachment sweep
broke once already.

**Search can filter by label.** A dropdown offering only labels not yet picked,
one removable chip per pick. `CardFilters.labelId` becomes `labelIds`, matching
**any** of them: requiring all would empty the list on the second pick, since few
cards carry two specific labels. That widening does not repeat the `archivedOnly`
trap, which merged live and archived cards into one result — widening inside one
facet still narrows against no filter.

**And a real flake, found by refusing to accept "flake".** "My Work groups by
due state" failed twice and passed once on identical code. The e2e sets the due
date using a timezone written out as `America/New_York` — with a comment
explaining the evening rollover it was written to fix — and it was never updated
when `ORG_TIMEZONE` moved to Chicago. Between 23:00 and midnight Central it
writes tomorrow's date, the card groups under "Next 7 days", and the assertion
cannot pass. Measured at 23:07: the script wrote 2026-07-28 while the app's today
was 2026-07-27. It now calls the app's own `todayInOrgTz`, so the two cannot
drift again. Restating a constant was the same mistake one level up from the one
the comment describes.

Verified: 304 + 27 unit, 180 rules, 74 functions, web 73/73 (up from 68),
attachments 17/17.

### 2026-07-27 — Review of v0.2.5–v0.3.2: fourteen fixes — v0.3.3

A second, harder review pass over everything since the attachment badge. The
ones worth recording, roughly by how much they could bite:

**Rank collision when a card opened faster than its board.** `CardScreen`
renders as soon as the card and board arrive, but two controls — the Column
dropdown and subtask creation — compute a rank from `boardCards.data ?? []`.
An unloaded list is indistinguishable from an empty column, so
`rankBetween(null, null)` returned the fixed FIRST rank: the card jumped to the
top of a column it should have joined the end of, and collided with whatever
already held that rank. Both controls now wait on `boardCards.status`. Pre-
existing, and the same "not loaded is not empty" shape as the label bug fixed in
v0.3.1.

**Typing `@o` narrowed nothing.** `mentionSuggestions` matched the whole email
address, and every account is `@oursabeel.com` — so `o, u, r, s, a, b, e, l, c,
m` each matched every account there is. Matching the handle (which IS the local
part) and the display name loses nothing and makes narrowing work. The cap of 5
had been hiding it.

**No preference for matches at the start.** `@s` put Faisal above Sara, because
"fai-s-al" matches and F sorts first. Start-matches now rank above middle-
matches inside each priority group; both are still offered, because surnames are
a real way to search.

**The suggestion scroll drifted.** Rows are 60px tall with a 4px gap, but
`scrollTo` jumped by 60 — a gap per row, so by row twelve the target was most of
a row out. One derived `ROW_PITCH` now feeds the row, the scroll and the height
cap.

**Rows were a fixed height.** At the largest accessibility font size two lines
no longer fit in 60px and the name clipped. The height is a minimum now and the
real pitch is measured from the first row, which is correct at any scale.

**Held arrow keys dropped steps.** Key repeat is ~33ms and React renders in
~16ms, so two moves landed against one state value. A ref beside the state, the
same fix the attachment row already carries.

**Narrowing left the list scrolled past the end.** It stays mounted while you
type, so going from ten matches to two showed blank space. It scrolls back to
the top with the highlight.

**`labels` was not in the data-loss canary.** Every other top-level collection
is watched; a new one was not. Added with a deliberately tolerant drop rule —
the set is meant to be curated, so pruning must not page anyone.

**The migration copied without validating.** A name over the cap or a colour
that is not a hex would create a label no manager could ever rename, because the
update rule validates the whole document. Production was clean; this matters for
the re-run after a restore, which is now documented in DEPLOY.md — it was in no
document at all.

Plus: `sweepLabelFromCards` was exported and never imported (same dead-export
shape as `isLabelColor` in v0.3.1); a rules comment claimed the UI credits a
label's `createdBy` when nothing displays it; the popover header used `Caption`,
which is `text.muted` at 2.34:1 on that background — `Hint` is `text.secondary`
at 5.10:1; and the web e2e would have thrown rather than failed cleanly if a
board ever had fewer than two people to mention, losing the forty checks after
it.

Verified: 294 + 27 unit, 180 rules, 72 functions, web 68/68, attachments 17/17.

### 2026-07-27 — The @mention list is reachable — v0.3.2

Reported: typing `@` in a comment shows only a handful of people and, unlike the
assignee picker, cannot be scrolled. Two causes, and reproducing on a device
first is what found the second and larger one.

`mentionSuggestions` was hard-capped at **5**. The two biggest boards carry all
13 accounts, so eight people were unreachable unless you guessed enough of a
prefix — a silent cap with nothing on screen to hint at it. The limit is gone;
the list scrolls instead.

**On Android the feature was not merely limited, it was invisible.** The
before-screenshot is unambiguous: type `@` with the keyboard up and the word
"Mention" is the last thing above the keyboard. Not one row. The Comment button
gone too. The list rendered between the field and that button, and `Screen`
scrolls a focused input clear of the keyboard by `KEYBOARD_BOTTOM_OFFSET` = 96px
— sized for a field plus one action row — so a 280px list in that gap is simply
behind the keyboard.

Moving it inline ABOVE the field fixed that and broke the mirror image: the
keyboard-aware scroller positions the field when it takes focus, and inserting
240px above it afterwards pushes the field down without another scroll. The list
was visible and the box being typed into was not. Only the third attempt — an
absolutely-positioned popover, out of layout entirely — holds both: the field
never moves, and the list floats over the card content. Each of those three
states was screenshotted on the AVD; none of it was visible from the code.

Also: people already assigned to the card float to the top, which on an
organisation this size usually means no scrolling at all; rows are compact
name-over-handle instead of full-width buttons; the handle is shown because it
is what actually gets typed; and on web ↑/↓/Enter/Tab/Escape work, through a
`mentionKeys` platform pair rather than a duplicate component.

Proven by mutation: dropping the priority ordering, re-adding the cap of 5, and
disabling ArrowDown each turn exactly one check red — the last one picking
`@faisal` instead of `@sara`, which is precisely what the check exists to catch.

The old e2e selector matched `Name (@handle)` and sat inside an
`if (isVisible)`, so relabelling the rows would have silently skipped the test
rather than failing it. The guard is gone and the selector is current.

**Not covered by any test:** `keyboardShouldPersistTaps="handled"` on the
suggestion list. Web has no soft keyboard, so no e2e can catch its removal —
without it the first tap only dismisses the keyboard and the row looks dead. It
was verified by tapping a name on the AVD with the keyboard up, and that is the
only thing that verifies it.

### 2026-07-27 — Three fixes from reviewing the label release — v0.3.1

A structured review of v0.2.5–v0.3.0 turned up nine things; three were worth
acting on. The other six are recorded in the review itself: two accepted
residuals (no cap on the label collection; label names now readable by any
active account rather than only board members), a first-load layout shift on
tiles whose only meta is labels, opens being unavailable during an upload
because `useAction` is single-slot, and a migration that does not validate the
names it copies.

**The duplicate check ran against an empty list while labels were loading.**
All three call sites read `labels.data ?? []`, and `useLiveQuery` reports
`data: undefined` for BOTH `loading` and `error` — so the fallback turned "not
known yet" into "there are no labels", and `validateLabelName` waved every
duplicate through. The error case is the sharp one: it is not a window, it
persists, and the picker shows no chips either, so nobody can see what they are
duplicating. The controls now stay disabled until the list is genuinely known.

**The sweep-before-delete ordering had no test at all.** It is stated in the
code, in the v0.3.0 entry and in that commit message as load-bearing — and
reversing the two lines left all 251 tests green, because on the happy path both
orders end identically. `applyDeleteLabel` is now extracted with an injectable
sweep, which is the only way to observe the property: the new test passes a
sweep that throws and asserts the label survives. Reversing the order now turns
that one test red and nothing else.

**`isLabelColor` was dead.** Exported, unit-tested, zero call sites — the plan
had the callable using it and nothing ever did. The test made it look covered.
Both are gone.

Also confirmed, because they were the frightening ones: the delete sweep does
NOT fire notifications (`onCardNotify` only reacts to assignee and column
changes) and does not disturb board card counts (`onCardBoardCount` returns
early when the active board is unchanged). Firestore rules `String.size()`
counts CODE POINTS — probed directly, 20 emoji accepted and 41 ASCII refused —
so the client's 40-UTF-16-unit cap is strictly the stricter of the two and can
never hand the rules a name they reject. And all 32 migrated labels audited
clean in production: in-palette colours, valid hex, exactly four fields, longest
name 24 bytes.

### 2026-07-27 — Labels became org-wide — v0.3.0

Labels lived on the board document, so the same idea had to be re-created on
every board that wanted it, a cross-board move **stripped every label off the
card**, and My Work and Search — both cross-board — resolved chips against one
loaded board and therefore rendered none for cards from anywhere else. They are
now a single `labels/{labelId}` collection the whole organisation shares.

Reading production first is what made the migration small. Of 17 boards only
**three** carried labels at all (21, 10 and 1), **no two boards used the same
name**, and every embedded `lbl_*` id was already globally unique. So this is a
union, not a merge — and each existing id becomes its global document id, which
means **no card is rewritten**. The 10 label references in the system keep
resolving before, during and after.

Split in two so nothing is ever missing: part A creates the documents and is
invisible to the running app (old clients still read `boards.labels`); part B
strips the now-dead field once the new client is live. Both abort rather than
guess — part A on a duplicate id, part B if any label was never copied — and
both aborts were fired deliberately on the emulator.

A COLLECTION rather than an array on a config document, for two reasons. Any
active member may add a label, so concurrent creates are the ordinary case and
two people appending to one array is a lost write. And rules cannot iterate a
list, which is why `LABEL_NAME_MAX` was client-side only while labels lived on
the board; one document per label makes the name cap, the colour shape and the
author rules-enforceable for the first time.

The permission split is deliberate and asymmetric: **create is open to any
active member**, because coining a tag is cheap and happens while looking at a
card, and Board Settings — where labels are curated — is manager-only, so
requiring a manager is exactly the friction that made per-board labels get
re-created everywhere. **Rename, recolour and delete stay with managers**,
because those change what everyone else already sees. Members reach the one
affordance they need through a `+` in the card's label picker, which creates the
label and applies it in a single step.

Deleting is a callable, like attachment deletion and for the same reasons: it
must strip the id from every card across boards the deleter may not be on, and a
delete trigger cannot name who did it. Cards are swept **first** and the
document removed **last** — reversed, a failure between the two steps would
leave cards holding an id with nothing left to find them by. No activity entry
is written by hand: setting `updatedBy` lets `onCardWritten` see the `labelIds`
diff and log it against the manager, the same mechanism `removeBoardMember`
uses.

Five rules mutations, each red on exactly one test: opening create to managers
only (7 failures), widening update to any member, allowing a client delete,
replacing the `.get(field, default)` old-doc guard with plain access — which
would brick every migrated label, since they have no author to name — and
restoring `labels` to the board key allow-list. A sixth mutation emptied the
card's label picker and turned all four end-to-end label checks red.

One of those checks earns its place: a **second board, whose settings are never
opened**, must offer the labels made on the first. That is the entire claim of
the feature, and nothing else proves it.

Found on the way: `test:integration:rules` and `test:integration:fn` list their
files explicitly, so both new label suites were **silently not running** — the
totals looked unchanged because they were unchanged. `functions/test/unit/
suite-coverage.test.ts` now fails if any file in `test/integration` is absent
from either pass, and was itself mutation-checked.

### 2026-07-27 — Opening a file says so, and cannot be started twice — v0.2.6

A member tapped an attachment on Android and was shown *"Call to function
'ExpoSharing.shareAsync' has been rejected. → Caused by: Another share request
is being processed now."* (Sentry, `e8d534ed`, 0.2.4+2004, Android 14).

The native message is the symptom; the defect is that **opening gave no feedback
and stayed tappable while it worked**. Native mints a signed URL through a
callable and then downloads the entire file — up to 10 MB over a phone
connection — before any viewer appears. Nothing about the row changed for the
whole of that. Tapping again was the reasonable thing to do.

The duplicate then hit `expo-sharing`, which keeps exactly ONE pending promise:
it is set before the chooser starts and cleared only when the activity result
comes back (`SharingModule.kt`), so anything arriving in between is rejected
outright. That rejection went to the user verbatim, through `toUserMessage`,
which returns `e.message` as-is.

Three changes:

- **The row says "Opening…"** and swaps its file glyph for a spinner in a
  fixed-size box, so the name does not shift. This is the actual fix — the
  silence is what produced the second tap.
- **The row now consults `busy`**, which it never did. Every other control in
  the panel already did, so an open was the one action that stayed live while
  another was running.
- **A synchronous ref gate** (`beginOpen`/`endOpen`) alongside it, because
  `busy` and the opening row are both React state: two taps inside one frame
  read the value from before the first and both start.

Plus: `openAttachment.ts` now maps the native rejection to a sentence, matched on
the CODE `ERR_SHARING_IN_PROGRESS` — which expo derives from the exception class
name — rather than its English text. With the gate in place, reaching it means
the native slot is genuinely occupied (a chooser still up, or one that went away
without delivering a result and left the slot stuck).

Verified by mutation, and the first two attempts are the point. Removing the ref
gate alone left the suite green; removing `busy` alone left it green too — each
guard covers this scenario by itself. Only restoring **both** to the shipped
v0.2.4 shape turned it red, at **2 tabs opened instead of 1**. A single-guard
mutation would have "passed" and told me nothing.

The e2e also had to stop closing the popup on arrival: the open path checks
`tab.closed` and falls back to navigating the current page, so closing it early
sent the app itself to the signed URL and broke every later check.

### 2026-07-27 — A board tile shows when a card has files — v0.2.5

A card with attachments now carries a paperclip and a count on the board, in the
same muted chip as the subtask and due-date markers.

It could not be a UI-only change. The board fetches card DOCUMENTS and
attachments are a subcollection, so a badge would have meant one subcollection
query per tile on every render. Instead the card carries `attachmentCount`,
denormalised exactly as `commentCount` and a board's `activeCardCount` are —
moved by the attachment callables in the same guarded branch that writes the
activity entry, so it cannot double-count or disagree with the log.

It counts READY files only. A half-finished upload is not a file anyone can
open, and a badge that appeared and then vanished when the nightly sweep ran
would be worse than no badge.

Two things the rules had to get right, both proven by reverting them:

- The count is **pinned across a client update**, like `activeCardCount`, so a
  member cannot edit a card and claim five files. Removing the pin turns the
  test red.
- The pin uses **`.get('attachmentCount', 0)` on BOTH sides**. With plain field
  access, every card written before the field existed becomes permanently
  uneditable — the exact trap the board's own pin already carries a comment
  about. Reverting to plain access turns that test red too.

Production already held 3 attachment documents on one card from testing, so the
count would have started wrong. `scripts/backfill-attachment-count.mjs`
recomputes it from the attachments that exist — counting ready ones only, and
idempotent, so it is safe to re-run. Proven against the emulator first, on a card
deliberately missing the field: 2 ready counted, 1 uploading excluded, and a
second run reported "Updated 0, already correct 1".

### 2026-07-27 — Android 13 floor, and the e2e is green again — v0.2.4

**Android 12 and older are no longer supported.** `minSdkVersion` is 33, set
explicitly in `app/android/app/build.gradle` rather than inherited from Expo's
default of 24, because it is a product decision and not a scaffold detail.
Android 13 is where the system photo picker arrives, so picking a photo needs no
storage permission at all — which is what lets BOTH external-storage permissions
be removed outright instead of carried as dead weight for a path no device we
support can take. Verified on the built APK: `minSdkVersion:'33'`, and neither
READ_ nor WRITE_EXTERNAL_STORAGE appears in its badging.

**`web-e2e.mjs` is green: 55 checks, up from 5.** Every failure was the same
rot — the suite was written before the navigation shell and the move to icon
actions, and nothing ran it. The remaining fixes:

- `backToBoards` walked backwards with Back, which cannot leave a TAB ROOT since
  My Work, Search and Alerts dropped their redundant Back. It uses the nav now
  and falls back to Back for pushed screens.
- `openCard` proved success by waiting for a "Card" heading CardScreen had
  deliberately removed, so it retried against a tile it had already navigated
  away from. It waits for Share card, a control unique to that screen.
- Column deletion became a two-step inline confirm; the test only clicked the ✕.
- The assignee control is "Unassign <person>", not "Remove".
- Search's empty state is "Nothing to show", and Archived is a filter chip whose
  accessible name carries its state ("Archived filter, off"), which the test now
  asserts rather than assumes.
- My Work has no Back at all; the journey to Alerts is one nav click.

**Both e2e suites now run in CI.** CI ran lint, typecheck, unit and emulator
tests and no e2e whatsoever, which is the whole reason a suite could rot from
usable to useless without a single red build. They cost minutes and they are
worth it.

### 2026-07-27 — Structured review, eleven categories — v0.2.3

The third pass, and the first that was actually systematic. The previous two
were opportunistic — chase a finding, fix it, move on — and were recorded as
multi-pass work they were not, which is why each turned up four defects. This
one fixed a category list (rules, callables, triggers, shared logic, client data,
client UI, platform seams, native config, infra, tooling, docs) and ran three
defined lenses over each: correctness, adversarial, and empirical proof. No cell
closed without named evidence.

Eleven findings. Severities: S1 cost/access, S2 wrong data, S3 broken UX, S4 cruft.

- **S1 — `uploadedAt` was unbounded.** The nightly sweep decides what to clean up
  by age, so a document claiming to be from the year 3000 was never swept and its
  bytes were billed forever. Now bounded to one hour past the SERVER's clock —
  an hour, not minutes, because the sweep cutoff is 24h and a tight bound would
  refuse a real person whose device clock is merely wrong.
- **S1 — the sweep SKIPPED documents it could not age.** A row with a missing or
  non-numeric timestamp was left alone forever, which is the opposite of what a
  cleanup should do with a record stuck in `uploading`. Now swept.
- **S2 — the native cache was keyed by display name.** Two files on one card may
  share a name — two camera photos in the same minute generate the same one —
  so the second download overwrote the first and opening the first showed the
  SECOND file's contents. Keyed by attachment id, with the naming moved to
  `@sabeel/shared` so it can be tested at all.
- **S3 — the progress bar was invisible.** `bg.accentSoft` on `bg.inset` is
  1.13:1, so the only feedback during an upload showed nothing while working
  perfectly. Accent fill at 7.25:1 with the label moved off the bar, and
  captured mid-upload to prove it.
- **S3 — `tab.opener = null` could throw** in some browsers and take the
  navigation down with it, so the file would not open at all. Its own try/catch.
- **S3 — the seed's label loop clicked a disabled button**, so every seeded board
  had `urgent` and never `donor-facing`, warned, and carried on.
- **S3 — web-e2e had rotted from check 5 to unusable.** Column deletion became a
  two-step confirm; `openCard` waited for a "Card" heading CardScreen had
  deliberately removed, so it retried against a tile it had navigated away from;
  the assignee control is "Unassign <person>", not "Remove". Now reaches 40
  checks. It is NOT green — finishing it is a follow-up.
- **S4 — client did not normalise contentType**, so the row's icon changed the
  instant the server rewrote it. Same class as the filename fix in v0.2.2.
- **S4 — the AndroidManifest comment claimed "only INTERNET and VIBRATE."** The
  MERGED manifest carries CAMERA and READ_EXTERNAL_STORAGE from libraries, so
  the comment invited exactly the wrong conclusion.
- **S4 — `health.ts` DROP_RULES omitted attachments.** The default was right, but
  every other collection is listed, so silence read as oversight.
- **S4 — the v0.2.1 extraction left cruft**: a vestigial bare block and a
  redundant `uid` alias, compile-clean and meaningless.

Verified rather than assumed: both rule files mutation-tested; the timestamp
bound, the sweep fix and both concurrency guards each shown red against broken
code; seam parity checked mechanically across all six `.ts`/`.web.ts` pairs; the
progress bar captured mid-upload; a PDF and an image opened on the AVD in Drive's
`PdfViewerActivity` and Photos' `HostPhotoPagerActivity` AFTER the seam change;
227 production activity documents confirmed to carry no type this build cannot
describe; the release APK's badging read directly (versionCode 2003, no
WRITE_EXTERNAL_STORAGE).

Also this pass: the five relic indexes from the pre-2026-07-21 data model were
deleted one at a time with a probe between each, so `firestore.indexes.json` now
describes the project exactly and `--force` is a safe no-op rather than an armed
footgun. And **CI now runs the attachments e2e** — it ran no e2e at all, which is
precisely why web-e2e rotted for weeks without anyone noticing.

### 2026-07-27 — Second review pass — v0.2.2

A second multi-pass review, run on the same worry: things had been shipping and
then being found wrong. Four more defects, in areas the first pass had not
reached.

- **The client never sanitised the filename.** `constants.ts` says the shared
  caps exist so a normal action never fails with a raw `permission-denied`, and
  this was the one place that ignored it: a picker can return a name longer than
  the rules allow. The row also silently RENAMED itself the moment the upload
  finished, because only the server was sanitising.
- **`sanitizeAttachmentName` destroyed the extension.** It truncated with a
  plain `slice`, so a long name lost its `.pdf` — and the extension is what the
  row shows as the kind and what viewers sniff. It now shortens the stem and
  keeps the suffix. Caught by an e2e that uploaded a 300-character name.
- **`normalizeContentType` let CRLF through.** It only checked for a slash, so
  `application/pdf\r\nX-Injected: 1` was stored verbatim as the object's
  `Content-Type` — a response-header-injection shape on a client-controlled
  field. It now matches RFC 6838's token grammar and discards anything else.
- **The dev seed had been producing a one-person board for weeks.** Its approve
  loop waited for the word "People", which is both the nav item and the screen
  heading, so it proceeded before the queue had loaded, found no Approve button
  and exited having approved nobody. Every seeded run left two PENDING accounts,
  and every manual figure and local hand-test since has been of an
  unrepresentative board. Fixed by waiting for the queue itself; membership went
  1 → 3 and the manual figures were regenerated.

Also cleaned: the extraction of `applyFinalizeAttachment` /
`applyDeleteAttachment` in v0.2.1 was done by script and left a vestigial bare
block and a `const uid = actorUid` alias behind — compile-clean, but cruft.

### 2026-07-27 — Review of the attachments release — v0.2.1

A deliberate multi-pass review of v0.2.0, run because two defects had
already escaped to production and both escaped the same way: **the emulator
answered a question production would have refused.** Four defects found, all
reproduced before being fixed.

- **`attached` named the wrong person.** The activity entry took its actor from
  whoever called `finalizeAttachment`, not from `uploadedBy`. Normally the same
  person; wrong exactly when it is not. Proven with a manager confirming a
  member's upload.
- **Concurrent `finalizeAttachment` logged the file twice**, and concurrent
  `deleteAttachment` logged the removal twice. Both were read-then-write across
  two round-trips. Both now do the state transition in a transaction, and only
  the caller whose transaction made the change writes the entry.
- **The card-delete object sweep failed silently.** Its catch only wrote a
  `logger.warn`, and nothing else will ever find those bytes — the nightly sweep
  looks at documents, which `recursiveDelete` has just removed. It now reports
  to Sentry: a permanent billable leak must not depend on someone reading a log.

**The most important finding was about the tests, not the code.** The first race
tests reproduced the bug once and then passed against code that was still
broken. The functions emulator serialises concurrent calls to a WARM instance,
so a race driven through a callable stops racing as soon as an earlier test has
warmed it. The effects are now extracted from their callables
(`applyFinalizeAttachment`, `applyDeleteAttachment` — the same split
`runNotificationSweep` uses) and the races run in-process, where two promises
genuinely interleave. Verified by reverting the transactions: red on 3 of 3 runs.

Also settled by measurement rather than assumption, against the real project:
V4 signing genuinely works (the runtime service account signed a probe object
and the URL served it — the one thing no local test can prove); all 7 index
probes pass, including the health canary's new collection-group count; the
`SAFE_ID` guard on callable input accepts all 80 production card ids and 16
board ids; the nightly `pruneAttachments` schedule is ENABLED; cards on archived
boards stay editable, so attachments are consistent with existing card rules.

Two residuals recorded rather than fixed, in CLAUDE.md: a signed URL already
issued keeps working for up to an hour after someone loses board access, and
there is no cap on how many files one card may hold.

### 2026-07-27 — Files on a card — v0.2.0

**Attachments, reversing the 2026-07-19 decision not to have them.** Several
files per card, 10 MB each, any type, opened in whatever the system reader for
that type is. Any active board member may remove one — deliberately not the
manager-only gate permanent card deletion uses.

Backend provisioned 2026-07-26: `firebasestorage.googleapis.com`, bucket
`sabeel-institute-kanban.firebasestorage.app` in us-central1 (permanent choice,
one of the three regions with no-cost quotas), and
`roles/iam.serviceAccountTokenCreator` self-bound on the gen-2 runtime service
account.

**Everything about the design follows from one constraint: Storage rules cannot
read Firestore.** Board membership is a Firestore document, so `storage.rules`
can only ask "is this an active account". So the attachment DOCUMENT is the
upload's authorization — creating it is membership-checked, and the object goes
to a path derived from ids only that create could have produced. Objects are
write-once and unreadable; every download is a 1-hour V4 signed URL minted by a
callable that repeats the check. `getDownloadURL()` is refused outright: its
token never expires, so anyone who saw a link would keep access after leaving a
board.

Things that were got wrong first, and are worth not repeating:

- **A client cannot roll back its own failed upload.** In Storage rules `write`
  covers delete, and `resource == null` is false on one, so the planned
  client-side rollback would have deleted the record and stranded the bytes:
  unreferenced, unreadable, invisible, billable. Rollback goes through
  `deleteAttachment`, and a daily sweep catches uploads abandoned by a closed
  tab.
- **A retry must mint a NEW attachment id.** Write-once refuses a second write
  to the same path, which would surface as an alarming permission error on an
  ordinary retry.
- **How a file is served is stored on the OBJECT**, not passed as a signed-URL
  query override. Overrides are honoured only by real GCS, so inline-vs-download
  and filename handling would have been exercised by no local test at all.
  HTML and SVG normalise to octet-stream — served inline from a
  googleapis.com origin they would run script on Google's origin.
- **The functions emulator mints URLs against `127.0.0.1`**, which on an Android
  emulator is the device. Opening a file died with "Failed to connect to
  /127.0.0.1:9199" — pure addressing, but it reads as a broken feature. Rewritten
  to the reachable host, gated on emulator mode, because a production URL is
  signed over its host.
- **A rules test that passed alone and failed in the suite.** `clearStorage()`
  returns before the emulator finishes deleting, so a deletion issued in
  `beforeEach` landed mid-test and removed the object a write-once assertion
  depended on — making a second upload look permitted. Per-test object ids.
- **Photo names from a picker are meaningless.** The gallery reports a MediaStore
  id and the camera a bare UUID, so a card with three photos listed three
  identifiers nobody could tell apart. Both shapes are replaced with
  `photo-2026-07-27-1432.jpg`.

Android needed two manifest entries no library supplies: a `<queries>` entry for
VIEW with `mimeType */*` (on API 30+ package visibility hides every handler and
the tap silently does nothing), and `tools:node="remove"` on
WRITE_EXTERNAL_STORAGE. READ_EXTERNAL_STORAGE is deliberately left alone —
expo-image-picker declares it for the camera roll on API ≤ 32, minSdk here is 24,
and an API-35 AVD cannot test that path either way.

Verified: 304 unit, 215 emulator (including storage rules, mutation-tested — 17
denials go red when both rule files are opened), a 10-check web suite driving a
real upload, and the Android emulator driven by hand — the PDF opened in Drive's
`PdfViewerActivity`, the PNG in Photos' `HostPhotoPagerActivity`.

**Not verifiable before deploy:** V4 signing. The Storage emulator has no signing
service, so that branch is unexercised locally and the
`serviceAccountTokenCreator` grant fails only in production.

Also fixed in passing: `web-e2e.mjs` had rotted since the navigation shell and
the switch to icon actions, aborting at check 5 — six stale selectors repaired,
now reaching check 26. One of them, "a member does NOT get admin tools", was
probing a top-level People button that exists for nobody, so it had been passing
without testing anything. CI does not run the e2e, which is why nobody noticed.

### 2026-07-26 — The org timezone was an hour out — v0.1.34

**`ORG_TIMEZONE` was `America/New_York` for a Houston team.** Now
`America/Chicago`. It survived this long because nothing about it looked like a
bug: due dates are all-day `YYYY-MM-DD` strings, so the only symptoms were a card
turning overdue an hour early — at 11pm the night before — and the due-soon
reminder arriving at 07:00 local instead of 08:00. The weekly prune and the daily
reminder are both scheduled in this zone, so both move with it.

The test suite could not have caught it. It asserted
`todayInOrgTz('2026-07-19T02:00:00Z') === '2026-07-18'`, and 02:00Z is the
previous day in Chicago *and* in New York — the assertion was true under the
wrong configuration, so it could never fail. The test now pins an instant that
differs (04:30Z on 19 July is the 18th in Chicago and already the 19th in New
York), which means moving the constant back fails rather than passing quietly.
Worth generalising: a test whose expected value would not CHANGE if the constant
were wrong is decorative.

There is nothing to align with the sibling time-tracker, and `CLAUDE.md` now says
so explicitly, because the obvious future instinct — make the siblings match —
would be wrong. That project has no org timezone by design; it buckets each entry
in the timezone where the work happened.

Also from the sibling maintainer's review of `docs/VERSIONING-RULE.md`: the
version shape check `^\d+\.\d+\.\d+$` accepts `2026.07.01`. Apple accepts it
too — digits and periods — but `07` and `7` are the same number, so a date-style
scheme silently stops increasing and every numeric derivation downstream reads 7
where a human reads 07. Now `^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$` in
both `check-version.mjs` and `build.gradle`, and the validator **self-tests on
every run** against seven bad shapes including that one — the hole existed
precisely because the regex had never been pointed at a date.

**The download page carries a published date and time.** The public URL is a
rolling asset, so the page and the link are byte-identical before and after a
publish; without a timestamp nobody, us included, can tell whether the file
behind the button is the build just cut or last month's. `publish-apk.sh` writes
both labels and greps them back, failing rather than trusting `sed`, and the
timestamp is pinned to the org zone rather than the build machine's. See
`docs/DEPLOY.md` step 4.

**The Sentry cron canary had been reporting missed every day.** `healthCheck`
carried its own hardcoded `America/New_York` — a second copy of the org zone,
which silently did not move when the real one did, at which point its comment
("well clear of the 08:00 run") was reasoning across two clocks. Worse, the
monitor was upserted with **no timezone at all**, and Sentry defaults that to
UTC: it expected a check-in at 03:15 UTC while the job ran at 07:15 UTC, four
hours outside the 60-minute margin. A canary that cries wolf daily is worse than
none, because you stop reading it. The monitor now sends its timezone, and
`HEALTH_TIMEZONE` is `ORG_TIMEZONE` rather than a duplicate.

**Cross-project cleanup, from the time-tracker maintainer's review.** Both repos
are confirmed aligned on versioning (their `49c447f`): same no-leading-zeros
shape, same `versionCode` formula, same pinned `TZ=America/Chicago` page
timestamp. Two asks, both done — a stale comment here claiming their page used a
bare `date` (it is pinned now), and `docs/VERSIONING-RULE.md`, which had grown a
full second copy of the general rule that now lives in the `expo-firebase-stack`
skill. It is a pointer plus the project-specific facts, same shape as
`docs/STACK-GOTCHAS.md`. The shared skill itself had grown THREE overlapping
versioning entries; consolidated to one.

Their mutation technique, applied here: `ORG_TIMEZONE` was flipped back to
`America/New_York` to confirm the new test actually goes red. It does, and it is
the only one that does. Also swept the unit suites under UTC, Pacific/Kiritimati
(+14), Pacific/Midway (-11) and Asia/Kolkata — all clean, so nothing silently
depends on the build machine's zone.

And their warning about the Gradle daemon is now guarded: `expo run:android`
leaves one resident on ~3.7 GB, this machine runs earlyoom with `java` and
`gradle` on its prefer list, and the emulator it kills mid-suite presents as
ECONNREFUSED — i.e. as a broken diff. `test-emulator.sh` stops the daemon before
starting emulators.

### 2026-07-26 — Mentions in edits, and two review findings — v0.1.33

**@mentions did not work when editing a comment.** Three faults stacked, only
the first visible. The edit box was a bare field while the composer had the
autocomplete inline — two boxes doing one job, one of which had quietly stopped;
both now use `MentionField`. Underneath, `editComment` never re-derived
`mentionUids`, so even typing the handle correctly did nothing, and an edit lied
in both directions: adding "@sara" recorded no mention, deleting one left her
listed as mentioned by a comment that no longer names her. And the notifier was
create-only, so a mention added by editing reached nobody. It watches writes now,
notifying whoever is NEWLY named — diffing against the previous list is what
stops a typo fix from re-paging the thread — while `commentOnMyCard` stays
create-only, because an edit is not a new comment. `onCommentCreated` became
`onCommentNotify` to match `onCardNotify`.

That exposed a rules gap: `create` required every mentioned uid to be a board
member, `update` allowed the field and checked nothing. The invariant held for a
new comment and could be walked past by editing one. Proved the new test catches
it by removing the guard and watching it fail with "Expected request to fail, but
it succeeded".

**A title save destroyed an unsaved description.** Found by review, reproduced,
fixed. The card screen had ONE `dirty` flag guarding the effect that re-seeds
both editors from the server, but both editors can be open at once — so saving or
cancelling the title cleared the flag, re-armed the effect, and the next snapshot
overwrote a description someone was still typing. No error, nothing to undo.
Confirmed against the running app before ("LOST") and after ("SURVIVED"). One
flag per editor now, checked field by field.

**The live-data error banner outlived its session.** Module-level like the result
cache but not cleared with it, so signing out while "permission-denied" showed
left the next person on that device reading a refusal that was never theirs.

**Board `update` rules are now as strict as `create`.** An update rule laxer than
its create rule means the shape is only guaranteed for a document's first write,
which is not a guarantee — exactly the comment-mention trap in another place.
`createdAt` and `activeCardCount` are pinned (the latter is trigger-owned;
`onCardBoardCount` writes it via the Admin SDK, which bypasses rules), `archived`
must be a bool and `memberProfiles` a map. `.get(field, default)` on the pinned
fields, so a board written before one of them existed does not become
permanently uneditable.

**The notification inbox is pruned weekly, keeping 90 days.** Nothing had ever
deleted a notification: the client can dismiss what it sees, but Alerts lists
only the newest 50, so everything below that accumulated forever. Per user
rather than a collection-group query — there are tens of accounts, and a
collection-group query on `notifications` would need a collection-group-scoped
single-field index Firestore does not create automatically, which would fail at
runtime inside a scheduled job where nobody is watching. Pruned by age whether
read or not, because an unread entry below the 50-item line is already
unreachable and only leaves the badge counting something nobody can open. When a
sweep removes anything unread the badge is RECOMPUTED from the survivors rather
than decremented, which also repairs drift from any other path. The retention
figure lives in `@sabeel/shared` so the number the server enforces is the number
the settings screen quotes.

**Version numbering was two releases from a collision.** Raised while looking
ahead to an eventual iOS build. The reported blocker — that the App Store only
accepts X.Y.Z — turned out not to apply: Apple's rules (TN2420) are digits and
periods only, beginning and ending with a digit, at most three components, at
most 18 characters, strictly increasing; `0.1.33` satisfies all of them, and
starting at 0.x is fine because 0.1.33 < 1.0.0.

The real fault was next door. The Android versionCode was
`major*10000 + minor*100 + patch`, two digits per field, and **0.1.100 and 0.2.0
both computed to 200** — a collision, not a quirk: Android refuses an install
whose versionCode is not greater than the installed one. At the rate patches were
landing that was weeks away. Now `major*1000000 + minor*1000 + patch`, which only
ever produces larger codes than the old scheme (0.1.33: 133 → 1033), so
monotonicity survives the change; out-of-range components stop the build instead
of colliding silently. `scripts/check-version.mjs` enforces store legality from
`web:export` (so CI runs it) and from `publish-apk.sh`, the last gate before a
tag and a public download exist.

### 2026-07-26 — Notifications you can act on — v0.1.32

Started as "tapping a notification should open the thing it is about" and turned
into an audit of the whole notification path, which had four separate faults.

**Tapping did nothing, in two different ways.** In the Alerts list an
account-approval alert was inert, because those are written with an empty
`boardId` and the handler only knew how to open boards and cards. In the phone's
notification tray *nothing* was tappable — there was no response listener
anywhere in the app, so the `boardId` and `cardId` the server had been putting in
every payload were read by no one. `routeForNotification` is now the single
mapping both use: they arrive by completely different routes, a Firestore
document and an FCM data payload, and where they land is the one thing that must
never drift. `type` joined the payload because it is the only routing signal a
`newUserPending` carries.

`pushOpen.ts` mirrors `deeplink.ts` deliberately. An intent can arrive while the
app is running or BE the reason it started, those are two different APIs, and
skipping the second is how "it works when I test it" becomes "it does nothing
from a cold phone" — backgrounded is the case that works either way.
`takeInitialPush` uses the library's own `clearLastNotificationResponse` rather
than a hand-rolled consumed flag; that API exists for precisely this, and both
`…Async` forms are deprecated in SDK 57.

**The badge stayed up after acting on a push.** Tapping in Alerts marks the entry
read; tapping the same notification in the tray did not, because the payload
could not say which entry it was. The inbox id now travels with the push — which
means one message per device rather than a multicast, since
`sendEachForMulticast` sends one payload to every token and the payload now
differs per recipient.

**Every push landed in a channel called "Miscellaneous".** The app created a
channel named "Default" that nothing posted to, because the server never sent a
channel id; expo-notifications does not error on that, it logs and falls back to
its own channel. The id now lives in `@sabeel/shared`, since both sides must name
it and neither can check the other. It is a NEW id at HIGH importance — matching
what the fallback was already doing, so nothing goes quieter — because Android
fixes a channel's importance at creation and an app may never raise it, only the
person can. The dead channel is deleted rather than left as a second, silent
entry someone would try to configure.

**A rotated FCM token silently ended notifications.** Registration ran only at
sign-in, so when FCM rotated a token the stored one died, the server pruned it on
the next send, and that person stopped hearing anything until they happened to
sign out and back in. `addPushTokenListener` files the new one, and is removed on
sign-out first so a rotation mid-sign-out cannot re-file the token under the
account being detached.

Also: two labels can no longer differ only in case, matching columns. A card face
shows a label's name and nothing else, so "Urgent" beside "urgent" is a pair
nobody can tell apart.

Verified on the Android emulator with real notifications rather than by reading
the code: a tap routes to People; a card notification that ARRIVES WHILE THE
PROCESS IS DEAD opens the card on launch; `unreadNotifCount` goes 1 → 0 and
`read` false → true in Firestore across the tap; and `dumpsys` reports
`Notification(channel=sabeel-alerts)` at importance 4. Worth recording for next
time: `force-stop` cancels pending alarms *and* clears posted notifications, so
it cannot produce a cold start — `am kill` leaves both intact.

Known and left alone: the inbox is never pruned (a Firestore TTL policy is the
fix if it ever matters at this scale), and web push stays inert without a VAPID
key (TODO § I), so tray taps in a browser do nothing.

### 2026-07-26 — Text that escaped its row — v0.1.31

Reported from the Android app: a long column name printed on top of the pager's
"‹ Prev" button. One mechanism, three places, and a platform split that hid all
of them from the browser.

**Text will not shrink unless told to.** A `<Text numberOfLines={1}>` sharing a
flex row with a sibling is measured against the row's *full* inner width and then
laid out *beside* that sibling, so the row's content comes out wider than the
row. `numberOfLines` is no defence: the text still truncates with an ellipsis,
just at the wrong width, so the result looks deliberate. What happens to the
overrun is where the platforms part company — react-native-web gives a `View`
`overflow: hidden` and clips it, while native `View` is `overflow: visible` and
draws the text straight over its neighbour. Every browser screenshot said the
screen was fine.

`ColumnNameEditor` applied its shrink as `!center && styles.shrink`, so the
centred variant — used by exactly one surface, the phone pager — was the only one
that could not shrink. Shrink is now unconditional, and the pager asks for two
lines: it is the one place where the name *is* the row, with empty space above
and below to grow into. Auditing the rest of the codebase for the same shape
found it once more, in the card detail's board crumb, where a board name (120
characters are allowed) sits beside a 13px icon and would spill over the Share
and Back actions.

**Chips are the same bug turned inside out.** A label or assignee chip is a box
drawn *around* text, so it grows with the name and an over-long one draws wider
than the card it sits on; `flexWrap` cannot help, because wrapping moves an item
to the next line and never makes one narrower. The two halves need opposite
fixes. A label name is ours, so it is capped at the source: `LABEL_NAME_MAX` is
40 — labels were the one name in the app with no limit anywhere, while board
names, column names, card titles and comments all had one. Rules are *not* the
enforcement point and cannot be: rules have no way to iterate a list, so a
per-entry check on the embedded `labels` array is not expressible. An assignee's
name is the Google display name, external input with no in-app path to set it, so
that bound belongs at the render — a `maxWidth` plus the `flexShrink` that turns
it into an ellipsis instead of an overrun.

**The seed was the reason these reached Faisal first.** Every phone-layout bug
filmed so far needed either a name too long for its row or a column with more
cards than fit on a screen, and the dev seed had neither — six short cards in
tidy columns. It now creates both by default.

Verified on the Android emulator (where the bug was filmed) and on web at 390px
with measured geometry rather than eyeballing: the column name clears ‹ Prev by
8px, the crumb ends at x=270 against Share at x=278, and a full 40-character
label badge is 324px of the 337 available — which is what makes 40 the tight fit
rather than a guess.

### 2026-07-26 — Four bugs from a phone browser — v0.1.30

All four came from Faisal using the app on his phone, three of them in the mobile
BROWSER rather than the Android app — a surface no amount of code reading or
emulator work had been exercising.

**A column of cards could not be scrolled, and "+ Add card" fell off the screen.**
Two of the reports, one cause. A column page had no `flex: 1` and its `FlatList`
had no `style` at all, so react-native-web sized the list to its CONTENT. Past
about ten cards the list overflowed the page, which clips (a View is
`overflow: hidden`), so the last card was sliced in half and the action row was
pushed below the fold — and **nothing scrolled**, because no element had
scrollable overflow at all. The same tree behaves on native, which is exactly why
it only ever appeared in the browser. It also explains the second report: a
content-sized list leaves no space to push the action row down, so on web it sat
directly under the cards while Android pinned it to the bottom. Measured before
and after: the container went from `overflow-y: hidden`, wheel-inert, last card
at y=940 in an 844px viewport, to `overflow-y: auto`, scrolling, with the button
at y=784.

**A white band appeared below the app while scrolling, and stayed.** The web
shell is Expo's generated template, whose reset sizes `#root` with
`height: 100%`. That resolves against the layout viewport, which does not follow
a mobile address bar as it collapses — so the moment the bar hid, the visible
area grew past the app and bare page showed through. The project now owns the
shell (`app/public/index.html`), sizes the root in `dvh`, and paints html/body
the app's canvas colour so any momentary disagreement shows brand rather than
white. `scripts/check-web-template.mjs` runs on the export path (and therefore in
CI) and fails if the `dvh` rule disappears or the colour drifts from
`palette.ts` — the template is a hand-merged copy of a vendor file, and both
fixes are invisible to the type system and to the ESLint colour rule.

**The Archived chip widened the results instead of narrowing them.** It sat
beside Overdue, Urgent and High — all of which restrict — while `includeArchived`
ADDED the archive to whatever else matched. Correct when it was a checkbox
labelled "including archived"; a trap once it became a chip, and one you could
only catch by counting rows, which is how Faisal caught it (63 → 67, same live
cards still on top). Now `archivedOnly`: the two sets never mix, the Firestore
query constrains to one archive state so it also fetches less, and the test
asserts every live card is *gone* rather than merely outnumbered — the old test
passed under both meanings.

### 2026-07-26 — Archiving a board now puts its work away too — v0.1.29

A wide audit at Faisal's request, after the previous review turned up three
defects and left the fair question of how many more were hiding. One root cause
with three symptoms, plus one piece of half-finished data.

**An archived board was hidden but not quiet.** The board vanished from every
list while its cards stayed fully live: they kept appearing in **My Work**
(rendered as "in a board" — no name, no labels, no assignee chips, because the
board was no longer in the lookup), the **due-soon sweep** kept reminding people
about them, and assignment/comment/mention **notifications** kept firing. Search
was already correct, because it derives its card set from the board list — and
that asymmetry is what marked this as an oversight rather than a decision. It is
the same shape as the assignee bug found in the previous pass: one question
answered two different ways in two places.

- **Client**: My Work now keeps only cards whose board it can actually see, the
  same scoping Search uses. No denormalised `boardArchived` on every card, and no
  fan-out when a board is archived. It waits for the board list as well as the
  cards, so it cannot flash "nothing assigned to you" at someone who has plenty.
- **Server**: the check lives in `notify()`, the one place every notification
  passes through, so a future trigger inherits it rather than having to remember
  it. Deliberately **not** memoised in a module-level map: function instances are
  reused between invocations, so such a cache outlives the call, and archiving
  then restoring a board would leave a warm instance suppressing its
  notifications with nothing to show why. One document read is the cheaper
  mistake.

**`archivedAt` was written by bulk archive only, and read by nothing.** Half the
archive had the field. It is now written on every archive path and cleared on
restore, and the archive screen orders by it — newest first, which is what you
want when hunting for the thing you just put away. Rank, which it used before, is
a board position and means nothing once a card is off the board.

Verified end to end, not just by unit test: a card assigned and visible in My
Work, its board archived, the card gone; two cards archived in sequence and the
later one on top. An integration test pins the notification silence, with a
control on a live board so an empty inbox proves silence rather than a no-op.

**A second pass, over different ground.** Notifications, tokens, dates, session
claims and every list screen's failure path.

- **A failed query still rendered its empty state.** The error itself was never
  silent — `Screen` has shown a live-data banner for a long time — but underneath
  that banner every list fell through from `loading` to `data ?? []` and printed
  its empty message. A red bar saying something broke, directly above "No boards
  yet. Create one to get started." for someone with fifteen boards. The likeliest
  real causes are losing access to a board mid-session and an index that exists
  locally but was never deployed, and both then read as data loss. Each list now
  says it could not load, and the board says it with a header and a Back button:
  the first attempt returned a bare panel on the immersive board, which has no
  tab bar, and stranded the reader with no way off the screen. Found by forcing a
  genuine `permission-denied`, not by reasoning about it.
- **`todayInOrgTz` was defined twice** — once in `@sabeel/shared`, used by the
  card face, My Work and Search, and once privately in `CardScreen`, whose copy
  carried the comment "the only place a timezone is consulted". Identical today,
  so nothing was visibly wrong; the card's overdue badge would simply have
  disagreed with the card face beside it the moment either changed. The private
  copy is gone. That is the third instance of one rule living in two places, so
  it is now a thing to look for rather than a coincidence.

**Checked and found correct**, recorded so the next audit can skip them: push
tokens are unregistered BEFORE the auth sign-out (after it, the delete would be
denied and silently swallowed); dead FCM tokens are pruned on exactly the two
codes that mean "gone"; `commentCount` tolerates its card having been deleted;
claim refresh is bounded by timeouts and falls back to the cached token rather
than stranding anyone on a spinner; `addDays` is UTC arithmetic on date-only
keys, so it is immune to DST.

### 2026-07-25 — Review of the reworking: a card that could not come back — v0.1.28

A deliberate read-through of everything the last three releases touched, at
Faisal's request. Three defects, all in code shipped hours earlier, none of which
a test or a screenshot would have caught.

**An archived card could become permanently unrecoverable.** A column may be
deleted once it holds no LIVE cards — and the message shown when deletion is
blocked says "move or **archive** them first" — so archiving a column's cards and
then deleting the column is the path the app itself recommends. Those cards keep
a `columnId` that no longer exists, and `firestore.rules` checks
`columnId in board.columnIds` on **every** update via `wellFormed()`. So
un-archiving was rejected outright: the card could not be restored, could not be
edited, and a member (who cannot delete) had no way out of it at all. Reachable
only since v0.1.25, which added the Restore button that hits this. `restoreCard`
now re-homes such a card into the first column, at the bottom, and says where it
went. Pinned by a rules test that asserts both halves — the stale write refused,
the re-homed one accepted.

**The assignee trigger asked a different question than the picker answered.** The
heading used `members.length > assignees.length` as a proxy for "is anyone
available", while the picker computed the actual set. They disagree exactly when
an assignee is no longer a board member — the orphan case the picker explicitly
handles — leaving a real, assignable member unreachable. Both now call one
exported `assignableCandidates`.

**Two pickers could be left open over nothing.** Assigning (or adding) the last
candidate emptied the list while the picker was still open, and because the
heading's trigger hides while a picker is open, the section was left with no way
to reopen it; unassigning someone later made the picker reappear unbidden. Both
now close themselves when they empty.

Also caught in review and corrected before commit: a `useMemo` placed below an
early return (a conditional hook — ESLint's `rules-of-hooks` catches it, verified
by deliberately reintroducing it), and a `useEffect` referencing a `const`
declared further down the component, which would have thrown on every render.

### 2026-07-25 — Canonical controls, and a badge that could never come down — v0.1.27

Faisal named one instance ("the settings button should just be a gear sign") and
asked for the rest of the app to be audited against the same rule, then ruled on
the list. Words are now reserved for the primary action of a screen and for
anything destructive *and* unusual; everything else uses the control the world
already agreed on.

- **Alerts**: gear/inbox to switch sides, `✕` to dismiss one, `✓✓` to mark all
  read, and a new **dismiss-all** sweep that **asks first** — it empties the
  inbox and there is no undo. Notification preferences are **real toggles**
  (Faisal overrode a recommendation to keep them as On/Off words), and muting a
  board is a bell.
- **Assignees / members / labels**: person-add, person-remove, and `✕` in place of
  labelled buttons; a `+` beside the field that adds a column or a label.
- **Deliberately left alone**: Delete column, Delete permanently, Archive card,
  Delete N (destructive *and* unusual); New board, Create, Sign in, + Add card,
  Comment (primary actions); every Cancel; Approve/Reject on People.

**A real bug the work uncovered.** `dismiss()` deleted the notification document
and nothing else — and there is **no delete trigger** (`functions/src/
notifications.ts` only ever increments on create). So dismissing an *unread*
alert left `unreadNotifCount` counting a document that no longer existed: a badge
showing 3 over an inbox with nothing unread in it, permanently. It is now a
transaction that re-reads `read` before touching the badge, the same shape
`markRead` already used and for the same reason. Three rules tests pin that a
client may both delete its own entry and adjust its own badge.

**Sections carry their own action.** Faisal: "we can save some vertical space by
putting the add assignee icon in the same row as the assignee's label." The card
screen already did exactly this for Description, hand-rolled; `Heading` now takes
an optional `action`, so it is one pattern rather than a per-screen improvisation.
Board settings gained the most: the standing "Add someone" panel — which grew a
row per person in the directory — became an icon on the *Members* heading opening
a capped, scrollable picker. Subtasks and **New board** were considered and left
as they are: the first saves no height, the second is a screen's primary action.

### 2026-07-25 — Search browses by default, with filter chips — v0.1.26

Faisal's idea, and it fixes the archive problem from a second direction: Search
showed **nothing** until you typed, so the only way to find a card was to already
know its name — which is exactly what you cannot do when you are looking for
something you archived.

- **Browses by default**: every card on every board you are on, **newest first**.
  The shared `rankMatches` already returned everything for an empty query; it was
  the screen that gated on `text.trim().length === 0`. With a query it ranks by
  relevance as before; without one it orders by `updatedAt`, so the default view
  answers "what has been happening across my boards".
- **Filter chips** — Archived, Overdue, Urgent, High — each mapping to a filter
  that already existed and was already tested in `@sabeel/shared` and had simply
  never been surfaced (noted as a known gap since Phase 12). Kept deliberately
  few: "Assigned to me" would duplicate My Work, and a full label/assignee matrix
  would rebuild the board filters that were parked on purpose.
- **An honest cap** rather than a silent truncation: the render is bounded at 200
  and says how many were left out. Filtering stays in memory over the cards
  already fetched — the right call at this size (tens of cards), and the cap is
  what stops it degrading badly if that ever stops being true.

**Scale, stated plainly.** Search fetches every non-archived card across your
boards in one shot and filters client-side. That was already true; browse-by-
default just means you always pay it. At 41 cards it is nothing. The agreed
position is to keep it simple now and revisit if the card count grows an order of
magnitude — at which point the shape is known: chips become server-side
constraints (they are all indexable equality filters) while the text box stays
client-side, because Firestore cannot do full-text search at all.

### 2026-07-25 — Archive is reachable, titles read as titles, subtasks in history — v0.1.25

Three things from a review pass, all of them gaps rather than regressions.

- **Archived cards had no way back.** Members can only archive (never delete),
  precisely so nothing is lost — but the sole route to an archived card was
  global Search, in a different tab, behind an "Including archived" toggle that
  gave no hint that was where your card went. **A reversible action you cannot
  discover how to reverse is not reversible.** The board header now has an
  archive icon opening that board's archived cards, each with **Restore to the
  board**; permanent delete stays managers/admins. Available to everyone, since
  members are the ones who archive. New `useArchivedBoardCards` reuses the
  existing `(boardId, archived, rank)` index — the other value of `archived`.
- **The title was a permanently-open text input**, which was wrong twice over: a
  card's name is the thing you came to read, and a single-line field **truncates**
  it, so a long title could not be read in full on the one screen devoted to that
  card. It now reads as the page heading and wraps; a pencil turns it into a
  field, matching Description directly below. The generic "Card" heading above it
  went with it — the card's own title is the heading now.
- **Subtask links were invisible in history.** Logged now, and on **both** cards:
  `parentId` lives on the child, so the diff only ever sees the child — but you
  link a subtask while looking at the PARENT, and history that says nothing where
  the action was taken reads as the action not being recorded. The trigger writes
  a mirrored entry, so the parent shows "added X as a subtask" and the child
  "made this a subtask of Y". Both store the other card's **id**, resolved to a
  title at render, so a rename never leaves stale history — the same reason
  `moved` stores a column id.

### 2026-07-25 — Subtask lateral review: a one-way door, family moves, the pager — v0.1.24

Reviewing subtasks against archive / delete / move turned up a trap I had
shipped hours earlier, plus the pager bug caught on video.

- **The unlink one-way door.** Archiving or moving a parent left the child
  silently still linked: no sign it was a subtask, no unlink (the only one lived
  on the now-unreachable parent), and excluded from every picker **forever**,
  because `canBeSubtaskOf` refuses an already-parented card. Reproduced in the
  emulator: on a board seeded that way, "Link an existing card" was **disabled**
  with no explanation, because the only candidates were the stuck cards. The link
  lives on the child, so the child now always shows it and can always let go —
  including when the parent cannot be resolved, where it says so plainly rather
  than hiding.
- **Family moves.** `bulkMoveToBoard` cleared `parentId` unconditionally, so
  moving a parent together with its subtasks silently flattened the structure.
  The link now survives exactly when both ends travel — `parentAfterMove()` in
  `@sabeel/shared`, unit-tested, so the rule is named rather than inline.
- **The pager (from the video).** Backing out of a card left the header on the
  remembered column while the body still rendered column 1 — which was empty, so
  it read as the cards having vanished. The restore was a `scrollTo` deferred a
  frame. The pager is now measured by a wrapper and mounted only once the width
  is known, scrolls on `onContentSizeChange` (the first moment a scroll can
  land), and is held invisible until it is on the right column: **a blank frame
  beats a wrong one**. Guarded by `needsRestore`, so a remembered page that no
  longer exists (columns deleted since) cannot leave the board permanently blank
  — a corner the fix itself introduced.
- **The orphan sweep** tolerates a concurrently deleted child (per-child updates,
  not one atomic batch). Scope stated honestly in the code: the ordinary case was
  already safe, and the regression test passes against the batched version too.
- `probe-indexes.mjs` now covers the sweep's `parentId ==` query.

### 2026-07-25 — Subtasks: cards that link to cards — v0.1.23

A card can now be a **subtask of one other card on the same board**. The parent's
detail view lists its subtasks and links straight through; the child shows
**Subtask of** to get back up.

**This reverses a locked scope decision** — `PRODUCT_BRIEF` listed
"checklists/subtasks" under *Explicitly NOT in v1*. Justified: production still
carries **7 cards with a fake `Subtask of:` line** in their descriptions, written
by the ClickUp import because the feature didn't exist. What shipped is far
lighter than what was declined — a link between two ordinary cards, not a
checklist with its own item type. The brief now says so rather than being
silently contradicted.

- **`parentId` on the CHILD**, so the parent's list is derived and two documents
  can never disagree. Not a `subtaskIds[]` array on the parent, which would make
  every reparent a two-document write with a drift window.
- **No new query, no new index, no new counter.** `CardScreen` already loads the
  board's cards for its move-rank maths, and every board layout already groups
  them — so the subtask list and the `N subtasks` face chip are client-side
  derivations that cannot go stale. Deliberately unlike `commentCount` /
  `activeCardCount`, which need triggers only because their source isn't loaded.
- **Both ways to add share one row**: type a title and press **+**, or press the
  **link** icon to attach a card that already exists. Adding an existing card
  started as a full-width labelled button — the exact mistake `CLAUDE.md` records
  having been made three times, since a labelled button for an ordinary action
  costs a row of the card on every open. Caught in review and corrected.
- **Cycle safety in `@sabeel/shared`** (`subtasks.ts`): the picker refuses a card
  that is itself, already has a parent (no silent stealing), or is an ancestor of
  the target. `ancestorsOf` walks with a visited set, so data that is already
  corrupt is traversed once instead of hanging the UI thread.
- **Rules**: `parentId` added to the card key allowlist — omit it and every
  subtask becomes uneditable the moment it is linked, the same trap `sourceId`
  documents. Shape-validated only; enforcing "parent is on the same board" would
  need the first card→card `get()` in the rules, costing a read per write and
  racing a delete, and it is not a security boundary.
- **Lifecycle**: a cross-board move clears `parentId` (board-scoped exactly like
  `labelIds`); a copy never inherits it; deleting a parent unlinks its children
  via `onCardDeleted` — without that they would dangle *and* become permanently
  unlinkable, since the picker refuses an already-parented card.

**Fixed a latent bug this feature would have made routine.** `App.tsx` rendered
`CardScreen` with **no `key`**, so a card→card push reused the component and kept
its local state: start editing card A's title, tap a subtask, and card B rendered
showing **A's typed title** — pressing Save wrote A's text onto B. Now keyed by
card id. The web verification reproduces exactly that scenario and asserts B shows
its own title.

Verified on **web** (desktop + 390px): create, link with the filter, tap through,
unlink (which detaches without deleting — confirmed the card survives on the
board), the `2 subtasks` chip, and the keying fix. And on **native** (AVD):
section renders, create via the real soft keyboard, card→card navigation, the
parent line, and **hardware back** returning to the parent. 245 shared unit tests
(20 new), emulator suite green — 126 rules tests (+5 for `parentId`) and 36
function tests (+1 for the orphan sweep).

### 2026-07-25 — Icon targets are real 44px boxes, not hitSlop — v0.1.22

Reported from a real phone: the save/cancel icons when renaming a column were
"too small and close to one another… you have to use the very tip of your
finger."

The cause was **app-wide**, not local to that editor. `IconAction` sized its
target with `hitSlop` — invisible margin painted OUTSIDE the element — 12px each
side. Two icons separated by a 4px gap therefore had touch areas overlapping by
**20px**, a band belonging to both, where which one you hit was arbitrary. The
same defect was in every adjacent icon pair in the app: the board header's
gear/back (12px gap → 12px overlap) and the bulk bar's six icons (16px gap → 8px
overlap). Only the rename pair was tight enough — and high-stakes enough, save vs
discard — for anyone to notice.

- **`IconAction` now lays out a real 44×44 box** (`minWidth`/`minHeight`, centred
  ink) instead of using `hitSlop`. Laid-out boxes cannot overlap, so adjacent
  icons are always unambiguous, and 44 is the platform accessibility minimum
  rather than a number that felt right. Fixes every icon row at once.
- Because the box now carries its own separation, the gaps in the bulk bar
  (`space.lg`) and both board headers (`space.md`) drop to `space.xs` — otherwise
  the bulk bar, which must stay on ONE row, would have grown past a phone's width.
- The rename pair also gets **bigger ink (24) and a colour distinction**: save is
  accent-tinted as the affirmative, cancel stays muted. Two muted 18px glyphs are
  hard to tell apart in a hurry regardless of target size.

Verified on **web** by measuring: both targets are exactly 44×44 with a 4px gap
and zero overlap, and the phone page has no horizontal overflow (bulk bar still
one row at 390px). And on **native** (AVD): targets measure 115×115px — 44dp at
that density — non-overlapping, with the accent check clearly distinguishable.

### 2026-07-25 — Editable column names, and column delete now asks — v0.1.21

Column names are editable **everywhere a column name appears** — board settings
and all three board layouts — and deleting a column now takes a confirmation
instead of firing on one tap.

- **One shared `ColumnNameEditor`** (`app/src/components/ColumnNameEditor.tsx`)
  rather than four copies of the same edit state; it renders through
  react-native-web inside the web board's DOM header, exactly as `CardFace`
  already does. Idle shows the name plus a pencil; editing swaps in a field with
  save/cancel. Manager/admin only, matching the board-update rule.
- **The rename rule lives in `@sabeel/shared`** (`renameColumn`), because it has a
  trap: `validateColumnName` rejects a name any existing column holds — and the
  column being renamed is one of those. Validating against the whole list would
  reject re-saving a column's own name and, less obviously, reject fixing only its
  **capitalisation**, since the duplicate check is case-insensitive. Unit-tested,
  including that case-only rename.
- **Phone layout gets its own treatment**: the pager's Prev/Next buttons step
  aside while editing (they leave barely 130px between them, which is not a field
  you can type a column name into), via an `onEditingChange` callback.
- **Delete now confirms.** It was one tap from gone for an empty column;
  emptiness is not consent. A named confirmation ("Delete the column “Done”? It is
  empty, but this cannot be undone.") with a labelled destructive button, per the
  convention that destructive-and-unusual actions get words, not icons. The wide
  boards also hide the delete ✕ while a rename is open, so the cancel ✕ and the
  delete ✕ are never adjacent.
- **`columnDeleteBlocked` moved to `@sabeel/shared`** — the "still has N cards"
  guard was triplicated across the three boards with drifting wording.
- Tidy-up while in the file: WideBoard's column delete was a `Button label="✕"`,
  now an `IconAction`, per the icons-not-labelled-buttons convention.

Verified on **web** (desktop + 390px phone, all four surfaces): rename persists,
duplicate names rejected, delete asks and cancels cleanly, non-empty columns still
blocked, no page errors. And on **native** (AVD): pencil renders, the field takes
the full pager row with the soft keyboard up, the rename persisted with
`columnIds` **still in sync** with `columns`, and the delete confirmation appeared
instead of deleting. 225 shared unit tests, emulator suite green (121 rules + 35
functions).

### 2026-07-25 — Disaster recovery: native protection + a detection canary

Backend and ops only — **no client change**, so nothing here gated on an app
release. Production had no data safety whatsoever: PITR disabled (version
retention **1 hour**), zero backup schedules, zero backups, delete protection off.
The only backup in existence was a 65 KB JSON file on one laptop, written by a
throwaway script that was deleted immediately after — and it had no reader.

- **Native Firestore protection, enabled and verified in production**: PITR
  (`versionRetentionPeriod` 3600s → **604800s**, 7 days) + a **daily** backup
  schedule at **98-day** retention (Firestore's maximum) + `DELETE_PROTECTION_
  ENABLED`. Google-managed settings, no code to maintain. Chose daily over the
  sibling's weekly; both layers are excluded from the free tier. State was read
  back from the database afterwards rather than inferred from the CLI's success
  messages.
- **`healthCheck` canary** (`functions/src/health.ts`), ported from the sibling
  time-tracker: daily `count()` aggregations per collection, compared against a
  baseline at `meta/health`, raising to Sentry when a collection shrinks past its
  tolerance — zero tolerance for `boards`/`activity`/`users` (the rules forbid
  deleting the first two at all), `max(5, 20%)` for `cards`/`comments`/
  `notifications`. Sends a Sentry **cron check-in**, so the job going silent is
  itself an alert. Retention is worthless if nobody notices in time.
  - Kanban-specific: `comments`/`activity`/`notifications` are **subcollections**,
    so they must be counted with `collectionGroup`. A bare `collection('comments')`
    would count a non-existent top-level path and report perfect health forever.
  - New `COLLECTIONS` in `@sabeel/shared`; `reportMessage`/`startCheckIn`/
    `finishCheckIn` ported into `functions/src/sentry.ts`.
- **`scripts/restore-auth.mjs`** — Firestore backups do not cover Firebase Auth,
  and recreated accounts get **new uids**, which would silently break every
  `memberUids`/`assigneeUids`/`createdBy` reference. No separate Auth backup is
  needed because `users/{uid}` already holds the roster (the doc id *is* the uid),
  so this rebuilds accounts with their original uids and re-applies role/status
  custom claims. Dry-run by default, idempotent, never deletes.
- **`docs/DEPLOY.md`** gained a full runbook, replacing the old "Firestore data
  has no undo" line: the two layers, inspect commands, and the numbered restore
  procedure — restore to a scratch db → verify → export → **import back into the
  original database id**. You can never restore into an id already in use, and
  repointing installed Android clients would mean a new build for every user.

Verified: 26 unit tests (15 new, policy exhaustively pinned), emulator suite green
(121 rules tests incl. a new one proving `meta/health` is client-denied by the
catch-all; 35 function tests incl. a new one proving the collectionGroup counting
and the re-baseline). `restore-auth.mjs` verified both ways — dry-run against
production (5 accounts, nothing written) and apply against emulators (uids
preserved, claims applied, idempotent on re-run).

Outstanding, tracked in `TODO.md` §J: confirming the first scheduled backup lands
(a schedule with no backup behind it is not yet protection), and a restore drill —
which is also what settles whether a Google sign-in re-attaches to a restored
account.

### 2026-07-24 — Instant Leave/Remove feedback + quieter slow-write alerts — v0.1.20

Follow-up to v0.1.19, prompted by a real phone: leaving a board took seconds with
no feedback (a Cloud Function cold-started *before* the confirm dialog even
showed), and the slow-write monitor then emailed the team an error-level issue for
it.

- **The confirm dialog now opens instantly.** Tapping Leave/Remove no longer waits
  on `countMemberAssignments` first. Self-leave skips that callable entirely (one
  round-trip, not two — `removeBoardMember` already reports what it unassigned);
  removing someone else opens the dialog immediately and fills the card count in
  the background ("Checking…" → "assigned to N cards"), guarded by a request token
  against a stale count landing in the wrong dialog.
- **Slow-write monitor tuned.** `slowWrites` now reports at **warning**, not error
  (via a new optional `level` on `captureError`, both sentry seams), and the
  threshold moves 3s → **5s**. The two unavoidable causes — a cold-started callable
  and a Firestore write on a poor connection — are latency, not defects, and every
  action already shows a spinner while it runs; recording them is useful, paging
  the team is not. (Console-side: the alert rule should page on error/high-priority
  only.)

Client only. Verified end-to-end on **web** (self-leave dialog in 62ms; remove-
other count fills in, no page errors) **and native** (AVD: dialog instant, full
leave → member count drops to 2). Typecheck + lint clean.

### 2026-07-24 — Self-service board membership: Join / Leave — v0.1.19

Managers and admins can now **join** and **leave** a board themselves, from the
board's **Members** settings — no new screen. This completes the brief's
"managers may join any board", which the UI could not actually do before (adding
members needs the admin-only user directory; adding *yourself* does not).

- **Leave** — your own row in Members now offers **Leave** (it was blank before).
  It runs the existing `removeBoardMember` callable, so card assignments clear
  atomically; you are told how many first, then sent back to your boards.
- **Join** — open the settings of a board you are not on (managers/admins may view
  any board) and a **Join this board** button sits at the top of Members. It adds
  only *your own* uid, so it needs no directory read — a manager can join any
  board without admin rights to list users.
- Others' membership is unchanged: still added/removed by managers/admins. Only
  your *own* membership is self-service.
- Rules test added (`boardRules.test.ts`): a manager can add their own uid to a
  board they are not on.

Client + one rules test; no schema or index change. Verified on web (desktop +
phone) end-to-end against the emulator: Leave → the board flips to the Join card →
Join restores membership, through real rules and callables, no errors.

### 2026-07-24 — Boards list shows active card count — v0.1.18

The Boards list now shows **N cards · N members** per board (non-archived card
count) instead of **N columns** — column count isn't useful there; the live card
count is. Server + client:

- **New `activeCardCount` on the board doc**, maintained by a new
  `onCardBoardCount` trigger (functions) — the same denormalised-count pattern as
  a card's `commentCount`. One delta covers create / archive / unarchive /
  cross-board move / delete. `newBoard` seeds it to 0; `firestore.rules` allows
  the key on board writes.
- **Backfill** (`scripts/backfill-board-card-count.mjs`) recomputes the count for
  boards that predate the trigger — run against prod at deploy.
- Integration test (`boardCardCount.test.ts`) covers the whole lifecycle.

Verified: emulator suite green (rules + triggers incl. the new one); web shows
"6 cards · 1 member" after a seed. Deployed rules + functions, backfilled prod,
then web + APK.

### 2026-07-24 — Card faces at a glance (badges + assignees) — v0.1.17

Client-only. Replaces the bare priority color dot with a proper card face —
title · priority · labels · due · assignees — everywhere, via **one shared
`CardFace`** (the face had been hand-inlined in five places; the greenfield fix
was to extract it, not edit five copies).

- Priority + labels are colored **badges**; assignees are **name chips**. Badge
  text ink is picked for contrast by a new pure, unit-tested `readableInkOn` WCAG
  helper in `@sabeel/shared` (goldenrod/gold → dark text, the rest ivory). `none`
  priority shows no badge.
- Labels + assignees now render on **all** surfaces (board ×3, My Work, Search),
  resolved against the already-loaded board `labels`/`members` (My Work's mapper
  stopped dropping the ids).
- CardScreen priority + label pickers restyled to the same badges (fixes the
  label picker's muted-text-on-fill).

Verified on **web** (board desktop+phone, card detail, My Work, Search) **and
native** (AVD: board face + label picker) — badges readable on every color,
assignee chips flow, `none` shows nothing.

### 2026-07-23 — Production reset and fresh ClickUp re-import (data op, logged late)

No release — recorded here retrospectively because it was a **production data
operation** and the log had no entry for it, which is exactly the kind of gap that
makes an incident harder to reason about later.

Ahead of inviting the former ClickUp users, production was backed up, wiped down
to Faisal's admin account, and re-imported from the ClickUp export: **3 boards, 27
cards, 15 comments**. The backup landed at
`migration/backups/prod-20260723-143703.json` (gitignored, ~65 KB, and it captured
auth users + claims as well as Firestore).

The backup and wipe scripts were written as throwaway heredocs, run once, and
deleted — so the snapshot has **no reader**, and the operation is not repeatable
as written. That, plus production having no PITR or backups at all, is what
prompted the disaster-recovery work on 2026-07-25.

### 2026-07-23 — Reorder handle, build stamp, sign-in button — v0.1.16

Client-only:

- **Board columns reorder by drag handle**, not ↑/↓ buttons. New `ReorderList`
  (HTML5 drag on web, hand-rolled PanResponder on native — no gesture library).
  Columns is the only button-reordered list. Verified on **both** web and native
  (handle renders, drag reorders, one `columnsPatch` write per drop, persists).
- **Sign-in screen stamps the running build** — `v<version> · <commit>` footer,
  injected at build time by `scripts/gen-build-info.mjs` (wired into `prepare`,
  `web:export`, and `build:apk`). Durable requirement.
- **Sign-in button spans its card** — `Button` gained a `block` prop; the one
  screen that's the exception to content-width-on-wide.

### 2026-07-22 — Share a card + board breadcrumb — v0.1.15

Client-only (no rules/functions/index change):

- **Board breadcrumb** on the card view — cards are top-level docs, so the detail
  screen previously never named its board. Now a tappable accent breadcrumb at
  the top shows the board and jumps to it.
- **Share a card** (v1): a Share button on the card view hands an `https://…/c/{cardId}`
  link to the native share sheet (Android) or the Web Share API / clipboard (web).
  Opening the link resolves the card's board **live** (`findCardBoard`) and opens
  the card — the link is `/c/{cardId}` alone, with no board baked in, so it
  survives a cross-board move (which reuses the same card id). A non-member or a
  deleted card gets a plain "unavailable" notice, not a blank screen. New platform
  seams: `links.ts`, `deeplink.ts(.web)`, `share.ts(.web)`, `alert.ts(.web)`,
  `pendingLink.ts`, `useDeepLinks.ts`.
- **Deferred to v2** (needs the release keystore's SHA-256 → `assetlinks.json`):
  Android **App Links** so a phone opens the link in the installed app instead of
  the browser. v1 opens the web app in the browser on a phone — fully functional.
  See TODO.md § F (release signing) — the two share the signing fingerprint.

Verified: lint + typecheck clean; link parser proven against URL/path/query cases;
authenticated web tour (desktop + phone) — breadcrumb renders, Share copies the
correct `/c/{id}` link, and loading `/c/{id}` fresh resolves + opens the right card.

### 2026-07-22 — Production-readiness hardening — v0.1.14

Shipped the two-phase hardening pass (see the commits "Production-readiness
hardening Phase 1/2"). Server AND client change here, deployed together:

- **Rules** (`firestore.rules`): card/board/comment writes restricted to their
  known key set (`keys().hasOnly`) and card `description` capped at 20000.
  Backward-compatible — verified against live prod before deploy: all 32 cards /
  4 boards / 23 comments were already within the new key sets, longest
  description 1583 chars. v0.1.13 installs keep working (write shapes unchanged).
- **Functions**: new `onCardDeleted` cascade (deletes a hard-deleted card's
  orphaned comments/activity, guarded against a re-created live card);
  `removeBoardMember` now attributes its unassignment activity to the manager.
- **Client**: input length caps (board name / card title / comment body /
  description) so a normal edit no longer fails with a raw permission-denied;
  Search consolidated to a `boardId in [...]` query (reuses the existing
  `(boardId, archived, rank)` index — confirmed built in prod via
  `scripts/probe-indexes.mjs`); double-submit + markRead-drift fixes; sign-out
  clears the live-query cache.

Verified: lint, typecheck, web export, and the split emulator suite (149 tests,
5× green) plus CI. Shipped to Hosting + the Android release APK.

### 2026-07-21 — Widescreen layout pass — v0.1.13

Client-only UI change (no rules/functions/indexes). The wide/desktop view was the
phone layout stretched sideways — full-width buttons and list rows in an 840px
column. Fixed systematically with responsive primitives (`app/src/theme/layout.ts`,
`app/src/components/ui.tsx`):

- `Button` sizes to its content on a wide screen (full-width still on a phone), so
  standalone buttons stop stretching into bars everywhere at once.
- `Screen` `width` gains `read` (~640 reading column for text/forms) and `list` (a
  wide 1160 column for grids), alongside `content`/`full`.
- `CardGrid` — a responsive grid (as many ~250px columns as fit; one column on a
  phone).

Applied: Boards is a grid of cards with a real **star** favourite icon (was a
filled dot); My work and Search are grids; Card detail, Board settings,
Notifications, People, sign-in and gate screens use the reading column. Dropped
the redundant Back button from the nav-bar tab roots (My work / Search / Alerts).
The widescreen reasoning was also written into the public `expo-firebase-stack`
skill. Verified on the emulator at desktop (1500px) and phone (390px) widths;
shipped to Hosting + the Android release APK.

### 2026-07-21 — Navigation shell + move/copy panel polish — v0.1.12

Client-only UI change (no rules/functions/indexes), from the team's feedback on
v0.1.11.

- **A persistent navigation shell** (`app/src/components/AppNav.tsx`) replaces the
  per-screen row of header buttons that wrapped and scattered: a **bottom tab bar
  on a phone**, a **VSCode-style left rail on wide/web** — Boards · My Work ·
  Search · Alerts (+ unread badge) and an Account menu (People for admins, Sign
  out). The bottom bar shows only on the tab roots and steps aside on the
  immersive board/card screens; the left rail persists everywhere. Safe-areas go
  through `react-native-safe-area-context` (real per-device insets, floored), and
  `Screen` drops whichever edge the chrome claimed (`NavClaimedEdgesContext`) so
  insets never double.
- **Move/copy panel** rebuilt: board/column dropdowns and Copy·Move on one
  left-aligned wrapping row, dropdowns only as wide as their text (`field-sizing:
  content` on web so the box hugs the current value, not the widest option), no
  redundant counts or Cancel. Reflows with the buttons paired when it can't fit.
- **Board/card headers**: titles truncate and Settings/Back became icons, so a
  long board name no longer displaces them.

Verified on the emulator, web (rail) and native (bottom bar clearing the gesture
pill; board immersive; the redesigned panel). Shipped to Hosting + the Android
release APK.

### 2026-07-21 — Cards become a top-level collection + cross-board move/copy

Two-phase change shipped to production (project `sabeel-institute-kanban`).

- **Phase A (data model, invisible).** Cards moved from the per-board
  subcollection `boards/{boardId}/cards/{cardId}` to a **top-level `cards/{cardId}`
  collection** with a `boardId` field; comments/activity ride along under the card.
  Deployed in order — indexes (waited for the board-view index to build) → migration
  **copy + verify** (32 cards, 23 comments, 65 activity, 0 problems) while functions
  still triggered the old paths → re-pathed functions + rules + client together →
  live-verified → migration **--purge** (0 old, 32 top-level). Rules rewritten to
  resolve a card's board from its `boardId`; the collection-group My Work rule was
  deleted (My Work is now a plain collection query, still gated by the assignee
  read arm). 136 emulator rules tests + 201 unit tests green.

- **Phase B (feature) — v0.1.11.** Cross-board move & copy: long-press a card →
  the bulk bar's folder-arrow action → pick a destination board and column → Copy
  or Move. A move is one batched `update` per card (board/column/rank; labels
  cleared; non-member assignees dropped); a copy is a fresh card, no comments. No
  new rules/functions/indexes — Phase A's card update rule already authorises the
  board change. Verified on the emulator on **web and native** (the native
  long-press → sheet → native Select pickers → Move all exercised and the data
  confirmed). Shipped to Hosting + the Android release APK.
