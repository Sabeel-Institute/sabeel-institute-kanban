#!/usr/bin/env bash
# Build and upload the iOS app WITHOUT touching Xcode's UI.
#
#   bash scripts/build-ios.sh            # archive, export, upload to TestFlight
#   bash scripts/build-ios.sh --check    # run every gate, build nothing
#   bash scripts/build-ios.sh --no-upload  # archive and export an .ipa, stop there
#
# Runs on the Mac, and on GitHub's macOS runners (.github/workflows/ios.yml,
# which always passes --no-upload and uploads in a job of its own). Everything
# it needs lives in the gitignored `app/.env.sentry-build-plugin`; nothing has
# to be exported by hand.
#
# SIGNING IS AUTOMATIC by default: Xcode mints and fetches the distribution
# certificate and profile through the App Store Connect key, which suits the
# Mac. With IOS_PROFILE_NAME set it is MANUAL: the app target signs with the
# Apple Distribution identity already in the keychain and that App Store
# profile, and nothing is minted. A runner needs manual. Automatic signing on a
# fresh machine creates a certificate every run and throws its private key
# away, until Apple's certificate limit stops every build for the team.
#
# WHY COMMAND LINE RATHER THAN THE XCODE GUI, beyond preference: Xcode runs build
# phases in a SANITISED environment and, since Xcode 15, does not inherit the
# environment of a terminal that launched it. So the Sentry symbol upload cannot
# see its token in a GUI archive — the archive succeeds and uploads nothing, with
# no error. `xcodebuild` inherits the shell, which makes the whole thing one
# reproducible command and is also the shape any CI job would take.
#
# The gates mirror scripts/build-aab.sh. A release should not be able to go out
# of one store with a guarantee the other store's release does not have.
set -euo pipefail
cd "$(dirname "$0")/.."

CHECK_ONLY=false
UPLOAD=true
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
    --no-upload) UPLOAD=false ;;
    -h | --help) sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

die() { echo "$@" >&2; exit 1; }

# ---------------------------------------------------------------- gates

# 0. The platform. Everything below needs Xcode, and the error you get from
#    running this on Linux otherwise names a missing binary rather than the
#    reason.
[ "$(uname -s)" = "Darwin" ] || die "build-ios.sh needs macOS — iOS archives cannot be produced on Linux."

command -v xcodebuild >/dev/null || die "xcodebuild not found. Install Xcode and run: sudo xcode-select -s /Applications/Xcode.app"
command -v pod >/dev/null || die "CocoaPods not found. Install it: sudo gem install cocoapods (or brew install cocoapods)"

# 0b. A release points at production. Metro inlines every EXPO_PUBLIC_* it finds
#     in the environment and in app/.env.local, so the dev loop's
#     EXPO_PUBLIC_USE_EMULATORS=1 in either would ship an app that talks to
#     127.0.0.1, and nothing in the archive would say so.
[ -z "${EXPO_PUBLIC_USE_EMULATORS:-}" ] || die "EXPO_PUBLIC_USE_EMULATORS is set in this shell.
A release built from here would point at the local emulators. Unset it (or use a fresh terminal)."
if grep -qE '^\s*EXPO_PUBLIC_USE_EMULATORS\s*=\s*\S' app/.env.local 2>/dev/null; then
  die "app/.env.local sets EXPO_PUBLIC_USE_EMULATORS.
A release built from here would point at the local emulators. Remove the line;
the dev loop passes the flag itself (scripts/dev.sh, npm run dev:*)."
fi

# 1. The build-machine values, loaded BEFORE the gates rather than after.
#    check:ios warns when the Sentry variables are missing, and running it first
#    made it warn about values this script was about to supply — a check crying
#    wolf is a check people stop reading.
# shellcheck source=scripts/load-build-env.sh
. scripts/load-build-env.sh

