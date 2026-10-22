# Dead code

```sh
npm run knip      # unused files, exports and dependencies
```

CI runs it in the quality job on every push and pull request
(`ci.knip` in `ci-tools.json`). This is a greenfield project with no external
consumers, so **anything unused gets deleted, not deprecated** — code kept
"in case" is a liability, and nothing here is load-bearing for anyone outside
this repo.

## What a clean run looks like

**Empty.** No category reports anything. A finding is either dead code to
delete or a gap in `knip.json` to close at its cause, never a reason to widen
an ignore list. Two shapes of *config* gap to recognise:

- A workspace gains a runner or entry point knip does not know about, and its
  files come back as "unused files": list them as entries in `knip.json`.
- `scripts/*.mjs` import a package the root does not declare, which resolves
  only because npm hoisted it out of another workspace. Declare it at the root.

**A workspace that uses a package must declare it**, even in a monorepo that
hoists. Hoisting is a resolution accident, not a dependency.

## How `knip.json` is set up

The same shape as the sibling LMS and time tracker:

- **Entries per workspace.** The root's are `scripts/*.mjs`. The app's are
  `App.tsx`, `metro.config.js`, `public/**/*.js` and the `.web` seams.
  The functions' are `src/index.ts`, because the bundle is built by esbuild
  and nothing maps `main` (`lib/index.js`) back to the source, and the tests.
- **`ignoreExportsUsedInFile` for types and interfaces**, so a type exported
  beside the function that takes it is not a finding.
- **The app ignores `expo-updates`, `@expo/metro-runtime` and
  `expo-system-ui`.** knip's Expo plugin infers them from Expo's own defaults
  and attributes them to `app/app.json`, where none of them appears. Do not
  install them to quiet the report.
- **`ignoreBinaries`: `firebase` and `expo`.** `firebase` is the global CLI;
  `expo` is the app workspace's own, which the root's `dev:web` and
  `dev:android` run from `app/`.

## Two things knip gets wrong here, and one you must not "fix"

**Platform seams.** `Foo.web.tsx` is resolved by the bundler, not by an import,
so knip sees those files as unreachable. `knip.json` lists them as entry points.
If you add a new seam, nothing breaks — but knip will start reporting its web
half as unused until the glob covers it.

**Symbols used only from a `.web.tsx`.** knip can report an export as unused
when its only consumer is a platform file. `rerankColumnIfNeeded` was deleted on
exactly that basis and the compiler caught it immediately. **Grep across `.ts`
AND `.tsx`, then typecheck, before believing the report.**

**`@sabeel/shared` must never be listed in `functions/package.json`.** It is
bundled into `functions/lib/index.js` by esbuild, and listing it there makes
Cloud Build try to install a private package from the public registry, which
fails the deploy (`docs/INHERITED-STACK.md` lesson 3b). The root declares it
(`"@sabeel/shared": "*"`, for the scripts that import it), and that is what
knip accepts for the functions workspace too; this paragraph exists so the
next person does not "helpfully" add it to the functions manifest.
