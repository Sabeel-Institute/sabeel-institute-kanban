#!/usr/bin/env bash
# Build the Android App Bundle for Google Play.
#
# Google Play is the team's Android channel (internal testing now, production
# next). It takes an AAB, not APKs: one artifact carrying every ABI, from which Play generates
# per-device splits itself. The per-ABI APK splits are turned off automatically
# for bundle tasks — see the `splits` block in app/android/app/build.gradle.
#
#   bash scripts/build-aab.sh
#
# The gates are the ones publish-apk.sh holds for the versioned release APK: a
# store-legal version, a deploy-log entry, and a signature that is not the
# debug key.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./app/app.json').expo.version")"
AAB="app/android/app/build/outputs/bundle/release/app-release.aab"

# 1. Store-legal version. Play derives its integer versionCode from these
#    components, and Apple's rules are stricter still — one check for all three
#    surfaces.
node scripts/check-version.mjs

# 2. A deploy-log entry must exist BEFORE the build, not be written afterwards
#    from memory: it is the release notes, and the only record of why.
if ! node scripts/deploy-notes.mjs "$VERSION" >/dev/null 2>&1; then
  echo "No deploy-log entry for v${VERSION} in docs/PHASE_STATUS.md." >&2
  echo "Write it first — it is the release notes, and the only record of why." >&2
  exit 1
fi

# 3. Crash reporting must actually be on. `app/.env.local` is gitignored, so any
#    fresh clone builds a release that reports nothing — `initErrorReporting()`
#    returns early on a missing DSN and the artifact looks identical. Same guard
#    as check-ios-config.mjs; the exposure is not iOS-specific.
if ! grep -qE '^\s*EXPO_PUBLIC_SENTRY_DSN_NATIVE\s*=\s*https://[^@]+@' app/.env.local 2>/dev/null; then
  echo "app/.env.local has no usable EXPO_PUBLIC_SENTRY_DSN_NATIVE." >&2
  echo "This build would ship with crash reporting silently OFF. It is gitignored," >&2
  echo "so a fresh clone never has it. Add the DSN from Sentry -> Client Keys." >&2
  exit 1
fi

# 3a. Load the build-machine values, so no shell setup is needed. The Gradle
#     gate reads the ENVIRONMENT, so this must happen before gradlew starts.
# shellcheck source=scripts/load-build-env.sh
. "$(dirname "$0")/load-build-env.sh"

# 3b. Symbolication. WARNS rather than fails, and the difference from gate 3 is
#     the point: without a DSN nothing is reported at all, whereas without these
#     the reports still arrive and are merely harder to read. Blocking a release
#     on a machine that simply has no token would be the wrong trade.
#
#     `app/android/app/build.gradle` applies sentry.gradle only when
#     SENTRY_AUTH_TOKEN is set, so their absence is a silent no-op — which is
#     exactly why it is said out loud here.
missing_sentry=""
for v in SENTRY_ORG SENTRY_PROJECT SENTRY_AUTH_TOKEN; do
  [ -n "$(eval "printf '%s' \"\${$v:-}\"")" ] || missing_sentry="${missing_sentry} ${v}"
done
if [ -n "$missing_sentry" ]; then
  echo "WARNING:${missing_sentry} not set — this build uploads no source maps," >&2
  echo "so Android crashes will report minified frames. Same three variables as" >&2
  echo "the iOS build; see docs/SECRETS.md. Building anyway." >&2
fi

# 4. Stamp the running commit onto the sign-in screen.
node scripts/gen-build-info.mjs

(cd app/android && ./gradlew bundleRelease --no-daemon)

[ -f "$AAB" ] || { echo "bundleRelease produced no AAB at $AAB" >&2; exit 1; }

# 5. Never ship the debug key. Everything up to v0.7.4 went out signed with the
#    debug keystore committed to this PUBLIC repo; Play would reject it, but the
#    check is here so the answer is known before the upload rather than after.
#    An AAB is jar-signed, so this is jarsigner rather than apksigner.
signer="$(jarsigner -verify -verbose:summary -certs "$AAB" 2>&1 | sed -n 's/.*Signed by "\(.*\)".*/\1/p' | head -1)"
case "$signer" in
  "")
    echo "REFUSING: could not read a signature from $AAB." >&2
    exit 1 ;;
  *"CN=Android Debug"*)
    echo "REFUSING: $AAB is signed with the DEBUG key ($signer)." >&2
    echo "app/android/keystore.properties is missing or wrong. Restore the EXISTING" >&2
    echo "upload keystore and its keystore.properties from the vault; never generate" >&2
    echo "a new one, which Play refuses. See docs/SECRETS.md." >&2
    exit 1 ;;
esac

VERSION_CODE="$(node -p "const [a,b,c]=require('./app/app.json').expo.version.split('.').map(Number); a*1000000+b*1000+c")"
echo
echo "AAB          $AAB"
echo "size         $(du -h "$AAB" | cut -f1)"
echo "version      ${VERSION}  (versionCode ${VERSION_CODE})"
echo "signed by    ${signer}"
echo
echo "Upload it with: npm run publish:play -- --internal"
echo "Play re-signs with ITS OWN app signing key; that SHA-1 is already in"
echo "Firebase. See docs/DEPLOY.md, \"Three SHA-1s\"."
