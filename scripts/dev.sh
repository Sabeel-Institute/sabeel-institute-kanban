#!/usr/bin/env bash
# One entry point for the local dev loop, so nobody re-derives it under pressure.
#
#   scripts/dev.sh status     what is running, and who owns each port
#   scripts/dev.sh stop       stop what this script started; report anything
#                             else holding this checkout's ports
#   scripts/dev.sh web        stop, start emulators + web, seed
#   scripts/dev.sh android    stop, start emulators + Metro for the device build
#   scripts/dev.sh ios        stop, start emulators + web + Metro, seed, launch the
#                             simulator app (add --build to compile and install first)
#   scripts/dev.sh e2e        stop, then run the full suite (it manages its own)
#
# Why this exists: half a dozen debugging sessions were lost to a stale emulator
# or Metro holding a port, which fails in ways that look like application bugs —
# "Could not start Authentication Emulator, port taken", or worse, a dev server
# that answers on the web port while serving code from another checkout.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# This checkout's block, from ci-tools (`sabeel-ci ports` prints one
# "<port> <name>" per line): what `status` reports and `stop` verifies. No port
# is stated here; `sabeel-ci check-app` fails a script that states one.
PORTS=()
LABELS=()
while read -r port name; do
  PORTS+=("$port")
  LABELS+=("$name")
done < <(npx --no sabeel-ci ports)
if [ "${#PORTS[@]}" -eq 0 ]; then
  echo "dev.sh: sabeel-ci ports gave no ports (npm ci first?)" >&2
  exit 1
fi
FIRESTORE_PORT=$(npx --no sabeel-ci ports firestore)
WEB_PORT=$(npx --no sabeel-ci ports web)
# Machine-wide ports every React Native checkout on the machine shares: Metro
# (the Android emulator reaches the host at 10.0.2.2:8081, so it cannot move)
# and idb. `status` shows who holds them; nothing here ever frees them, because
# the holder may be another repo's session in the middle of a run.
SHARED_PORTS=(8081 10882)
SHARED_LABELS=("metro" "idb")

# The iOS simulator to drive. A name, not a UDID, so it survives a wiped device
# set; override for a different size without editing this file.
IOS_SIM="${SK_IOS_SIM:-iPhone 17 Pro}"
# No `.debug` suffix on iOS, unlike Android: the simulator build installs under
# the same bundle id as the App Store build, because they never coexist.
IOS_BUNDLE_ID="com.sabeelinstitute.kanban"

# Who holds a port, a pid's cwd, a group's members: one answer each, shared
# with e2e.sh, whichever of ss/lsof the platform has. Refused up front when it
# has neither — an empty answer must mean "nothing holds it", never "I could
# not look", and `exit` inside a `$(...)` would end only the substitution.
# shellcheck source=scripts/lib/procs.sh
. scripts/lib/procs.sh
if [ -z "$PORT_TOOL" ]; then
  echo "dev.sh: neither ss nor lsof found; cannot inspect ports" >&2
  exit 1
fi

# WHAT THIS SCRIPT STARTED, and the only thing `stop` ever stops.
#
# `launch` runs each long-lived job in a PROCESS GROUP of its own (`set -m`)
# and records the group id here; `stop` signals exactly those groups and every
# descendant of their members (npm -> firebase -> java, npm -> expo -> workers),
# by parent pid, since a child can leave its group.
# It does not free ports by number and matches nothing by name: Metro 8081 and
# idb 10882 are shared with other checkouts on the same machine, and a pattern
# such as `pkill -f idb_companion` reaches every session's processes at once.
ROOT=$(pwd -P)
PIDS_FILE="$ROOT/.dev-pids"

launch() { # launch <log> <command...>
  local log=$1 pid
  shift
  set -m
  nohup "$@" >"$log" 2>&1 &
  pid=$!
  set +m
  # Outlives this script: a backgrounded child that dies with its parent is a
  # whole class of "it was running a second ago".
  disown "$pid" 2>/dev/null || true
  echo "$pid" >>"$PIDS_FILE"
}

status_line() { # status_line <label> <port> <note>; fails when nothing holds it
  local pid
  pid=$(port_pids "$2" | head -1)
  [ -n "$pid" ] || return 1
  printf '  %-12s %-6s pid %-8s %s%s\n' "$1" "$2" "$pid" \
    "$(ps -o args= -p "$pid" 2>/dev/null | cut -c1-60)" "$3"
}

status() {
  local any=0 i
  for i in "${!PORTS[@]}"; do
    status_line "${LABELS[$i]}" "${PORTS[$i]}" "" && any=1
  done
  for i in "${!SHARED_PORTS[@]}"; do
    status_line "${SHARED_LABELS[$i]}" "${SHARED_PORTS[$i]}" "  (shared; never stopped here)" && any=1
  done
  if [ "$any" = 0 ]; then echo "  (nothing running)"; fi
  return 0
}

