# Sabeel Institute Kanban — Working Rules for Claude

## What this project is

A kanban board application for Sabeel Institute (small nonprofit, <50 internal
users), replacing ClickUp. Faisal is the developer; the nonprofit's staff are the
admins and board owners in the app. **The phases are finished and the app is in
production.**

Source of truth: `docs/PRODUCT_BRIEF.md` (decisions & data model),
`docs/PERMISSIONS.md` (who can do what), `docs/PHASE_STATUS.md` (live build
status and the deploy log).

**CI, release and device tooling is shared**: the `Sabeel-Institute/ci-tools`
package, pinned to a commit in `package-lock.json` and run as `npx sabeel-ci
<command>` (its README lists them). What differs for this app is said once, in
`ci-tools.json`. The workflows in `.github/workflows/` are rendered from it
(`npx sabeel-ci workflows`), never edited here, and `npx sabeel-ci check-app`
(in CI) fails on drift and on anything else ci-tools assumes of the app. A
change to a shared tool lands in ci-tools by pull request; this repo then moves
its pin (`npm install --save-dev github:Sabeel-Institute/ci-tools#<commit>`)
and re-renders.

## Stack knowledge lives in a shared skill, not here

Recurring traps of this stack live in the **`expo-firebase-stack` skill** —
`../agent-skills/skills/expo-firebase-stack/`, a clone of the **PUBLIC** repo
`faisal-shah/agent-skills`.
`docs/STACK-GOTCHAS.md` is a stub for that reason: a stub cannot drift.

**The boundary is one question: would this be true for a different company on
the same stack?** Yes → the skill. No → this file. Nothing naming this project
goes into the skill.