VERSION="$(node -p "require('./app/app.json').expo.version")"
BUILD_NUMBER="$(node -p "require('./app/app.json').expo.ios.buildNumber")"
BUNDLE_ID="$(node -p "require('./app/app.json').expo.ios.bundleIdentifier")"

# 2. Store-legal version — one check shared with Android and web.
node scripts/check-version.mjs

# 3. A deploy-log entry must exist BEFORE the build, exactly as for the AAB. It
#    is the release notes and the only record of why a release exists.
if ! node scripts/deploy-notes.mjs "$VERSION" >/dev/null 2>&1; then
  die "No deploy-log entry for v${VERSION} in docs/PHASE_STATUS.md.
Write it first — it is the release notes, and the only record of why."
fi

# 4. The iOS config itself: bundle id vs the plist, the Firebase project, the
#    Google Sign-In URL scheme, the icon's alpha channel, export compliance.
npm run --silent check:ios

# 5. Crash reporting must actually be on. Same gate as build-aab.sh: app/.env.local
#    is gitignored, so a fresh clone builds a release that reports nothing and
#    looks identical.
if ! grep -qE '^\s*EXPO_PUBLIC_SENTRY_DSN_NATIVE\s*=\s*https://[^@]+@' app/.env.local 2>/dev/null; then
  die "app/.env.local has no usable EXPO_PUBLIC_SENTRY_DSN_NATIVE.
This build would ship with crash reporting silently OFF. It is gitignored, so a
fresh clone never has it — copy it across from another machine."
fi

[ -n "${IOS_TEAM_ID:-}" ] || die "IOS_TEAM_ID is not set.
Put it in app/.env.sentry-build-plugin. Find it at developer.apple.com ->
Membership details -> Team ID (ten characters)."

missing_sentry=""
for v in SENTRY_ORG SENTRY_PROJECT SENTRY_AUTH_TOKEN; do
  [ -n "$(eval "printf '%s' \"\${$v:-}\"")" ] || missing_sentry="${missing_sentry} ${v}"
done
if [ -n "$missing_sentry" ]; then
  echo "WARNING:${missing_sentry} not set — this build uploads no debug symbols," >&2
  echo "so iOS crashes will report raw addresses. See docs/SECRETS.md. Building anyway." >&2
fi

# 6. The App Store Connect API key. ASC_KEY_PATH is OPTIONAL: default to the
#    directory Apple's own tooling searches, so placing the file is the only step
#    and nothing has to be edited. `~` is expanded here because a dotenv value is
#    a literal string — the loader does not run a shell over it, deliberately.
#
#    Resolved for EVERY build, not only an uploading one. The key is not merely
#    an upload credential: `-allowProvisioningUpdates` MINTS AND DOWNLOADS THE
#    DISTRIBUTION SIGNING ASSETS THROUGH IT, so the archive needs it just as much
#    as the upload does. This lived inside the `--upload` branch, which left
#    --no-upload archiving with no credentials at all.
if [ -n "${ASC_KEY_ID:-}" ]; then
  : "${ASC_KEY_PATH:=${HOME}/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8}"
  ASC_KEY_PATH="${ASC_KEY_PATH/#\~/$HOME}"
fi

# 7. Upload credentials, checked NOW rather than after a twenty-minute archive.
#    An App Store Connect API key is what makes this browserless; it is a
#    different .p8 from the APNs key.
if [ "$UPLOAD" = true ]; then
  [ -n "${ASC_KEY_ID:-}" ] || die "ASC_KEY_ID is not set (App Store Connect API key id).
Put it in app/.env.sentry-build-plugin, with ASC_ISSUER_ID. The key is App Store
Connect -> Users and Access -> Integrations -> App Store Connect API. It is NOT
the APNs key. Use --no-upload to skip uploading."
  [ -n "${ASC_ISSUER_ID:-}" ] || die "ASC_ISSUER_ID is not set (the Issuer ID above the key list; a UUID).
An APNs key has no Issuer ID — if yours does not, it is the wrong .p8."
  [ -f "${ASC_KEY_PATH}" ] || die "No App Store Connect key at:
  ${ASC_KEY_PATH}
