#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Browser suites against the emulators and an Expo web dev server, both
# started here and both stopped on exit. The npm scripts `test:screens`,
# `test:e2e` and `test:e2e:*` run it, and CI runs those (ci-tools.json
# `ci.browserSuites`).
#
#   bash scripts/e2e.sh scripts/<suite>-e2e.mjs [scripts/<suite>-e2e.mjs …]
#
# Several suites run one after another on the one dev server, each against
# emulators started for it alone, so no suite meets another's data or a
# trigger another set off. Every suite runs, and the run fails if any did.
#
# Drives the Expo web DEV server, not an exported bundle: `expo export` sets
# __DEV__ false, which correctly strips the emulator dev sign-in this flow needs
# to drive. For web-e2e.mjs the script also builds the PRODUCTION bundle, and
# that suite asserts the dev row is absent from it — so the safety property is
# tested, not assumed.
#
# The web port, the emulator project and JDK 21 come from ci-tools
# (`npx sabeel-ci ports web`, `ports --project`, `jdk21`); no port is stated
# here.

# shellcheck source=scripts/lib/procs.sh
. "$(dirname "$0")/lib/procs.sh"
if [ -z "$PORT_TOOL" ]; then
  echo "e2e.sh: neither ss nor lsof found; cannot check the web port" >&2
  exit 1
fi

# The Firebase emulators need JDK 21 or later; the Android build keeps 17 as
# the default `java`, so only this run is pointed at 21.
JAVA_HOME=$(npx --no sabeel-ci jdk21)
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"

WEB_PORT=$(npx --no sabeel-ci ports web)
PROJECT=$(npx --no sabeel-ci ports --project)
export E2E_BASE="http://127.0.0.1:${WEB_PORT}/"
# In this checkout, under shots/ (which CI keeps when a suite fails), not a
# fixed /tmp name another checkout's run would overwrite. Absolute: the server
# starts from app/, the readiness check below reads it from here.
WEB_LOG="$PWD/shots/e2e-web-server.log"
mkdir -p "$(dirname "$WEB_LOG")"
: >"$WEB_LOG"

