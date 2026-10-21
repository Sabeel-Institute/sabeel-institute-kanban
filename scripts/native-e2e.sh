#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Native flows on Android: the debug build against the emulators, driven by
# Maestro (`maestro/*.yaml`). They cover the seams the browser suites cannot
# reach — the native rich-text editor, the column swipe and long-press, Yoga's
# layout — on a real Android build. CI runs exactly this.
#
#   bash scripts/native-e2e.sh                     # every flow
#   bash scripts/native-e2e.sh maestro/board.yaml  # one flow
#
# Needs one booted emulator (scripts/emulator.sh headless here, ci-avd.sh in
# CI) and Maestro (scripts/install-maestro.sh). Builds and installs the debug
# APK, starts the emulators, seeds them by driving the web app (seed-dev.mjs),
# then serves the JavaScript from Metro on 8081 with EXPO_PUBLIC_USE_EMULATORS=1
# and runs the flows. Screenshots and Maestro's report land in shots/native/.
# It stops what it started and nothing else; a held 8081 or 61210 is refused.

# shellcheck source=scripts/jdk21.sh
. "$(dirname "$0")/jdk21.sh"
# shellcheck source=scripts/lib/procs.sh
. "$(dirname "$0")/lib/procs.sh"

FLOWS="${1:-maestro}"
OUT="$PWD/shots/native"
LOGS="$OUT/logs"
WEB_PORT=61210
METRO_PORT=8081
APP_ID=com.sabeelinstitute.kanban.debug

devices=$(adb devices | sed -n 's/\tdevice$//p')
if [ "$(printf '%s\n' "$devices" | grep -c .)" -ne 1 ]; then
  echo "native-e2e.sh: needs exactly one booted Android device; found: ${devices:-none}" >&2
  exit 1
fi
command -v maestro >/dev/null || PATH="$(bash scripts/install-maestro.sh):$PATH"
for port in "$WEB_PORT" "$METRO_PORT"; do
  for holder in $(port_pids "$port"); do
    echo "native-e2e.sh: port $port is held by pid $holder ($(cwd_of "$holder")); refusing to start beside it" >&2
    exit 1
  done
done
rm -rf "$OUT"
mkdir -p "$LOGS"

npm run build -w @sabeel/shared
npm run build -w functions
node scripts/gen-build-info.mjs
echo "Building the debug APK…"
( cd app/android && ./gradlew assembleDebug -PreactNativeArchitectures=x86_64 --quiet )
apk=$(find app/android/app/build/outputs/apk/debug -name '*.apk' | grep -E 'x86_64|app-debug' | head -1)
adb install -r "$apk" >/dev/null 2>&1 || { adb uninstall "$APP_ID" >/dev/null 2>&1 || true; adb install "$apk" >/dev/null; }
echo "Installed $apk"

# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  local rc=$? pid left
  trap - EXIT INT TERM HUP
  for pid in "${MAESTRO_PID:-}" "${METRO_PID:-}" "${WEB_PID:-}" "${FB_PID:-}"; do
    [ -n "$pid" ] || continue
    # shellcheck disable=SC2046 # word-split on purpose: a list of pids
    left=$(terminate $(pid_tree "$pid"))
    if [ -n "$left" ]; then
      echo "native-e2e.sh: could not stop what it started (pids: $left)" >&2
      [ "$rc" -ne 0 ] || rc=1
    fi
  done
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

wait_for() { # wait_for <url> <label> <tries>
  for _ in $(seq 1 "$3"); do
    curl -sf -o /dev/null "$1" && return 0
    sleep 3
  done
  echo "native-e2e.sh: $2 never came up" >&2
  return 1
}

firebase emulators:start --project demo-sabeel-kanban --only firestore,auth,functions,storage \
  >"$LOGS/emulators.log" 2>&1 &
FB_PID=$!
wait_for http://127.0.0.1:61200/ firestore 60
# Seeding before onUserCreate is registered strands an account with no profile
# (scripts/dev.sh, wait_for_auth_trigger).
for _ in $(seq 1 60); do
  grep -q 'onUserCreate.*auth function initialized' "$LOGS/emulators.log" && break
  sleep 3
done
grep -q 'onUserCreate.*auth function initialized' "$LOGS/emulators.log" \
  || { echo "native-e2e.sh: the auth trigger never registered" >&2; exit 1; }

# The seed drives the web app, so the web server runs for the seed alone.
( cd app && CI=1 EXPO_PUBLIC_USE_EMULATORS=1 exec npx expo start --web --port "$WEB_PORT" --clear \
    >"$LOGS/web.log" 2>&1 ) &
WEB_PID=$!
wait_for "http://127.0.0.1:${WEB_PORT}/" "the web dev server" 90
npm run seed
# shellcheck disable=SC2046 # word-split on purpose: a list of pids
left=$(terminate $(pid_tree "$WEB_PID"))
[ -z "$left" ] || { echo "native-e2e.sh: the web server would not stop: $left" >&2; exit 1; }
WEB_PID=

# The debug build loads its JavaScript from 10.0.2.2:8081 at launch.
( cd app && CI=1 EXPO_PUBLIC_USE_EMULATORS=1 exec npx expo start --port "$METRO_PORT" --clear \
    >"$LOGS/metro.log" 2>&1 ) &
METRO_PID=$!
wait_for "http://127.0.0.1:${METRO_PORT}/status" Metro 60
# Bundle before launch, so a bundling failure fails here with Metro's log rather
# than as a flow timing out on a red screen. Expo serves the app's entry at its
# virtual path; /index.bundle is a 404.
echo "Bundling for Android…"
curl -sf -o /dev/null --max-time 600 \
  "http://127.0.0.1:${METRO_PORT}/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&minify=false" \
  || { echo "native-e2e.sh: Metro could not bundle the app; see $LOGS/metro.log" >&2; exit 1; }

maestro test "$FLOWS" --format junit --output "$OUT/report.xml" --test-output-dir "$OUT" &
MAESTRO_PID=$!
rc=0
wait "$MAESTRO_PID" || rc=$?
adb logcat -d >"$LOGS/logcat.txt" 2>&1 || true
exit "$rc"
