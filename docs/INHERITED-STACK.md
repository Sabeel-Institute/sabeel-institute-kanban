# Inherited stack — what carries over from the time tracker

Researched from `../sabeel-institute-time-tracker/` on 2026-07-18. This is the
"don't re-derive it" file: concrete shapes to copy, and the expensive lessons that
project already paid for.

## Repo layout to copy

```
sabeel-institute-kanban/
├── package.json               # workspaces: packages/*, functions, app
│                              # prepare/pretypecheck/pretest all build @sabeel/shared first
├── tsconfig.base.json         # strict
├── eslint.config.mjs          # flat config
├── firebase.json              # functions + firestore + storage + hosting(app/dist-web)
│                              # + emulators. NO remoteconfig / extensions.
│                              # (storage was added 2026-07-26 for card attachments;
│                              #  the time tracker still has none)
├── .firebaserc                # the real project id: sabeel-institute-kanban
├── firestore.rules / firestore.indexes.json
├── CLAUDE.md, README.md, TODO.md, docs/
├── ci-tools.json              # this app's settings for the shared CI, release and device
│                              # tooling (Sabeel-Institute/ci-tools, `npx sabeel-ci <command>`)
├── scripts/                   # the app's own: browser suites, seed, grant-admin, migrations
├── .github/workflows/         # rendered from ci-tools' templates (`npx sabeel-ci workflows`)
├── packages/shared/           # @sabeel/shared — types, constants, pure domain rules
├── functions/                 # nodejs22 TS; esbuild bundle; Vitest unit + rules-unit-testing
└── app/                       # @sabeel/app — Expo, react-native-web
    └── src/{screens,components,auth}/ + platform seams as *.web.ts(x)
```

Emulator ports: each app owns a block of 100 in ci-tools (`emulators.base` in
`ci-tools.json`; this one 61200-61299, the time tracker 61000-61099), every
service at the same offset; `firebase.json` pins them, with **storage** among
them, UI on, `singleProjectMode: true`. `docs/DEV-TOOLING.md` has the layout.

Hosting headers worth copying verbatim: `no-cache, must-revalidate` on `**`, and
`max-age=31536000, immutable` on `/_expo/static/**`.

## Lessons paid for in the time tracker

**1. Functions must be esbuild-bundled.** Cloud Build cannot resolve the private
`@sabeel/shared` workspace package from a plain `tsc` output. `functions/build` =
`tsc --noEmit` (typecheck only) + `node esbuild.config.mjs` (the real bundle).
A first deploy failed on exactly this.

**2. A failed first deploy leaves callables permanently 403.** Gen-2 callables get
their public-invoker IAM binding only on the *create* path. If the first deploy
creates the function but the build fails, later update deploys never re-apply the
binding and every client call bounces at the Cloud Run layer before your code
runs. Fix is `firebase functions:delete <names> --region us-central1 --force` then
redeploy. Watch for this on the kanban project's first deploy too.

**3. First deploy of a Firestore-trigger function often fails on the Eventarc
service agent.** Not a config error — permissions take 2–5 minutes to propagate.
Wait and redeploy just the failed functions.

**3b. A bundled workspace package must be removed from `functions/package.json`
ENTIRELY — devDependencies is not enough.** `esbuild.config.mjs` inlines
`@sabeel/shared`, so nothing imports it at runtime, but it was still declared.
Cloud Build died on `404 @sabeel/shared is not in this registry` — the package is
private and local, and only exists inside this monorepo.

Moving it to **devDependencies did not fix it**: the Cloud Functions Node
buildpack installs devDependencies too. It has to be absent from that file
altogether. It still resolves locally, because npm workspaces symlinks every
workspace package into the root `node_modules` regardless of who declares it —
so esbuild finds it at build time with no declaration at all. The sibling
time-tracker has always done it this way; checking the reference implementation
first would have skipped two failed deploys.

Verify the bundle is self-contained rather than assuming:

```sh
grep -c 'require("@sabeel/shared")' functions/lib/index.js   # must be 0
```

**4. `expo export` must always `--clear`.** Metro will otherwise happily serve a
cached bundle built under different `EXPO_PUBLIC_*` env — an emulator-mode bundle
must never ship to Hosting.