stop() {
  local pgid members pids="" m ours left p holder held=""
  if [ -f "$PIDS_FILE" ]; then
    while read -r pgid; do
      [ -n "$pgid" ] || continue
      members=$(group_pids "$pgid")
      [ -n "$members" ] || continue
      # A recorded group whose members are not in this checkout is a reused
      # id (a reboot since), not ours: leave it alone.
      ours=""
      for m in $members; do
        case "$(cwd_of "$m")" in "$ROOT"|"$ROOT"/*) ours=1 ;; esac
      done
      if [ -z "$ours" ]; then
        echo "  group $pgid is no longer this checkout's; left alone" >&2
        continue
      fi
      echo "  stopping group $pgid: $(ps -o args= -p "$pgid" 2>/dev/null | cut -c1-60)"
      # The group AND every member's descendants: firebase starts the Firestore
      # emulator's java DETACHED, in a group of its own, under its own pid.
      for m in $members; do
        pids="$pids $(pid_tree "$m" | tr '\n' ' ')"
      done
    done <"$PIDS_FILE"
    # shellcheck disable=SC2046,SC2086 # word-split on purpose: a list of pids
    left=$(terminate $(printf '%s\n' $pids | sort -u))
    if [ -n "$left" ]; then
      echo "  would not stop: $(echo "$left" | tr '\n' ' ')" >&2
      return 1
    fi
    rm -f "$PIDS_FILE"
  fi
  # Verify rather than assume. Anything still on this checkout's ports was not
  # started by this script (an emulator run by hand, a crashed e2e.sh): say who
  # holds it and stop there. Freeing it is a decision for whoever started it.
  for p in "${PORTS[@]}"; do
    for holder in $(port_pids "$p"); do
      held=1
      echo "  $p held by pid $holder ($(cwd_of "$holder")): $(ps -o args= -p "$holder" 2>/dev/null | cut -c1-60)" >&2
    done
  done
  if [ -n "$held" ]; then
    echo "  not started by dev.sh; stop it by pid before starting anything" >&2
    return 1
  fi
  echo "  this checkout's ports are clear"
}

# Metro's 8081 is shared, so it is never freed from here. If someone holds it,
# say who and refuse: whoever holds 8081 serves their bundle to this app.
metro_port_free() {
  local holder
  for holder in $(port_pids 8081); do
    echo "  8081 is held by pid $holder ($(cwd_of "$holder")); not ours to stop, so no Metro" >&2
    return 1
  done
  return 0
}

wait_for() { # wait_for <url> <label>
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "$1" && { echo "  $2 up"; return 0; }
    sleep 3
  done
  echo "  $2 NEVER CAME UP" >&2; return 1
}

# Wait until the AUTH TRIGGER is registered, not merely until a port answers.
#
# This is load-bearing, and its absence cost two debugging sessions. Firestore
# comes up seconds before the functions emulator finishes loading, so seeding as
# soon as its port answers races `onUserCreate`. A sign-in that lands in that window
# creates an auth account with NO user doc — and the app reads "auth account,
# no profile" as a rejected non-org address and shows **Wrong account** forever.
# Nothing looks broken: the emulators are up, the seed just "times out waiting
# for New board", and re-running cannot fix it because onCreate never fires
# twice for the same account.
wait_for_auth_trigger() {
  for _ in $(seq 1 60); do
    grep -q 'onUserCreate.*auth function initialized' /tmp/sk-emulators.log 2>/dev/null \
      && { echo "  auth trigger registered"; return 0; }
    sleep 3
  done
  echo "  AUTH TRIGGER NEVER REGISTERED — seeding now would strand the account" >&2
  return 1
}

case "${1:-status}" in
  status) echo "Ports:"; status ;;
  stop)   echo "Stopping:"; stop ;;
  web)
    echo "Stopping:"; stop || exit 1
    launch /tmp/sk-emulators.log npm run emulators
    launch /tmp/sk-web.log npm run dev:web
    wait_for "http://127.0.0.1:${FIRESTORE_PORT}/" firestore || exit 1
    wait_for "http://127.0.0.1:${WEB_PORT}/" web       || exit 1
    wait_for_auth_trigger || exit 1
    npm run seed
    echo "Ready: http://127.0.0.1:${WEB_PORT}  (logs: /tmp/sk-emulators.log /tmp/sk-web.log)"
    ;;
  android)
    echo "Stopping:"; stop || exit 1
    metro_port_free || exit 1
    launch /tmp/sk-emulators.log npm run emulators
    wait_for "http://127.0.0.1:${FIRESTORE_PORT}/" firestore || exit 1
    wait_for_auth_trigger || exit 1
    launch /tmp/sk-metro.log bash -c \
      'cd app && exec env EXPO_PUBLIC_USE_EMULATORS=1 npx expo start --dev-client --port 8081'
    for _ in $(seq 1 40); do [ -n "$(port_pids 8081)" ] && break; sleep 3; done
    echo "Metro on 8081 (log: /tmp/sk-metro.log). Launch the installed dev build."
    ;;
  ios)
    echo "Stopping:"; stop || exit 1
    metro_port_free || exit 1
    # The web server is not optional here even though nothing iOS uses it:
    # `seed-dev.mjs` seeds by DRIVING the web app in a browser, so no web server
    # means no seed, and the simulator comes up signed in to an empty project.
    launch /tmp/sk-emulators.log npm run emulators
    launch /tmp/sk-web.log npm run dev:web
    wait_for "http://127.0.0.1:${FIRESTORE_PORT}/" firestore || exit 1
    wait_for "http://127.0.0.1:${WEB_PORT}/" web       || exit 1
    wait_for_auth_trigger || exit 1
    npm run seed || exit 1

    launch /tmp/sk-metro.log bash -c \
      'cd app && exec env EXPO_PUBLIC_USE_EMULATORS=1 npx expo start --port 8081'
    for _ in $(seq 1 40); do [ -n "$(port_pids 8081)" ] && break; sleep 3; done

    # Ask the STATE, rather than inferring it from bootstatus's exit code.
    # `bootstatus || boot` looks equivalent and is not: bootstatus also fails
    # when it is interrupted, and the fallback then tries to boot a device that
    # is already up, which errors with "Unable to boot device in current state:
    # Booted" and stops the script for no reason.
    if ! xcrun simctl list devices | grep -q "$IOS_SIM (.*) (Booted)"; then
      xcrun simctl boot "$IOS_SIM" || exit 1
    fi
    xcrun simctl bootstatus "$IOS_SIM" -b >/dev/null 2>&1 || true

    if [ "${2:-}" = "--build" ] \
       || ! xcrun simctl get_app_container "$IOS_SIM" "$IOS_BUNDLE_ID" >/dev/null 2>&1; then
      echo "Building for the simulator (first run takes a while)..."
      # `|| true`: expo run:ios exits 1 on a PERFECTLY GOOD build. Its last act is
      # `ensureSimulatorAppRunning`, which shells out to osascript to raise the
      # Simulator window, and AppleScript automation is not permitted from a
      # non-GUI shell. The app is compiled, signed and installed by then.
      ( cd app && EXPO_PUBLIC_USE_EMULATORS=1 npx expo run:ios --device "$IOS_SIM" ) || true
      # So verify the INSTALL, never that exit code.
      xcrun simctl get_app_container "$IOS_SIM" "$IOS_BUNDLE_ID" >/dev/null 2>&1 || {
        echo "  build did NOT install $IOS_BUNDLE_ID — read the error above" >&2; exit 1; }
    fi

    # Sign the app OUT before launching, by clearing its data container.
    #
    # Every run above wipes the emulators and re-seeds, so each seed mints NEW
    # uids. But the app persists its Firebase session in AsyncStorage — on
    # purpose, or a restart would sign you out (app/src/firebase.ts) — and that
    # persistence SURVIVES the backend being wiped. What is left is an auth
    # session whose uid has no user doc, which the app correctly reads as an
    # account outside the org and shows as **Wrong account**, with only a Sign
    # out button. It looks like the domain check is broken. It is not: the client
    # is simply older than the backend.
    xcrun simctl terminate "$IOS_SIM" "$IOS_BUNDLE_ID" >/dev/null 2>&1 || true
    APP_DATA="$(xcrun simctl get_app_container "$IOS_SIM" "$IOS_BUNDLE_ID" data 2>/dev/null || true)"
    # `:?` so an empty path can never turn this into `rm -rf /Documents`.
    if [ -n "$APP_DATA" ] && [ -d "$APP_DATA" ]; then
      rm -rf "${APP_DATA:?}/Documents" "${APP_DATA:?}/Library"
    fi

    # Launch through simctl rather than letting expo do it, for the same reason.
    xcrun simctl launch "$IOS_SIM" "$IOS_BUNDLE_ID" >/dev/null || exit 1
    open -a Simulator 2>/dev/null || true
    echo "Ready on $IOS_SIM. Tap 'faisal' on the dev sign-in row (already an admin)."
    echo "  logs: /tmp/sk-emulators.log /tmp/sk-web.log /tmp/sk-metro.log"
    echo "  to script the UI: idb_companion --udid \$(xcrun simctl list devices | \\"
    echo "    grep -m1 '$IOS_SIM (' | grep -oE '[0-9A-F-]{36}')  # then: idb connect localhost <port>"
    ;;
  e2e)
    echo "Stopping:"; stop || exit 1
    exec bash scripts/e2e.sh
    ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
