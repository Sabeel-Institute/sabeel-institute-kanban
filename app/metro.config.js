// Expo's default Metro config, with TWO changes: the transform cache lives in
// this repo rather than in a directory shared by every Expo project on the
// machine, and Lexical resolves to ONE of its builds rather than both.
//
// This file did not exist before 2026-08-28. Everything else here is delegated
// to `getDefaultConfig`, deliberately — the app built correctly without a config
// at all, so this must not quietly change resolution, watch folders or
// transforms. Each change here is its own decision; the Lexical one (2026-10-13)
// touches resolution for Lexical's packages and nothing else.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

/**
 * Keep the transform cache INSIDE this repo.
 *
 * Expo's default is `os.tmpdir()/metro-cache` — one directory shared by every
 * Expo project here. That would be merely wasteful, except that `--clear` does
 * not clear *this project's* entries: Expo's FileStore sees a root inside
 * `os.tmpdir()` and `renameSync`s THE WHOLE DIRECTORY away
 * (`@expo/metro-config/build/file-store.js`). `scripts/e2e.sh` passes `--clear`
 * twice and each one is load-bearing, because `EXPO_PUBLIC_*` is inlined at
 * bundle time and a stale cache serves a bundle built under different env. So
 * the three sibling checkouts were taking turns deleting each other's warm
 * cache, and a Metro already running elsewhere kept writing into shard
 * directories that no longer existed.
 *
 * Set as a FUNCTION, not an array: Metro calls it with the `metro-cache` module
 * (`metro-config/src/loadConfig.js`, `mergeConfigObjects`), so this file does
 * not have to `require('metro-cache')` — a dependency whose version is pinned
 * transitively by `@expo/metro` and would drift from it.
 */
config.cacheStores = ({ FileStore }) => [
  new FileStore({ root: path.resolve(projectRoot, '.metro-cache') }),
];

/**
 * ONE BUILD OF LEXICAL, NOT BOTH.
 *
 * Lexical's default entry (`Lexical.mjs`) imports its development AND its
 * production build and picks one at run time by NODE_ENV. Metro does not
 * tree-shake, so the web bundle carried both: about 988 KB of minified
 * Lexical, measured from the export's source map. Every Lexical package, and
 * every subpath of one, also publishes the two builds under the `development`
 * and `production` export conditions, so ask for the one this build is — for
 * Lexical's packages only, since other packages' meaning of those conditions
 * is not this file's business. Expo's default config sets no
 * `resolveRequest` of its own, so this hands straight to Metro's resolver.
 */
const lexicalBuild = process.env.NODE_ENV === 'production' ? 'production' : 'development';
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    // Subpaths too: `@lexical/react/LexicalComposer` is how the React
    // bindings are imported, and each subpath carries the same two builds.
    /^(lexical|@lexical\/[^/]+)(\/.*)?$/.test(moduleName)
      ? { ...context, unstable_conditionNames: [...context.unstable_conditionNames, lexicalBuild] }
      : context,
    moduleName,
    platform,
  );

module.exports = config;