**5. Never hand-roll `onSnapshot` state in a hook.** This caused a real
data-correctness bug (`docs/POSTMORTEM-2026-07-16-stale-week.md` in the sibling
repo — worth reading in full before writing the kanban equivalent). The
`liveQuery.ts` module encodes two invariants:
   - State **resets to empty** the instant subscription inputs change, so query A's
     results can't linger on screen while query B's first snapshot is in flight.
   - Listener errors also reset to empty and are surfaced in-app *and* to Sentry —
     a server-rejected listen must never die as a console warning nobody sees.

   Corollary: async UI must be e2e-tested at least once **under injected latency**,
   not just at localhost speed. Kanban drag-and-drop makes this sharper, not
   softer — optimistic local moves reconciling against server snapshots is
   precisely the shape of bug that postmortem describes.

**6. The emulator does NOT enforce composite indexes.** Only production can
confirm them. Any change to `firestore.indexes.json` or to a query shape needs a
production probe after deploy.

**7. Rules duplicate domain logic on purpose.** The time tracker recomputes
`periodKey` inside `firestore.rules` so a client cannot stamp a false value to
dodge a lock. Expect the kanban equivalent: any client-supplied field that gates
a permission must be recomputed or constrained in rules, never trusted.

## Lessons paid for in THIS project

**8. The client's `projectId` must match the emulator project.** The Firestore
emulator partitions data by project id, so a client configured with a different
id talks to a *different database inside the same emulator*. Our client carried
the placeholder `sabeel-institute-kanban` while `emulators:exec --project`, the
Functions runtime and the Admin SDK all used `demo-sabeel-kanban`.

The symptom is genuinely nasty: every write succeeds, the trigger logs success,
the uids match exactly — and the client's listener returns a **server** snapshot
(`fromCache=false`) saying the document does not exist. Because in its namespace,
it doesn't. `singleProjectMode` does not save you here.

Fixed in `app/src/firebase-config.ts`, which swaps in `EMULATOR_PROJECT_ID`
whenever `EXPO_PUBLIC_USE_EMULATORS` is set. Cost about an hour on 2026-07-19.

The debugging lesson generalises: when a listener misbehaves, log
`snap.exists()` **and** `snap.metadata.fromCache` immediately. Those two booleans
separated "never arrived", "arrived from a stale cache" and "the server really
says no" in a single run, after two runs of guessing.

**10. React Native needs `experimentalForceLongPolling` on Firestore.** RN's
networking stack does not support Firestore's default WebChannel streaming
transport. Without long polling the FIRST snapshot arrives and then the listen
stream silently dies — no error, no retry — so any document written a moment
later never reaches the device.

Symptom on 2026-07-19: the account was provisioned server-side, uid matched,
Functions logged success, and the phone sat on "Setting up your account…"
forever, having received exactly one (empty) snapshot from before the write. Web
was already fine; only Android hung. Set in `app/src/firebase.ts`.

Note this and lesson 8 produce an almost identical symptom from different causes,
which is why the `exists`/`fromCache` breadcrumb in `session.ts` earns its keep:
lesson 8 gives `exists=false` forever, lesson 10 gives one snapshot then silence.

**9. `expo export` sets `__DEV__` to false.** Anything gated on `__DEV__` — like
the emulator dev sign-in — is correctly stripped from an exported bundle, which
means e2e flows that need it must drive `expo start`, not the export. We assert
the absence separately, so the safety property is tested rather than assumed.

**11. A long-running `expo start` can go stale and serve a bundle that no longer
matches the source.** On 2026-07-19 a web dev server that had been up for hours
stopped rebuilding on file change. The screenshots after a fix were
byte-identical to the ones before it — which reads exactly like "the fix didn't
work", and cost a wrong diagnosis before the cause was found. Two habits fall
out of it: when a UI change appears to have no effect, **restart the dev server
before concluding the code is wrong**; and compare screenshot *file sizes*, since
byte-identical output across a real code change means the bundle is stale, not
that the change was ineffective.