# Which suites to drive, in order. Defaults to the full flow.
SUITES=("$@")
[ ${#SUITES[@]} -gt 0 ] || SUITES=(scripts/web-e2e.mjs)
for suite in "${SUITES[@]}"; do
  if [ ! -f "$suite" ]; then
    echo "e2e.sh: no suite $suite (pass scripts/<suite>-e2e.mjs)" >&2
    exit 2
  fi
done

npm run build -w @sabeel/shared
npm run build -w functions

# The web export as Hosting gets it, tree-shaken, pointed at the emulators,
# for the checks of what ships at the end of web-e2e.mjs, the one suite that
# reads it.
for suite in "${SUITES[@]}"; do
  if [ "$suite" = scripts/web-e2e.mjs ]; then
    echo "Building the web export (sabeel-ci build-web --emulators)…"
    npx --no sabeel-ci build-web --emulators >/dev/null
  fi
done

# REFUSE a held port, never kill it. A leftover dev server is the nastiest
# failure mode here: the new `expo start` cannot bind, exits quietly, and the
# readiness check below gets a cheerful 200 from the stale process — so the
# whole suite runs against OLD code (cost a debugging round on 2026-07-19).
# But whatever holds the port, this script did not start it: it may be
# `dev.sh web` in use. Say who, and stop.
held=$(port_pids "$WEB_PORT")
if [ -n "$held" ]; then
  for p in $held; do
    echo "port ${WEB_PORT} is held by pid $p ($(cwd_of "$p")): $(ps -o args= -p "$p" | cut -c1-80)" >&2
  done
  echo "refusing to test against it; stop it (scripts/dev.sh stop if dev.sh started it)" >&2
  exit 1
fi

# LEAVE NOTHING RUNNING: stop the web server this script started — its pid and
# every descendant (npm exec -> expo -> Metro workers), by pid — then check the
# port is free. Killing only the listener used to leave its `npm exec` parent,
# and a final `exec firebase` would take this trap with it: every run would
# leave a dev server on the web port for the next one to trip over.
# shellcheck disable=SC2329 # invoked by the EXIT trap
cleanup() {
  local rc=$? left
  trap - EXIT INT TERM HUP
  # The emulators first, when a signal arrived mid-suite (finished normally,
  # firebase has already stopped them and this finds nothing).
  if [ -n "${FB_PID:-}" ]; then
    # shellcheck disable=SC2046 # word-split on purpose: a list of pids
    left=$(terminate $(pid_tree "$FB_PID"))
    [ -z "$left" ] || echo "e2e.sh: emulator pids would not stop:" "$left" >&2
  fi
  if [ -n "${WEB_PID:-}" ]; then
    # shellcheck disable=SC2046 # word-split on purpose: a list of pids
    left=$(terminate $(pid_tree "$WEB_PID"))
    if [ -n "$left" ] || [ -n "$(port_pids "$WEB_PORT")" ]; then
      echo "e2e.sh: could not stop the web server it started (pids:${left:- none}; port ${WEB_PORT}: $(port_pids "$WEB_PORT" | tr '\n' ' '))" >&2
      [ "$rc" -ne 0 ] || rc=1
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT
# A signal must reach `cleanup` too: without these, bash dies on TERM or HUP
# without running the EXIT trap, and the server outlives the run again.
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

echo "Starting Expo web dev server on ${WEB_PORT}…"
# --clear because Metro will otherwise serve a bundle built under different
# EXPO_PUBLIC_* values (see docs/INHERITED-STACK.md lesson 4).
#
# `exec` inside the subshell, so `$!` is the server itself and not a subshell
# whose death would leave it running.
( cd app && CI=1 EXPO_PUBLIC_USE_EMULATORS=1 \
    exec npx expo start --web --port "$WEB_PORT" --clear >"$WEB_LOG" 2>&1 ) &
WEB_PID=$!

# Wait for the dev server. The refusal above means whatever answers on this port
# is the server we just started — but check the log for the "port in use" case
# explicitly, because that is the failure that silently serves stale code.
ready=""
for _ in $(seq 1 90); do
  if grep -qi "is being used by another process" "$WEB_LOG" 2>/dev/null; then
    echo "Another process grabbed port ${WEB_PORT}; refusing to test stale code." >&2
    exit 1
  fi
  if curl -sf -o /dev/null "http://127.0.0.1:${WEB_PORT}/"; then
    ready=1
    break
  fi
  sleep 2
done
if [ -z "$ready" ]; then
  echo "Expo web dev server never became ready — see $WEB_LOG" >&2
  tail -25 "$WEB_LOG" >&2 || true
  exit 1
fi

# The secrets the functions bind, as the placeholders ci-tools.json names
# (functions/.secret.local): unset, the Functions emulator asks the real
# Secret Manager for them.
npx --no sabeel-ci emulator-secrets

# Each suite under `firebase emulators:exec` of its own, which starts the
# emulators empty and stops them once the suite ends.
#
# A child, never `exec`: exec replaces this shell and takes the EXIT trap with
# it. In the background and `wait`ed on, because bash defers a trap until a
# FOREGROUND child exits: a TERM sent to this script would otherwise sit there
# until the suite finished. The run's exit status is passed on via `cleanup`.
failed=()
for suite in "${SUITES[@]}"; do
  echo "=== ${suite}"
  firebase emulators:exec \
    --project "$PROJECT" \
    --only firestore,auth,functions,storage \
    "node ${suite}" &
  FB_PID=$!
  rc=0
  wait "$FB_PID" || rc=$?
  FB_PID=""
  [ "$rc" -eq 0 ] || failed+=("${suite} (exit ${rc})")
done
if [ ${#failed[@]} -gt 0 ]; then
  echo "e2e.sh: ${#failed[@]} of ${#SUITES[@]} suite(s) failed: ${failed[*]}" >&2
  exit 1
fi