Put AuthKey_${ASC_KEY_ID}.p8 there (mkdir -p ~/.appstoreconnect/private_keys),
or set ASC_KEY_PATH in app/.env.sentry-build-plugin to wherever it lives.
It downloads from App Store Connect exactly once — if it is lost, revoke the key
and generate another."
fi

# 7b. Manual signing: the named profile must be installed, be for THIS app, and
#     not have expired. Xcode says each of these too, but only after prebuild and
#     pod install. The LMS signs with the same certificate, so its profile is
#     the easy one to install here by mistake.
PROFILE_PLIST=""
if [ -n "${IOS_PROFILE_NAME:-}" ]; then
  PROFILE_PLIST="$(mktemp)"
  trap 'rm -f "$PROFILE_PLIST"' EXIT
  found=false
  for f in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision \
    "$HOME/Library/MobileDevice/Provisioning Profiles"/*.mobileprovision; do
    [ -f "$f" ] || continue
    security cms -D -i "$f" >"$PROFILE_PLIST" 2>/dev/null || continue
    if [ "$(plutil -extract Name raw "$PROFILE_PLIST")" = "$IOS_PROFILE_NAME" ]; then
      found=true
      break
    fi
  done
  [ "$found" = true ] || die "IOS_PROFILE_NAME is \"${IOS_PROFILE_NAME}\", and no installed provisioning profile has that name.
Xcode reads them from ~/Library/Developer/Xcode/UserData/Provisioning Profiles."
  PROFILE_APP="$(plutil -extract Entitlements.application-identifier raw "$PROFILE_PLIST")"
  [ "$PROFILE_APP" = "${IOS_TEAM_ID}.${BUNDLE_ID}" ] || die "Profile \"${IOS_PROFILE_NAME}\" is for ${PROFILE_APP}, not ${IOS_TEAM_ID}.${BUNDLE_ID}."
  PROFILE_EXPIRES="$(plutil -extract ExpirationDate raw "$PROFILE_PLIST")"
  [[ "$PROFILE_EXPIRES" > "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ]] || die "Profile \"${IOS_PROFILE_NAME}\" expired ${PROFILE_EXPIRES}.
docs/IOS-BUILD.md, \"Builds on GitHub\", has how to renew it."
fi

# 8. The signing keychain has to be USABLE, and the only proof is signing
#    something. Every gate above is a value; this one is a capability, and it is
#    the last thing standing between here and twenty minutes of compiling.
#
#    On a Mac reached over ssh the login keychain is LOCKED: it unlocks at GUI
#    login, and an ssh session never has one (`launchctl managername` says
#    `Background`, not `Aqua`). codesign can still READ a certificate — public
#    data — so `security find-identity` cheerfully lists valid identities while
#    every one of them is unusable. The archive then dies at the FIRST framework
#    it signs, with `errSecInternalComponent`: an error that names no keychain,
#    arrives after prebuild, pod install and 60-odd compiled targets, and looks
#    for all the world like a signing-configuration problem.
KEYCHAIN="$(security default-keychain -d user | tr -d ' "')"
UNLOCK_HELP="Unlock it, then re-run:

  security unlock-keychain ${KEYCHAIN}

Type the password at the prompt rather than passing -p, which puts your account
password in shell history. The unlock is shared by every process of this user,
so a different terminal is fine, but it is RUNTIME state: it does not survive a
reboot, and on a Mac nobody logs into at the console it starts locked every time."

if ! security show-keychain-info "$KEYCHAIN" >/dev/null 2>&1; then
  die "The signing keychain is locked:
  ${KEYCHAIN}

${UNLOCK_HELP}"
fi

# Locked is the usual cause but not the only one: a private key's ACL can refuse
# a non-GUI session even when the keychain is open, which needs
# set-key-partition-list rather than an unlock. Signing a throwaway binary
# exercises the exact mechanism the archive will use, and costs about a second.
#
# In automatic mode no identity is NOT an error: -allowProvisioningUpdates mints
# one through the App Store Connect key during the archive, which is how the Mac
# has always worked — it holds development certificates and no distribution one.
# Manual mode signs as "Apple Distribution", so that identity must be here, and
# the profile must carry its certificate: a renewed certificate needs a profile
# made on it, and installing one without the other is the mistake to expect.
if [ -n "${IOS_PROFILE_NAME:-}" ]; then
  SIGN_ID="$(security find-identity -v -p codesigning 2>/dev/null | awk '/"Apple Distribution: / {print $2; exit}')"
  [ -n "$SIGN_ID" ] || die "IOS_PROFILE_NAME is set (manual signing), but the keychain holds no Apple Distribution identity.
Import the distribution .p12 first."
  carried=false
  n="$(plutil -extract DeveloperCertificates raw "$PROFILE_PLIST")"
  for ((i = 0; i < n; i++)); do
    sha="$(plutil -extract "DeveloperCertificates.$i" raw "$PROFILE_PLIST" | base64 --decode | shasum -a 1 | awk '{print toupper($1)}')"
    [ "$sha" != "$SIGN_ID" ] || carried=true
  done
  [ "$carried" = true ] || die "Profile \"${IOS_PROFILE_NAME}\" does not carry the certificate of the
Apple Distribution identity in the keychain (${SIGN_ID}). Make a profile on that
certificate, or import the certificate the profile was made on."
else
  SIGN_ID="$(security find-identity -v -p codesigning 2>/dev/null | awk '/^ *1\)/ {print $2}')"
fi
if [ -n "$SIGN_ID" ]; then
  PROBE_DIR="$(mktemp -d)"
  cp /bin/echo "${PROBE_DIR}/probe"
  if ! codesign --force --sign "$SIGN_ID" "${PROBE_DIR}/probe" >/dev/null 2>&1; then
    rm -rf "$PROBE_DIR"
    die "The keychain is unlocked, but codesign cannot USE the signing identity.
Signing a throwaway binary with ${SIGN_ID} failed — the archive would fail the
same way at its first framework, twenty minutes from now.

Usually the private key's ACL refuses a session with no window server:

  security set-key-partition-list -S apple-tool:,apple:,codesign: -s ${KEYCHAIN}

${UNLOCK_HELP}"
  fi
  rm -rf "$PROBE_DIR"
else
  echo "note: no codesigning identity in the keychain — cloud signing will mint" >&2
  echo "one during the archive. Nothing to prove here yet." >&2
fi

echo
echo "app          Sabeel Kanban (${BUNDLE_ID})"
echo "version      ${VERSION}  (build ${BUILD_NUMBER})"
echo "team         ${IOS_TEAM_ID}"
echo "signing      $([ -n "${IOS_PROFILE_NAME:-}" ] && echo "manual, profile \"${IOS_PROFILE_NAME}\" (expires ${PROFILE_EXPIRES})" || echo "automatic")"
echo "symbols      ${SENTRY_PROJECT:-<none>}"
echo "upload       $([ "$UPLOAD" = true ] && echo "yes, to TestFlight" || echo "no (--no-upload)")"
echo

if [ "$CHECK_ONLY" = true ]; then
  echo "--check: every gate passed; nothing was built."
  exit 0
fi

# ---------------------------------------------------------------- build

# 8. Stamp the running commit onto the sign-in screen. Immediately before the
#    build, never earlier: it records the commit at the moment it runs, and a
#    stale stamp is how a device check reads the wrong version off a correct build.
node scripts/gen-build-info.mjs

# 9. Regenerate ios/. ALWAYS --platform ios: a bare prebuild is clean by default
#    and would delete the committed android/, silently dropping minSdkVersion 33.
#    --no-install because the pods are installed below; without it prebuild
#    installed them too, and every build paid for `pod install` twice.
(cd app && npx expo prebuild --platform ios --no-install)

# 10. The pods this app ships, pinned by the committed app/Podfile.lock. app/ios
#     is generated, and prebuild is clean, so without a committed lock every
#     build resolved the third-party pods afresh: two builds of one commit could
#     ship different native code, and the sibling LMS caught exactly that
#     (AppCheckCore and GoogleUtilities a patch apart between its Mac and
#     GitHub). A resolution that differs from the pin stops the build rather
#     than shipping quietly.
cp app/Podfile.lock app/ios/Podfile.lock
(cd app/ios && pod install)
pods_of() { sed -n '/^PODS:/,/^DEPENDENCIES:/p' "$1"; }
if [ "$(pods_of app/Podfile.lock)" != "$(pods_of app/ios/Podfile.lock)" ]; then
  die "pod install resolved other pods than app/Podfile.lock pins (a native dependency changed?).
If that is intended: cp app/ios/Podfile.lock app/Podfile.lock, commit it, and build again."
fi

WORKSPACE="$(find app/ios -maxdepth 1 -name '*.xcworkspace' | head -1)"
[ -n "$WORKSPACE" ] || die "no .xcworkspace under app/ios after prebuild + pod install."

# The scheme is whatever prebuild named it — discovered rather than assumed, so a
# rename in app.json does not silently break this script.
#
# Ask the APP PROJECT, never the workspace. Once pods are integrated the
# workspace carries a scheme for EVERY pod — 131 of them here — and the first
# alphabetically is `AppAuth`, not the app. That is not a build failure you can
# see: archiving a pod SUCCEEDS, and produces an .xcarchive with no
# Products/Applications, which only surfaces one step later as the baffling
# `exportArchive ... expected one {}` — an empty set of valid export methods,
# because a static library has none. The project knows exactly one scheme.
PROJECT="$(find app/ios -maxdepth 1 -name '*.xcodeproj' | head -1)"
[ -n "$PROJECT" ] || die "no .xcodeproj under app/ios after prebuild."
SCHEME="$(xcodebuild -project "$PROJECT" -list -json | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const schemes = JSON.parse(s).project.schemes.filter((x) => !/Tests?$/.test(x));
    process.stdout.write(schemes[0] ?? "");
  });')"
[ -n "$SCHEME" ] || die "could not determine the Xcode scheme from $PROJECT."
echo "scheme       ${SCHEME}"

# Manual signing for the APP TARGET ONLY, written into the regenerated project.
# Passed on the xcodebuild command line instead, PROVISIONING_PROFILE_SPECIFIER
# would reach every pod target too, and each fails with "does not support
# provisioning profiles". The xcodeproj gem ships with CocoaPods.
if [ -n "${IOS_PROFILE_NAME:-}" ]; then
  ruby -rxcodeproj -e '
    project = Xcodeproj::Project.open(ARGV[0])
    target = project.native_targets.find { |t| t.name == ARGV[1] } or abort("no target #{ARGV[1]} in #{ARGV[0]}")
    target.build_configurations.select { |c| c.name == "Release" }.each do |c|
      c.build_settings["CODE_SIGN_STYLE"] = "Manual"
      c.build_settings["CODE_SIGN_IDENTITY"] = "Apple Distribution"
      c.build_settings["CODE_SIGN_IDENTITY[sdk=iphoneos*]"] = "Apple Distribution"
      c.build_settings["PROVISIONING_PROFILE_SPECIFIER"] = ARGV[2]
      c.build_settings["DEVELOPMENT_TEAM"] = ARGV[3]
    end
    attributes = (project.root_object.attributes["TargetAttributes"] ||= {})
    (attributes[target.uuid] ||= {})["ProvisioningStyle"] = "Manual"
    project.save
  ' "$PROJECT" "$SCHEME" "$IOS_PROFILE_NAME" "$IOS_TEAM_ID"
fi

ARCHIVE="build/ios/${SCHEME}-${VERSION}-${BUILD_NUMBER}.xcarchive"
EXPORT_DIR="build/ios/export"
rm -rf "$ARCHIVE" "$EXPORT_DIR"
mkdir -p build/ios

# All four or none: a partially-set key is how `set -u` turns a config mistake
# into an unbound-variable error twenty minutes into a build. The FILE has to be
# there too — a path alone gets as far as xcodebuild before it means anything.
# Manual signing fetches nothing, so it takes neither the key nor
# -allowProvisioningUpdates: with either, Xcode could still mint.
AUTH=()
PROVISIONING=()
if [ -z "${IOS_PROFILE_NAME:-}" ]; then
  PROVISIONING=(-allowProvisioningUpdates)
  if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] &&
    [ -n "${ASC_KEY_PATH:-}" ] && [ -f "${ASC_KEY_PATH}" ]; then
    AUTH=(-authenticationKeyPath "${ASC_KEY_PATH}"
          -authenticationKeyID "${ASC_KEY_ID}"
          -authenticationKeyIssuerID "${ASC_ISSUER_ID}")
  fi
fi

# Both xcodebuild calls below expand AUTH and PROVISIONING as `${AUTH[@]+"${AUTH[@]}"}` rather
# than the obvious `"${AUTH[@]}"`. macOS ships bash 3.2, where expanding an EMPTY
# array under `set -u` counts as UNBOUND: the script dies with `AUTH[@]: unbound
# variable`, naming a variable that is right there, correctly declared, four
# lines up. Bash 4.4 and later expand it to nothing as intended — so the bug
# cannot be reproduced in any shell newer than the one every Mac actually runs.

# 11. Archive. In automatic mode `-allowProvisioningUpdates` lets Xcode create
#    and download the signing assets itself, which is what removes the last
#    reason to open the UI.
xcodebuild -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  ${PROVISIONING[@]+"${PROVISIONING[@]}"} \
  ${AUTH[@]+"${AUTH[@]}"} \
  DEVELOPMENT_TEAM="$IOS_TEAM_ID" \
  archive

[ -d "$ARCHIVE" ] || die "xcodebuild reported success but produced no archive at $ARCHIVE."

# An archive of a LIBRARY target is a perfectly valid .xcarchive — it simply has
# no app inside. Nothing above notices, and the only downstream symptom is an
# export error about the `method` key that says nothing about the real cause.
# Assert the archive holds an app while the scheme that built it is still in hand.
[ -d "$ARCHIVE/Products/Applications" ] || die \
  "archive at $ARCHIVE contains no app — scheme '$SCHEME' is not the app's."

# 12. Export, and upload in the same step when asked. `destination: upload` in the
#     options plist is what sends it to App Store Connect without Xcode Organizer
#     or Transporter.
PLIST="build/ios/ExportOptions.plist"
DESTINATION=$([ "$UPLOAD" = true ] && echo upload || echo export)
if [ -n "${IOS_PROFILE_NAME:-}" ]; then
  SIGNING="<key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict><key>${BUNDLE_ID}</key><string>${IOS_PROFILE_NAME}</string></dict>"
else
  SIGNING="<key>signingStyle</key><string>automatic</string>"
fi
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>${DESTINATION}</string>
  <key>teamID</key><string>${IOS_TEAM_ID}</string>
  ${SIGNING}
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLISTEOF

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$PLIST" \
  ${PROVISIONING[@]+"${PROVISIONING[@]}"} \
  ${AUTH[@]+"${AUTH[@]}"}

echo
if [ "$UPLOAD" = true ]; then
  echo "Uploaded v${VERSION} build ${BUILD_NUMBER} to App Store Connect."
  echo "It appears on internal TestFlight after processing — a few minutes."
  echo
  echo "BUMP expo.ios.buildNumber before the next upload. Apple requires it to"
  echo "increase every time, even for the same version; unlike Android's"
  echo "versionCode it does not derive itself."
else
  echo "Exported to ${EXPORT_DIR} (not uploaded)."
fi