Launch it with `npm run dev:web`, never a bare `npx expo start --web`: the script
also sets `EXPO_PUBLIC_USE_EMULATORS=1` and rebuilds `@sabeel/shared`. Without
that variable the app points at production config and the dev sign-in row never
renders, which looks like a broken sign-in screen.

**12. react-native-web's `Switch` cannot be themed.** It ignores `thumbColor` and
`trackColor`, and the RNW-specific `activeThumbColor`/`activeTrackColor` are gone
in 0.21 — the thumb renders Material teal (`#009688`), a colour in no part of the
Sabeel palette. `Toggle` in `app/src/components/ui.tsx` is a Pressable and two
Views that we fully control. Do not reintroduce `Switch`.

**13. A bare collection-group `array-contains` needs a single-field index
EXEMPTION, not a composite index.** My Work queries
`collectionGroup('cards').where('assigneeUids','array-contains',uid)` with no
other constraint. Firestore does not index array fields at collection-group
scope by default, so this fails in production with `FAILED_PRECONDITION` while
every emulator test passes — the emulator enforces no indexes at all (lesson 6).
It is a `fieldOverrides` entry in `firestore.indexes.json`, not an `indexes` one:

```json
{ "collectionGroup": "cards", "fieldPath": "assigneeUids",
  "indexes": [{ "arrayConfig": "CONTAINS", "queryScope": "COLLECTION_GROUP" }] }
```

Caught on 2026-07-19 by `npm run probe-indexes`, minutes after the first
production deploy and before anyone opened My Work.

**14. "Deployed" is not "ready" for indexes.** `firebase firestore:indexes`
reports definitions but no build state, so it cannot tell you an index is still
`CREATING` — and a creating index errors on use exactly like a missing one. The
above took ~4 minutes on an EMPTY database. Read the real state with:

```sh
curl -s -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
  "https://firestore.googleapis.com/v1/projects/<project>/databases/(default)/collectionGroups/<coll>/fields/<field>"
```

## Auth model to reuse as-is

Google sign-in only → new user lands `pending` → an **admin** approves. Claims
(`role`, `status`, `admin`) are set exclusively by a `setUserAccess` callable and
are what `firestore.rules` trusts; the user doc mirrors them for display. Rules
are deny-by-default with `isSignedIn` / `isActive` / `isAdmin` /
`canCreateBoards` / `ownsBoard` helpers. First admin after first deploy is bootstrapped by
`scripts/grant-admin.mjs` via gcloud ADC.

## Resolved during design (2026-07-18)

See `docs/PRODUCT_BRIEF.md` for the full decisions. Deltas from the time tracker:

- **Roles map loosely.** The time tracker's member / manager (+ admin flag)
  became a flat member / manager / admin here, and the claims-based account
  approval flow ports essentially unchanged. The roles then **diverged** on
  2026-08-16: this app's are member / organizer / admin, with board authority
  moved OFF the role entirely and onto a `boardOwnerUids` array on the board
  (see `docs/PERMISSIONS.md`). The time tracker has no equivalent — its manager
  role is org-wide and stays that way. What's also new is a **domain
  restriction** (`@oursabeel.com`) that must be enforced server-side in the
  auth-create function — the client `hd` hint is not a boundary.
- **Card ordering: fractional base-62 string ranks**, one doc write per move.
- **Storage.** Attachments were declined at the outset and added on 2026-07-26,
  so the time tracker's no-Storage `firebase.json` no longer copies over as-is:
  this project has a `storage` block, `storage.rules`, and a Storage emulator
  at its offset in the port block (61207).
  The reference implementation is the sibling **recording app**, not the time
  tracker — it is the only Sabeel project that had Cloud Storage first.
- **Timezone machinery is NOT copied.** It was load-bearing for work-local time
  entries; kanban due dates are all-day dates in a single org timezone. Resist
  porting `time.ts` wholesale.
- **Offline:** persistent Firestore cache on web only. React Native has no
  IndexedDB, so `persistentLocalCache` is unavailable there and Android uses the
  memory cache — verified 2026-07-19, brief corrected. Auth persistence on native
  needs `getReactNativePersistence`, which exists in the SDK's react-native build
  but is missing from the default typings (see `app/src/firebase.ts`). No
  conflict-resolution UI in v1.