Its closing section, **"How this stack fools you"**, is the one to read *before*
debugging anything subtle. The recurring shape is that **failures imitate
success**: APIs that run and do nothing (`Keyboard` events under edge-to-edge,
RNW's unthemeable `Switch`, a stale `EXPO_PUBLIC_*` in the Metro cache),
verification steps that counterfeit the result, a green web suite that says
nothing about a native layout bug, and resources that report "deployed" while
not working. **Prove the mechanism ran before concluding a fix was insufficient,
re-test without touching anything, and reproduce on the surface that is actually
broken.**

When something here costs real time, **write the entry into the skill** —
symptom-first — in the same batch as the fix, not only into a commit message.

The skill also carries `tools/bootstrap-linux.sh`, which installs this whole
toolchain on a fresh machine under `$HOME` with no root, and `tools/check-host.sh`.
See `docs/DEVELOPING.md`.

Sibling project `../sabeel-institute-time-tracker/` is the reference
implementation for every convention here — read its files directly rather than
trusting a summary when the details matter. `docs/INHERITED-STACK.md` records
what carries over and, more importantly, what was learned the hard way there.

---

# Product invariants

Do not silently change any of these.

## Scope and shape

- **Restraint is the feature.** They left ClickUp because of interface bloat. No
  dashboards, integrations, automations, alternate board views, or time tracking.
  Every addition must justify itself against "does the team actually use this?" —
  when in doubt, leave it out and ask.
- **No board limit**, anywhere in the model, UI, or rules — the 5-board cap was a
  reason they're leaving.
- **Phone-first, not phone-compatible.** The mobile board is its own layout (one
  column at a time, swipe between columns), not a squeezed desktop board. Every
  feature ships with a phone design.
- **No WIP limits, no card start dates.** Both considered, both declined.
- **Boards archive, never hard-delete. Cards can be deleted, but only by that
  board's owners and admins** — members archive.
- **The team is in Houston — `ORG_TIMEZONE` is `America/Chicago`.** It shipped as
  `America/New_York` and nothing surfaced it: due dates are all-day strings, so
  the only symptoms were cards turning overdue an hour early and the due-soon
  reminder firing at 07:00 local. Do not "align" it with the sibling
  time-tracker — that project has no org timezone at all, by design, because it
  buckets each entry in the timezone where the work happened.

## Authority is TWO independent things

Changed 2026-08-16, replacing three org roles alone. An **org role** — admin /
organizer / member — and **ownership of one board**, a `boardOwnerUids` array on
the board document. They are orthogonal: a plain member can own a board, an
organizer can own none.

`organizer` grants EXACTLY ONE thing, creating a board; label curation and Stats
are admin-only; **only an admin sees a board they were not added to**. Everything
about one board — settings, columns, membership, ownership, archiving,
permanently deleting a card, deleting anyone's comment — is its owners plus
admins. `docs/PERMISSIONS.md` is the full statement; **do not restate the table
anywhere else.**

Three things that are load-bearing rather than tidy:

- **The creator is protected.** Only an admin may take `createdBy` out of
  `boardOwnerUids`, including on their own behalf — and the rule is phrased on
  the CHANGE, so a board whose creator an admin already demoted stays editable,
  which a value-shaped rule would have bricked. It checks BOTH lists, because
  authority is `member AND owner` and nothing makes the two move together.
- **Ownership is always checked WITH membership**, never alone, which is what
  lets the rules skip a `boardOwnerUids ⊆ memberUids` subset check. The subset
  does hold — `removeBoardMember` clears both — but it holds because that code is
  right, and rules cannot check an Admin SDK batch; a subset RULE would turn any
  lapse there, or any restore predating the shape, into a board that bounces the
  next client write. The pairing makes the same lapse inert instead.
- **`memberUids` and `memberProfiles` NEVER change from a client**, admins
  included: both directions are callables. Removal belongs to one because it
  clears assignments and subscriptions in the same batch — without that a board
  write could strand both, leaving a removed person read access through the card
  rule's assignee arm. Adding became one on 2026-08-20 because it did not work:
  rules let only admins `list` users, so a non-admin owner had nothing to pick
  from though the write was permitted. The server now supplies the profile too,
  which is the only way to stop an owner writing an arbitrary name against a uid.

And **board create REQUIRES `boardOwnerUids == [creator]`**, which turns "an app
too old to know about ownership made a board only an admin can manage" from
silent and permanent into a loud failure.

**Sign-in is restricted to `@oursabeel.com` AND still needs admin approval.** The
domain check is server-side — the client `hd` hint is UX, not a boundary. Since
2026-10-15 it is held at the door too: the project is on Identity Platform, and
the blocking `beforeSignUp` refuses every client sign-up but a colleague's first
Google sign-in on the domain; `onUserCreate` stays as the second lock.

**The password door is ONE address, and that one is a member** (Faisal,
2026-10-15: "should only accept that one email"; "Just a member."). It exists
for the store reviewers' account and nothing in the app says so: a plain **Sign
in with email**. `beforeSignIn` refuses a password sign-in for any other
address; `isSignedIn()` in firestore.rules and `isActive()` in storage.rules
give such a session nothing; a password session for the one address acts as a
member whatever its claims (`sessionAccess`, `role()`, `actorOf` — no callable
reads `auth.token` itself, `actor.test.ts` scans for it); and `setUserAccess`
refuses another role for a password-only account. The address is one constant,
`PASSWORD_SIGN_IN_EMAIL`, restated in both rule files and held to it by
`passwordDoor.test.ts`. It is public on purpose (`docs/STORE-RELEASE.md`
§ 3, The review account): do not hide it behind a claim.

**The institute's rules stand in front of every board, and reports belong to
the server** (Faisal, 2026-10-16; `docs/STORE-RELEASE.md` § 4). An active
account whose user document lacks the current `RULES_VERSION` gets
`RulesScreen` INSTEAD of the signed-in app, so nothing that can post is
mounted; only the `acceptRules` callable writes `rulesVersion` and
`rulesAcceptedAt`, which `firestore.rules` keeps out of the self-writable list.
Change what the rules mean and raise `RULES_VERSION` in the same commit; a
rewording that keeps the meaning keeps the version.
**Report a problem** stores `reports/{id}` and emails it from
`apps-noreply@oursabeel.com` by keyless domain-wide delegation (`gmail.ts`); no
client reads or writes `reports`, nothing in the app lists them, and a failed
send is recorded, never retried. No blocking between members: an admin
disabling the account is the block, by decision.

## Assignees, subscriptions and labels

- **Assignees must be board members**, rules-enforced. This is what makes the
  cross-board "My Work" collection-group query legal without a parent lookup —
  breaking it breaks My Work's security model.
- **Subscribing to a card means subscribing to its COMMENTS** (added 2026-07-28,
  narrowing the older "no watchers" decision rather than overturning it). Nothing
  else about the card notifies a subscriber — notifying on every change was
  considered and dropped, because `myCardMoved` already ships off for firing
  constantly and ten more triggers beside it would be worse. An assignee may also
  subscribe, which is how the interest survives being unassigned.
  **`subscriberUids` is a grant of READ** — the card read rule has a subscriber
  arm so the cross-board query needs no per-row board lookup — so it carries
  every constraint `assigneeUids` does: members only, cleared by
  `removeBoardMember`, filtered on a cross-board move, and absent from a copy.
- **Labels are ORG-WIDE, not per board** (changed 2026-07-27). One `labels/{id}`
  collection every board shares; a card's `labelIds` mean the same thing wherever
  the card is, so a cross-board move and copy **carry them** — the old code
  cleared them and must not come back. **Any active member creates** one (from
  the `+` in a card's label picker, since Board Settings opens for that board's
  owners alone); **ADMINS rename, recolour and delete** — the effect is org-wide,
  reaching cards on boards the editor cannot open, so the authority is org-wide
  too. Deleting is a callable that strips the id from every card first and only
  then removes the document — reversed, a failure would leave cards pointing at
  nothing findable. A COLLECTION rather than an array on a config doc: concurrent
  creates are the normal case here, and an array field would lose writes.
  Uniqueness is case-insensitive and client-checked only; a simultaneous
  double-create making two same-named labels is an accepted residual.

## Attachments

Added 2026-07-26, reversing the original "no attachments" decision. Multiple
files per card, **10 MB each**, any type. **Any active member of the board may
remove one** — deliberately NOT the owner-only gate permanent card deletion uses,
because attaching the wrong file is an ordinary mistake that should not need
someone else to undo. Plain rows, no inline previews. Attach and remove are both
recorded in the card's activity log.

**Storage rules cannot read Firestore, and everything about attachments follows
from that.** Board membership is a Firestore document, so `storage.rules` can
only ask "is this an active account". Therefore: the attachment DOCUMENT is the
upload's authorization (creating it is membership-checked, and the object goes to
a path derived from ids only that create could produce); objects are
**write-once and unreadable**; every download is a short-lived **V4 signed URL**
minted by a callable that repeats the membership check. Never
`getDownloadURL()` — its token never expires, so anyone who saw a link would keep
access after leaving a board. Clients cannot update or delete an attachment: a
client delete would strand the bytes, and a delete trigger cannot name who did it.

**Two accepted residuals, both measured, neither a bug to re-fix.** A signed URL
already handed out keeps working for up to an hour after someone is removed from
a board — individual signed URLs cannot be revoked, only the signing key rotated,
which would kill every URL at once. And there is **no cap on how many files a
card may hold**: the 10 MB limit is per file, so cost is bounded only by the
budget alert. Both are fine for fewer than fifty colleagues; neither survives
contact with untrusted users.

## Descriptions and comments are rich text

- **MARKDOWN, restricted to FIVE elements** (changed 2026-07-30, reversing the
  2026-07-20 plain-text decision on the explicit request that decision named).
  Bold, italic, bullet list, ordered list, link. **Nothing else** — no headings,
  code, quotes, underline, strikethrough, tables or checklists, and no images
  because attachments cover those. The vocabulary is small because the team's
  real content needed nothing more (measured, not assumed) and because a small
  vocabulary is what makes the round trip provable.
  `packages/shared/src/richtext.ts` is the one definition; `RICH_VOCABULARY` is
  the list.
