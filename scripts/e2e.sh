#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Web end-to-end against the emulators.
#
# Drives the Expo web DEV server, not an exported bundle: `expo export` sets
# __DEV__ false, which correctly strips the emulator dev sign-in this flow needs
# to drive. The script also builds the PRODUCTION bundle and asserts the dev row
# is absent from it — so the safety property is tested, not assumed.

# shellcheck source=scripts/jdk21.sh
. "$(dirname "$0")/jdk21.sh"
# shellcheck source=scripts/lib/procs.sh
. "$(dirname "$0")/lib/procs.sh"
if [ -z "$PORT_TOOL" ]; then
  echo "e2e.sh: neither ss nor lsof found; cannot check the web port" >&2
  exit 1
fi

WEB_PORT=61210
export E2E_BASE="http://127.0.0.1:${WEB_PORT}/"

npm run build -w @sabeel/shared
npm run build -w functions

echo "Building production web bundle (for the dev-row absence check)…"
( cd app && npx expo export --platform web --output-dir dist-web --clear >/dev/null )

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
# and the final `exec firebase` meant this trap never ran at all: every run
# left a dev server on 61210 for the next one to trip over.
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
# EXPO_PUBLIC_FCM_VAPID_KEY is set to a FAKE value on purpose, and only here.
#
# `canRequestPush()` in notify.web.ts needs nothing but a truthy key, and
# without one it reports 'unsupported' whatever the browser would actually
# permit — so the notifications panel had exactly one reachable state in CI, and
# the check that it "says exactly one thing about this device" could never see
# the other three. The permission states are the point of that panel.
#
# The value is deliberately NOT shaped like a VAPID key: `check-web-push.mjs`
# looks for 87 base64url characters, so if this ever reached an exported bundle
# the release gate would fail with "no VAPID key" rather than pass on a fake.
# Nothing here can reach `getToken` in any case — `claimToken` returns on
# USE_EMULATORS before the key is ever used.
#
# Set on THIS LINE, never exported: the production export above must stay
# keyless, which is what makes the dev-row and gate checks mean anything.
#
# `exec` inside the subshell, so `$!` is the server itself and not a subshell
# whose death would leave it running.
( cd app && CI=1 EXPO_PUBLIC_USE_EMULATORS=1 \
    EXPO_PUBLIC_FCM_VAPID_KEY=e2e-fake-vapid-key-not-a-real-one \
    exec npx expo start --web --port "$WEB_PORT" --clear >/tmp/sk-web-e2e.log 2>&1 ) &
WEB_PID=$!

# Wait for the dev server. The refusal above means whatever answers on this port
# is the server we just started — but check the log for the "port in use" case
# explicitly, because that is the failure that silently serves stale code.
ready=""
for _ in $(seq 1 90); do
  if grep -qi "is being used by another process" /tmp/sk-web-e2e.log 2>/dev/null; then
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
  echo "Expo web dev server never became ready — see /tmp/sk-web-e2e.log" >&2
  tail -25 /tmp/sk-web-e2e.log >&2 || true
  exit 1
fi

# Which suite to drive. Defaults to the full flow; pass a script to run a
# focused one against the same stack (e.g. scripts/attachments-e2e.mjs).
SUITE="${1:-scripts/web-e2e.mjs}"

# A child, never `exec`: exec replaces this shell and takes the EXIT trap with
# it. In the background and `wait`ed on, because bash defers a trap until a
# FOREGROUND child exits: a TERM sent to this script would otherwise sit there
# until the suite finished. The suite's exit status is passed on via `cleanup`.
firebase emulators:exec \
  --project demo-sabeel-kanban \
  --only firestore,auth,functions,storage \
  "node ${SUITE}" &
FB_PID=$!
rc=0
wait "$FB_PID" || rc=$?
exit "$rc"
