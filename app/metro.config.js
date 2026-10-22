// Expo's default Metro config through Sentry's wrapper, with TWO changes of
// its own: the transform cache lives in this repo rather than in a directory
// shared by every Expo project on the machine, and Lexical resolves to ONE of
// its builds rather than both.
//
// `getSentryExpoConfig` is `getDefaultConfig` plus a serializer step that
// stamps every bundle with a debug id, which is how Sentry matches a crash to
// its uploaded source map with no release name to keep in step (ci-tools'
// README, "Sentry"; `sabeel-ci check-app` holds this file to it). Everything
// else is delegated to it, deliberately: this must not quietly change
// resolution, watch folders or transforms. Each change here is its own
// decision; the Lexical one touches resolution for Lexical's packages and
// nothing else.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const path = require('path');

const projectRoot = __dirname;
const config = getSentryExpoConfig(projectRoot);

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
 * is not this file's business. Neither Expo's config nor Sentry's (at its
 * defaults) sets a `resolveRequest` of its own, so this hands straight to
 * Metro's resolver.
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