- **Markdown is storage the user never sees.** Both editors are WYSIWYG with a
  toolbar. Nobody types syntax — that was the whole objection to markdown in
  2026-07-20 and it still stands.
- **ESCAPING IS THE CORRECTNESS CORE, not a detail.** The escape set is exactly
  the parse set: `\`, `*`, `[` and a line-leading `-`/`+`/`N.`. Deliberately NOT
  `_`, backtick or `~` — outside the vocabulary, so escaping them would store
  `snake\_case\_name`, noise in a field a backfill script will one day read. The
  hand-written list is **not** the correctness criterion; the criterion is
  `parseRich(serializeRich(doc))` equalling `doc`, enforced by seeded fuzz. Add a
  character to one list and you must add it to the other.
- **Autolinking of bare URLs is RENDER-TIME ONLY.** Storage keeps exactly what
  was typed. If either editor rewrote a bare URL, the same keystrokes would store
  different bytes on a phone than in a browser — which is why `linkRegex={null}`
  on native and no AutoLink plugin on web.
- **The editor is the ONLY thing split by platform.** Lexical on web,
  `react-native-enriched-html` on Android, both behind one markdown-in/
  markdown-out contract and one `richtextHtml` seam. The renderer, toolbar,
  mention policy and converter are shared — `RichText` in particular must never
  gain a `.web` sibling, or the two surfaces could disagree about what a card
  says. `docs/RESEARCH-RICH-TEXT.md` records why, and what the spike measured.

## Brand, theme and UI conventions

**BRAND COLORS ARE FIXED.** `docs/BRAND.md` is the authority — it restates the
designer's **Option 1** palette (2026-07-21), which **supersedes** the older
`docs/brand/sabeel-color-usage-guide.jpg` (kept for history only). The same
palette is shared exactly with the sibling time-tracker. **Consult BRAND.md
before ANY design or color decision** — new screens, components, illustrations,
charts, anything. Warm Ivory `#F6EBDD` (foundation) / Soft Sage `#A8B89A` (calm)
/ Dark Raspberry `#83114F` (brand identity, used with purpose) / Antique Gold
`#C6A15B` (sparingly) / Mushroom Taupe `#A58D7A` (support).

**All color goes through semantic theme tokens**, and the app is a **single light
theme — no dark mode** (decided 2026-07-21; the derived dark palette was removed,
not disabled). Never hardcode a color; the ESLint rule will reject it.
`app/src/theme/palette.ts` is the only exception and is where the brand palette
lives. The `Caption`-vs-`Hint` question BRAND.md raised is **settled and
applied**: `Caption` is only for text you could delete without losing
information, 35 sites moved to `Hint`, seven genuinely disposable ones stayed,
and `Body`'s `muted` variant was **removed** rather than left unused. `text.muted`
itself is deliberately NOT darkened — that would collapse it into
`text.secondary`.

- **Ordinary actions are icons, not labelled buttons.** Edit, delete, move,
  archive, assign, close — these have settled conventions, and a full-width
  labelled button for each costs a row of vertical space every time. This was got
  wrong three separate times (comment actions, the description editor, the
  bulk-selection bar) before it was written down, and a fourth on the board
  itself. Give every icon an `accessibilityLabel` carrying the word it replaces.
  Use `IconAction` in `components/ui.tsx`, which lays out a real **44x44 box** —
  deliberately NOT `hitSlop`, because neighbouring slops overlap and the touch
  goes to whichever one the platform feels like. **Reserve labelled buttons for
  the primary action of a screen** — `+ Add card` is the board's, so it keeps its
  label while everything beside it is an icon.
- **A destructive action needs a CONFIRMATION, not a label** (narrowed
  2026-07-30). An icon plus "are you sure" is safer than a labelled button with
  nothing behind it: permanent delete in the archive shipped as a bare labelled
  button that fired on first tap, one row away from Restore. Confirm, then the
  icon is free to match every other row action.
- **Back is ALWAYS the `arrow-back` icon, labelled `Back`, in the header row.**
  Never the word. `Screen` is layout-only and every screen hand-rolls its header,
  so nothing enforces this — it was split 7 icons to 7 words before it was
  written down. A control that RESETS to a root instead of popping one screen is
  a different action and gets a different name (`All boards`, `Inbox`), which also
  keeps `getByRole('button', { name: 'Back' })` unambiguous.
- **ONE icon ink size — 24 — for every `IconAction`, and the 44x44 box is what
  spaces them.** Four sizes were in use (13/18/22/24) with no rule, three of them
  on the card screen alone. Ink and crowding are independent here: the box is
  fixed, so a bigger glyph fills a target already reserved and cannot push a
  neighbour closer. Crowding is the GAP, held at `space.sm` or more. Raw
  `<MaterialIcons>` used as inline metadata (a paperclip on a card face) keeps its
  own small size; it is ornament beside text, not a target.
- **A control that floats over content must fit on one row WHERE IT CAN, and wrap
  rather than bleed where it cannot.** The bulk bar sits on top of the board:
  every row it takes is a row of board the user cannot see. But six 44px actions
  need 304px and a 320px screen gives 264, so "one row" was not achievable — it
  pushed the page sideways and took its own close button off-screen. Dismiss moved
  up beside the count, which left five actions that do fit. **Note Yoga defaults
  `flexShrink` to 0, unlike CSS**: a row that should wrap will instead overflow
  until something is allowed to give.

## State, queries and data

- **A live query has THREE states, not two.** `LiveState` reports
  `data: undefined` for loading AND error, so `?? []` claims "there is none of
  this" when the truth may be "we could not find out". Every failure also
  publishes to a global banner `Screen` renders — keep that banner OUTSIDE the
  scroll container, or it is invisible to anyone scrolled down. Where the value is
  a figure someone might act on, branch on `status` explicitly.
- Live Firestore reads in `app/src` go through a single `useLiveQuery`/`useLiveDoc`
  module — never hand-roll `onSnapshot` state in a hook (lint-enforced). See
  `docs/INHERITED-STACK.md` for why this is non-negotiable. Both take the
  query builder FIRST and its `deps` SECOND, the only shape
  `react-hooks/exhaustive-deps` (an error here) can check; keep that order.
- **Live reads are timed to the SERVER's answer, not the first snapshot**
  (`slowReads.ts`, wired in `liveQuery.ts`), and reported at warning past 5 s,
  like slow writes; a read abandoned unanswered past 5 s too. A cached partial
  answer is what made a list look loaded while it was not. The timing is a
  second listener with `includeMetadataChanges`, which shares the target and
  costs no reads; do not fold it into the hook's own listener, which would then
  re-render every screen on every metadata flip.
- **Every active filter must be visible and removable, even a broken one.** An id
  can outlive what it points at (a deleted label, an archived board), and building
  chips by filtering a live list down to chosen ids makes a dead id vanish from
  the UI while it keeps narrowing the results — empty screen, no cause, nothing
  to tap.
- **Deliberate view state belongs in `app/src/viewState.ts`, not `useState`.**
  `App.tsx` renders one screen per route, so opening a card unmounts the screen
  behind it. A search, a filter or a chosen tab must outlive the unmount or Back
  returns you to a blank screen. Derived updates use the FUNCTIONAL form — two
  taps in one batch otherwise both read the same snapshot and one is lost.
- **A TEXT DRAFT BELONGS TO THE COMPONENT THAT OWNS THE FIELD — never to the
  screen.** A draft changes on every keystroke, so a screen holding one re-renders
  every live-query list, markdown render and `.map` it draws, per character.
  Measured: 45ms/char on a card with 25 comments (a ~22 char/second ceiling,
  reported from a phone as "unusable on Android, like a slide show on web"), and
  21.1 vs 4.8 ms/char for the comment box on a busy card against an empty one.
  Own the draft locally and take `run`/`busy`/`onError` from the parent. Three
  shapes, chosen by lifecycle: `ColumnNameEditor` (one `string | null` owns
  editing AND the text, so they cannot disagree), `BoardNameEditor`/`AddCardForm`
  (unmount-scoped — the component renders only while editing, so the lifecycle IS
  the reset and a dirty flag would be wrong), and `CardDescription` (draft + dirty
  + reseeding effect, ONLY where the parent keeps it mounted and re-feeds the
  server's copy).

  **This does not contradict the `viewState.ts` rule; they are complements, and
  the distinction is survival.** A search or a chosen tab must OUTLIVE the
  unmount, so it goes in the store. A draft is discarded on cancel and must NOT
  outlive it, so it stays local. `scripts/typing-perf-e2e.mjs` guards this by
  asserting a RATIO between a busy screen and an empty one — never absolute
  ms/char, which moves over 3x per run on a shared runner. Do not "protect" a
  screen by memoising its lists instead: that was tried, it works, and it leaves
  inert machinery plus a standing requirement that every prop stay referentially
  stable forever. The three such wrappers were removed once the drafts moved, and
  the ratios held.
- **An editor closes only once its write LANDS.** Closing first and handing the
  write up afterwards means a failed save takes your text with it and leaves an
  error pointing at something you can no longer see. So `close()`/`setDraft(null)`
  goes INSIDE the `run` callback, after the `await`. This is why editors take
  `run` plus a raw write that may reject, rather than a pre-wrapped one: `run`
  resolves even on failure, so anything sequenced after it runs regardless.
- **Card ordering is fractional string ranks** in `@sabeel/shared`; a move is one
  document write. Never reintroduce an array-of-ids ordering.
- **Stats are server-written, ADMIN-gated, and must never be able to break what
  they count.** `recordStat` runs AFTER the primary work commits and never
  rejects: `guardedEvent` rethrows, so a throw inside a trigger retries it, and
  `onCardWritten` writes activity with generated ids — a retry would duplicate a
  card's history rather than repair it. On the attachment paths the counter sits
  inside the existing winner-only transaction branches, never above them. Day keys
  use `ORG_TIMEZONE`. Drift is acceptable only because
  `scripts/backfill-stats.mjs` rebuilds any range from the source documents;
  `bytesRemoved` is the one series that cannot be reconstructed.

---

# Working in this repo

## Stack (locked — mirrors the time tracker)

- **Android 13 (API 33) is the floor**, set explicitly in
  `app/android/app/build.gradle` rather than inherited from Expo's default of 24.
  Android 12 and older are unsupported (decided 2026-07-27). That is what lets the
  photo picker be permission-free and both external-storage permissions be removed
  outright — on 13+ the system photo picker needs neither.
- One Expo codebase (`app/`) on **three** surfaces: Android (local Gradle builds,
  committed `android/`), **iOS** (added 2026-08-01, Xcode builds on a cloud Mac
  or on GitHub's macOS runners, `app/ios/` gitignored) and web via react-native-web
  (`expo export --platform web` → Firebase Hosting). **NO EAS** on any of them.
  Platform seams as `.web.ts(x)` siblings.
- **`app/android/` is committed and hand-edited; `app/ios/` is a build product.**
  So `npx expo prebuild` must ALWAYS be scoped: `--platform ios`. Prebuild
  defaults to **clean** — it deletes and regenerates the native folder, and
  `--no-clean` is the opt-out — but it only clears the platforms you name. A bare
  prebuild therefore wipes `android/` and silently drops `minSdkVersion 33`.
  Because `ios/` is regenerated, **nothing changed in Xcode's UI survives**;
  anything that must persist belongs in `app/app.json`. `docs/IOS-BUILD.md` is the
  runbook, and `npm run check:ios` guards the config that fails late.
- **iOS signs two ways, and a runner only ever MANUALLY.** The Mac signs
  automatically through the Admin App Store Connect key. GitHub's
  `.github/workflows/ios.yml` sets `IOS_PROFILE_NAME`, and `sabeel-ci build-ios`
  then signs the app target alone with the team's one Apple Distribution certificate
  (shared with the LMS and the time tracker) and an App Store profile, both from
  secrets. Never let automatic signing run on a runner: a fresh machine mints a
  certificate every run and throws its key away, until Apple's per-team limit
  stops every build, the other two apps' included. The certificate and profiles
  expire 2027-10-16; `docs/IOS-BUILD.md` § Renewal has the steps.
- **One version string for all three surfaces.** `expo.version` only — never
  `ios.version`, which would override it and show Apple a different number.
  Gradle derives `versionName` and `versionCode` from it, and Android's
  versionCode and the iOS build number are both `major * 1000000 + minor * 1000
  + patch` (0.12.2 is 12002): `app.json` states no `android.versionCode`,
  `npx sabeel-ci release` writes `ios.buildNumber` with the version, and
  `npx sabeel-ci check-app` fails when they disagree. `sabeel-ci check-version`
  (in `npm run lint`, `web:export` and the Play bundle) holds the version to
  Apple's `X.Y.Z` shape. Every version goes to TestFlight once, from its tag.
- Firebase **JS SDK on all surfaces** (not react-native-firebase — no web support).
- **Push goes through two services, and an iPhone's token is never FCM's.** The
  JS SDK has no messaging on a phone, so an iPhone registers Apple's own device
  token, and `functions/src/messaging.ts` sends it straight to Apple
  (`apns.ts`, the `APNS_KEY` secret); Android and the web go through FCM. A
  device's row is `PushTokenDoc`, exactly two shapes, rules-enforced, and an
  iPhone's names the Apple service that issued its token. Every function that
  sends binds `PUSH_SECRETS` (`pushSecrets.test.ts` finds them). Sending never
  throws: `notify` writes the inbox first with generated ids, so a retried
  trigger would duplicate every entry, and a lost push is recoverable from
  Alerts while a doubled inbox is not. `docs/IOS-BUILD.md` § Push on the
  simulator is how to prove it without a phone.
- Backend: Cloud Functions (TS, nodejs22, us-central1) + Firestore + **Cloud
  Storage** (card attachments). The bucket must be a modern
  `*.firebasestorage.app` one in us-central1/us-west1/us-east1 — only those get
  the no-cost quotas. Sentry on web/native/functions.
- Monorepo (npm workspaces): `app`, `functions`, `packages/shared`. Shared types
  and any cross-surface pure logic live in `@sabeel/shared` — the app and
  functions must never each hold their own copy of a rule.
- Role and status live in **custom claims** (rules trust the token), mirrored
  onto the user doc for UI display only. The sign-in and approval rules
  themselves are stated once, under Authority above.
- Config-as-code: `firestore.rules` / `firestore.indexes.json` / `storage.rules`
  deploy from the repo, never console-edited.
- Versions to match: Expo ~57, RN 0.86, React 19.2, firebase ^12,
  firebase-functions ^7, TypeScript ~6.0, Vitest ^4, ESLint ^9 flat config, Node 22.

## Dev & test loops

`docs/DEVELOPING.md` is the full guide, including how to install the toolchain on
a new machine.

- **This checkout owns the emulator block 61200-61299** (`emulators.base` in
  `ci-tools.json`): the emulators at 61200-61209, the web dev server at 61210.
  Time Tracker owns 61000+, the legacy recording app 61100+ and LMS 61300+.
  Were they all on Firebase's defaults, whichever suite started second would
  kill the other's Firestore. Every service sits at the same offset in every
  block, so `61203` reads as "Kanban, functions" in a `ps` line, which is the
  diagnostic that was missing when one session killed another's emulator.
  Scripts read ports and the demo project from ci-tools
  (`scripts/lib/emulators.mjs` in Node, `npx sabeel-ci ports <name>` in shell)
  and state none, comments included; `firebase.json` and `app/src/env.ts` state
  them, and `sabeel-ci check-app` holds both in step. `npm run emulators:free`
  (`sabeel-ci free-emulator-ports`) stops only this checkout's leftovers on the
  block and names anything else holding it.
- **NEVER match a process by pattern — not to kill it, not to WAIT for it.**
  `pkill -f "firebase emulators"` matches a sibling checkout *and this shell's
  own command line* (exit 144 mid-run). The same trap wearing a different hat is
  `pgrep -f "e2e.sh"` inside a waiter: the waiting shell's own command line
  contains the pattern, so `until ! pgrep -f ...` waits on itself, forever. That
  one cost three separate wedges in a single session — after the `pkill` half of
  this rule was already written down, which is why it is now stated as one rule
  about matching rather than one about killing. Wait on a **pid** (`kill -0`),
  on a **file** the job writes, or on the harness's own completion signal.
  For ports, go through `scripts/dev.sh` rather than inspecting them by hand.
  `scripts/lib/procs.sh` is the ONE answer to "who holds this port", "what is
  this pid's cwd" and "what is under this pid", shared by `dev.sh` and
  `e2e.sh`. `ss` and `grep -oP` are Linux-only and `lsof` is absent from a
  non-interactive Linux shell without the toolchain env, so it picks whichever
  exists and the callers fail loudly up front if neither does: an empty answer
  must mean "nothing holds it", never "I could not look".
- **The dev scripts stop ONLY what they started.** `dev.sh` starts each
  long-lived job in a process group of its own and records it in `.dev-pids`;
  `stop` signals those groups and nothing else, then REPORTS — never kills —
  anything still on this checkout's ports, with its pid and cwd. Metro 8081 and
  idb 10882 are machine-wide: `status` shows them, nothing frees them, and
  `android`/`ios` refuse to start Metro on a held 8081. `e2e.sh` records its web
  server's pid, stops it and every descendant on exit (signals included), and
  fails the run if it cannot; it refuses a held web port rather than killing it.
  `functions/test/unit/devScripts.test.ts` holds the shape: no `pkill`, no raw
  `kill`, no `exec firebase`. Freeing ports by number killed another checkout's
  Metro and every session's `idb_companion` on the build Mac.
  To find an owner by hand on Linux:
  `readlink /proc/$(ss -lptn "sport = :$PORT" | grep -oP 'pid=\K[0-9]+' | head -1)/cwd`.
- **Run e2e suites with `scripts/e2e-all.sh`, never a hand-rolled chain.**
  `e2e.sh` runs ONE suite because CI wants it that way (each browser suite is an
  npm script, `test:screens`, `test:e2e` and `test:e2e:<name>`, listed in
  `ci-tools.json`'s `ci.browserSuites`); locally that invited ad-hoc loops, and
  the loops were the problem — two chains each calling `dev.sh stop` killed each
  other's dev server, and the corpse held a port that failed the next run.
  `e2e-all.sh` runs CI's list one at a time, verifies **every** port in the
  block is free before each (not the three you remember), and refuses to start
  rather than reporting a skip. `scripts/e2e-all.sh richtext web` for a subset.
- Unit: `npm test` (Vitest: functions, shared and the app's plain `.ts`).
- Rules/integration: `npm run test:emulator` (`sabeel-ci test-emulator`; needs
  JDK 21, which `npx sabeel-ci jdk21` finds). Two passes: `test:emulator:rules`
  without the Functions emulator, which first rehearses the board-ownership
  migration scripts end to end (`scripts/migration-e2e.mjs`), then
  `test:emulator:functions` with it. `npm run emulators` leaves the emulators
  running for a dev server.
- Web: `npm run dev:web` (or `scripts/dev.sh web`) — these set
  `EXPO_PUBLIC_USE_EMULATORS=1`. Bare `npx expo start --web` in `app/` does NOT,
  and points at **production Firebase**; nothing in the UI says which backend you
  are on.
- Native flows: `npx sabeel-ci native-e2e` — the Maestro flows in `maestro/`
  on the emulator against the debug build, the same command the Native workflow
  runs on main pushes and release tags; `--ios` runs them on an iPhone simulator
  (macOS). `docs/DEVELOPING.md`.
- Android: `npx sabeel-ci emulator headless` (AVD `tb_emu`, or `SABEEL_AVD`), then
  `npm run android -w @sabeel/app`. Firebase emulators from the AVD = `10.0.2.2`.
  There are NO physical devices. **Check `emulator -accel-check` first** — see
  Verification below.
- **Metro port 8081 is shared with the sibling RN projects on this machine** — the one emulator-facing port that is NOT in the block above, and cannot be
  (time-tracker, PineTimeCompanion). The emulator reaches Metro at
  `10.0.2.2:8081` — the host directly — so `adb reverse` does NOT redirect it and
  the port cannot be moved without rebuilding the native app. Whoever holds 8081
  serves this app. `sabeel-ci preflight-metro` (wired into `npm run
  android`/`start`) refuses to start when 8081 belongs to another project. Symptom
  if bypassed: a red screen quoting *another repo's* module paths after a
  perfectly successful build.
- CI (GitHub Actions): `sabeel-ci check-app` + lint + typecheck + knip + unit +
  emulator + every browser suite on every push. Keep it green; `npm run knip`
  must be clean (`docs/DEADCODE.md`). **Nothing deploys on a push.** The one deploy CI
  can make is the TestFlight job of `ios.yml`, which runs only when started by
  hand with `testflight=true`, and only with Faisal's go-ahead, like any
  release. Its build job uploads nothing and may be run at any time.
- **A suite nothing invokes is not coverage.** `functions/test/unit/suite-coverage.test.ts`
  guards the emulator lists and `app/src/ciCoverage.test.ts` guards the e2e ones;
  a new browser suite gets an npm script and an entry in `ci-tools.json`'s
  `ci.browserSuites` (then `npx sabeel-ci workflows`). `app/` runs plain `.ts` unit tests only —
  anything needing a renderer belongs in an e2e suite.

## Verification — what counts as evidence

**Never claim a screen works because the code looks right.** Look at a rendered,
authenticated screenshot. A colour change once shipped blind and had to be
redone: content text had drifted to `text.muted` (~2.7:1), every token value was
correct, and only the *rendered* authenticated screen showed it.

**A check that cannot fail is a screenshot generator.** The tour that
`screens-e2e.mjs` replaced sat entirely inside a try/catch that logged and
continued, so it reported success either way — and it had rotted to clicking
"People" as a top-level button long after that moved into the More sheet.

### The width sweep is the DEFAULT check for layout, on both surfaces

```sh
npm run test:screens                       # the CI set
SWEEP_WIDTHS=320 npm run test:screens      # while iterating
```

Every authenticated screen at five widths straddling the breakpoint — including a
card with the description editor open and one with the comment composer in use,
because an editor is its own layout — each screenshotted to `shots/screens/` AND
asserted: no sideways scroll, no same-layer control overlap, a way out of every
screen, the right board layout. The widths straddle the breakpoint rather than
looking thorough: a layout bug on one side of it is invisible from the other.

**Prove a change on the web app unless it touches a seam a browser cannot
reach.** That is the default for layout, flows, rules, data and copy — not only
for shared components and the theme. The browser suites are faster and more
thorough than a human on an emulator, and they are what makes the emulator
unnecessary for routine work.

### The Android emulator is reserved for the seams a browser cannot reach

Not for routine layout work. Use it for:

| Seam | Why the browser cannot cover it |
|---|---|
| **The rich-text editor** | The only thing split by platform — Lexical vs `react-native-enriched-html` |
| **Flex shrink / wrap / overflow** | Yoga ≠ CSS. See the bulk-bar rule above |
| **Keyboard / IME** | Emulators misreport IME insets; `edgeToEdgeEnabled=true` makes `Keyboard` events no-ops |
| **Gestures** | Long-press-to-select and the column swipe have no web path. The pager *layout* does render on web at 320px — it is the gestures that do not |
| **Native modules** | Image/document pickers, sharing, FCM, intent launcher |
| **Safe area / insets** | No browser equivalent |

Plus **before a release**, and whenever Faisal asks. That pre-release pass is
mandatory, not optional — see `docs/PHASE_STATUS.md` 2026-07-30 for the shape of
one that was actually executed.

**Check who owns the AVD before booting it.** There is one `tb_emu` on this
machine and all three Sabeel repos default to it, so a boot can walk into
another session's run. `npx sabeel-ci emulator headless` refuses to boot it
twice and names the process running it; to look first:

```sh
ps -eo pid,args --no-headers | grep "[q]emu-system"   # empty = no AVD running
```

Use that, not `adb devices` — `adb devices` *starts* a daemon as a side effect,
and a live adb server does **not** mean an emulator is running. If one is
already running it belongs to someone else: ask before killing it or starting a
second. The box has 15 GiB of RAM and a 16 GiB swapfile, so a second AVD (~5 GB)
will swap rather than be killed outright — and an AVD that is swapping is slower
than the software renderer already is.

**Why this is safe, and exactly where it is not.** react-native-web resolves
flexbox through the browser's engine, so a narrow viewport tests *your layout
intent* but not *Yoga's behaviour*. The one documented native-only layout bug in
this family was precisely that — a button shrinking below its basis, which "never
reproduced under react-native-web at any width" (sibling recording app,
`docs/PHASE_STATUS.md` 2026-07-24). That is the gap, and it is narrow enough to
name rather than to fear.

**Two traps when you do run native:** a debug build loads its JS **from Metro at
launch**, so `EXPO_PUBLIC_USE_EMULATORS` must be set when Metro starts and Metro
must be restarted with `--clear` after config changes; and `expo run:android`
printing BUILD SUCCESSFUL is **not** proof the APK installed (if the shared AVD
drops mid-run, a stale build stays on the device). Confirm with
`adb shell dumpsys package com.sabeelinstitute.kanban.debug | grep versionName`
before trusting a native screenshot.

**The AVD wants hardware virtualization, and `sabeel-ci emulator` works out the
flags for itself.** It runs `emulator -accel-check` per launch: on a host with
KVM it changes nothing and the emulator runs at full speed, which is the normal
case and the expected way to verify Android. Only a host without it gets
`-accel off`, and the script says so on stderr.

**Always start it through that command, never by hand.** `-accel auto` — the
default — does NOT fall back for an x86_64 image; it refuses outright with
*"x86_64 emulation currently requires hardware acceleration!"* and exits at
once, which reads as a broken emulator rather than a missing CPU feature. Only
an explicit `-accel off` selects QEMU's software CPU. `-gpu
swiftshader_indirect` covers the GPU alone and never substituted for it.

On an unaccelerated host expect several minutes to boot and ~14 s per
screenshot: input is fine, a screenshot sweep is not, so prefer the browser
suites there and keep the emulator for the seams in the table above. Builds are
unaffected either way — Gradle needs no KVM.
`../agent-skills/skills/expo-firebase-stack/tools/check-host.sh` gives the
verdict for a machine.

**`adb input` cannot drive the rich-text editor, so it cannot verify a mention.**
Attempted 2026-08-29 on an unaccelerated AVD: the app installs, signs in and
renders every screen, and `adb shell input text` reaches the composer on the
FIRST focus — but once focus leaves the editor, no `input tap` restores it, and
subsequent text lands nowhere or in another field. The @mention popover only
opens while the editor reports focus, so it never appeared, and that is a
property of the harness rather than evidence about the feature. Verifying
anything behind the editor's focus or IME needs a real keyboard: a device, or an
accelerated emulator you can type into. Screenshot the RESULT, do not infer it
from an `input text` that appeared to succeed. On an accelerated emulator,
`maestro/board.yaml` does type into the editor on its first focus, bold a word
and save it, and checks the saved text; the mention popover is still unverified.

Two checks worth running before reaching for a device at all, since they catch
the native failures that otherwise only show up there:
`npx expo export --platform android` proves the whole native module graph
resolves and every worklet compiles, and transforming a file through
`babel-preset-expo` proves a `'worklet'` directive really became a worklet
factory rather than being silently dropped.

## Secrets (zero tolerance)

- **THIS REPO IS PUBLIC** (confirmed 2026-07-29). Everything committed here —
  including every doc, comment and commit message — is world-readable, and so is
  the entire history: removing something later does not unpublish it. Audited on
  that date and clean, and it stays that way only if the bar below is held.
- **Nothing about the nonprofit's real data or people goes in.** No real names or
  email addresses (the fixtures are `faisal`/`sara`/`omar`, none of which is a
  real account), no board or card contents, and **no production figures** — how
  many admins there are, how many cards were created in a week. Recording that a
  count was *verified* is fine; recording the count is not. Screenshots must come
  from the emulator seed, never a real session.
- NEVER ask for, accept, or echo real API keys/DSNs/tokens in chat; never hardcode
  them. Server secrets: output the exact `firebase functions:secrets:set NAME`
  command for Faisal to run.
- Client-side non-secrets (Firebase web config, `WEB_CLIENT_ID`,
  `google-services.json`, `firestore.rules`) are committed **by design** — rules
  are enforced server-side, so this is security by design, not obscurity.
- Client DSNs go in gitignored `.env.local` (key names only in docs).

## Division of labor

- Agent: all code, rules, indexes, tests, emulator runs, CI, exact click-by-click
  console checklists, diagnosing pasted logs.
- Faisal only: third-party consoles (Firebase/GCP, Sentry, Play Console, App
  Store Connect, the Apple Developer portal), OAuth/SHA-1 registration,
  anything with production secrets. He is already comfortable with these
  consoles — give him precise steps, not tutorials. Everything Faisal must do
  himself is tracked in `TODO.md` — keep it current. What a releaser needs
  access to is `docs/DEPLOY.md` § Access.

## Conventions

- Work ships as **numbered releases**; commit at the end of a coherent change and
  work autonomously within one. Every release gets an entry in the **deploy log**
  in `docs/PHASE_STATUS.md` (`## Deploy log`, newest first, each headed
  `### <YYYY-MM-DD> — <summary> — vX.Y.Z`), written with the version bump —
  `sabeel-ci build-aab` refuses to build without one and `sabeel-ci check-app`
  fails CI without one for app.json's version, so a missing entry fails the
  release rather than being noticed afterwards. It is the release notes (the
  release pull request and the GitHub release take their title and text from
  it) and the only record of why.
- **The user manual is part of the app.** A change to any screen means
  `docs/USER-MANUAL.md`, then `node scripts/manual-shots.mjs` for its images, then
  `npx sabeel-ci render-manual` for the PDF (needs `uv` and `google-chrome`) —
  all three, same batch. Add new
  screens to the generator; an image with no generator goes stale unnoticed.
  User-visible changes ship with their documentation in the same batch as the
  code — never let the manual lag a release.
- Before ANY significant install (global/system/major framework), ask first;
  routine project-local npm deps of the locked stack are fine.
- All repo artifacts (docs, plans, protocols) live in this repo.
- **Deploying needs Faisal's go-ahead** (set 2026-07-25). Do everything up to and
  including the commit, then **stop and show him what is ready**. Once he says go,
  ship **every** surface in one batch; never ask platform by platform. The gate
  exists because a release is only reversible *forwards*, through another release.
  The surfaces are **the backend when it changed, web hosting, the APKs on the
  GitHub release, Play internal testing and TestFlight** — `docs/DEPLOY.md`
  § Shipping a release has the order, and the order matters: **merge into
  `main` first**, by pull request (a GitHub Release cannot attach to an
  unmerged commit), and **build the artifacts after the last commit** or they
  stamp a superseded hash onto the sign-in screen. Releases go in two steps,
  because main takes changes only by pull request: `npx sabeel-ci release X.Y.Z
  --notes <entry>` writes the version and the iOS build number, moves the
  manual's version line and renders its PDF, adds the deploy-log entry
  (`<entry>`, heading first) and opens the release pull request; after Faisal
  merges it, `npx sabeel-ci release --ship` on main builds the Play bundle and
  the arm64-v8a and universal APKs, cold-starts the universal APK on the AVD
  (`sabeel-ci check-release`), creates the GitHub release `vX.Y.Z` with the
  APKs and the manual, and publishes to Play internal testing. It prints the
  two runs that put the same commit on the web (`gh workflow run
  web-deploy.yml -f build_run_id=<the Web run> -f deploy=true`) and on iPhones
  (`gh workflow run ios.yml --ref vX.Y.Z -f testflight=true`). **Never
  hand-bump versions.** Store decisions — tracks, testers, App Review — are
  `docs/STORE-RELEASE.md`.
- **Android ships through Google Play** (decided 2026-08-02), release-signed:
  internal testing now, to the account-wide "Sabeel staff" email list
  (`docs/DEPLOY.md` § Testers); public production is the destination
  (decided 2026-10-16, `docs/STORE-RELEASE.md`).
  `npx sabeel-ci release --ship` builds and publishes; alone, `npm run
  build:aab` (`sabeel-ci build-aab`) builds the bundle and `npx sabeel-ci
  publish-play --internal` uploads it — through the Play Developer API, so it
  needs no browser, with the key `~/keys/sabeel-play-publisher.json` (or
  `PLAY_KEY`). `publish-play --check` proves every gate and the Play permission
  without uploading anything. Play Console is still required for the things the
  API cannot do: granting permissions, testers, and reading the app-signing
  fingerprints. Play wants an **AAB**, not APKs: one artifact carrying every
  ABI, from which Play generates per-device splits. The `splits` block in
  `app/android/app/build.gradle` therefore switches itself **off** for bundle
  tasks — both on at once fails with *"Multiple shrunk-resources files found"*.
  `sabeel-ci build-aab` holds every gate: store-legal version, a deploy-log
  entry that exists *before* the build, the native Sentry DSN
  (`EXPO_PUBLIC_SENTRY_DSN_NATIVE` in `app/.env.local`), and a signature that
  is not the debug key; `publish-play` completes a release only once Play signs
  the installed APKs with `ci-tools.json`'s `release.appSigningCertificate`.
- **Signing: the upload key lives outside the repo**, with a copy in the vault;
  a missing one is restored from there, never generated (`docs/SECRETS.md`).
  `signingConfigs.release` reads `~/.config/sabeel-kanban/keystore.properties`,
  or the file `SABEEL_KEYSTORE_PROPERTIES` names (as `sabeel-ci ci-platform`
  sets it in CI). Absent it, Gradle refuses to package a release build: it
  fails closed and never falls back to the debug keystore committed to this
  **public** repo. **Play App Signing re-signs with Google's own key**, so
  the SHA-1 that matters for Google Sign-In on a Play install is under Play
  Console → App integrity → *App signing key certificate*, NOT the upload key's.
  Both belong in Firebase; miss the former and sign-in fails with
  `DEVELOPER_ERROR` for Play users only, while local builds work.
- **Android distribution:** testers install through Play internal testing.
  `npx sabeel-ci release --ship` attaches the arm64-v8a and universal APKs
  (`sabeel-institute-kanban-<abi>.apk`) and the manual to the versioned
  Institute repository release, never to a personal website. Sideloaded APKs use the
  upload key; Play installs use Google's app signing key and cannot replace
  those APKs.
- **Never `git add` a binary.** APKs belong in GitHub Release assets.
- **Publisher checks must not upload.** Use `npx sabeel-ci publish-play
  --check` and `npx sabeel-ci release X.Y.Z --dry-run` when verifying the
  publishing gates.
