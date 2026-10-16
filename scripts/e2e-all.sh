#!/usr/bin/env bash
# Run EVERY end-to-end suite, sequentially, with the port hygiene each one needs.
#
#   scripts/e2e-all.sh              # all suites, stop at the first failure
#   scripts/e2e-all.sh --keep-going # run them all, report failures at the end
#   scripts/e2e-all.sh richtext web # just these, by short name
#
# WHY THIS EXISTS. `e2e.sh` runs ONE suite; CI invokes it once per suite, which
# is right for CI. Locally that left everyone hand-rolling a chain, and the
# hand-rolled chains were the problem:
#
#   1. Two chains running at once each called `dev.sh stop`, so they killed each
#      other's dev server mid-run. The victim then hung, and the NEXT run died
#      on a port the corpse still held.
#   2. Waiters written as `pgrep -f "e2e.sh"` / `until ! pgrep ...` match the
#      WAITING SHELL'S OWN command line, so they wait on themselves forever.
#      This is the same shape as the `pkill -f` trap CLAUDE.md already warns
#      about, and writing the warning down did not stop it being rewritten three
#      times in one session. So the fix is a script, not a rule: there is now
#      nothing left to hand-roll.
#
# RUN IT DETACHED. A single suite is ~10 minutes, because `e2e.sh` builds the
# production web bundle before every one; the full set is well over an hour. Any
# launcher with a timeout — an agent's background command, a CI step budget, an
# ssh session that drops — will be killed long before that, and the `e2e.sh` it
# started is NOT killed with it: it is orphaned, reparented to `systemd --user`,
# and carries on holding port 61210 and the emulator block. The next run then
# fails on a held port, which looks like a broken test and is not. Observed
# repeatedly in one session before the mechanism was understood.
#
#   setsid bash -c 'echo $$ > /tmp/e2e.pid; exec scripts/e2e-all.sh' \
#     > /tmp/e2e.log 2>&1 < /dev/null &
#   # then wait on that PID — `kill -0 $(cat /tmp/e2e.pid)` — never on a pattern
#
# The pidfile matters: `$!` after `setsid` is the wrapper, which exits at once,
# so waiting on it reports success while the suite is still running.
#
# The rules this encodes, and none of them are optional:
#   - one suite at a time, never concurrently;
#   - EVERY port in the block verified free before each suite, not a spot-check
#     of the three you happen to remember;
#   - no process matching by pattern, anywhere;
#   - a suite that cannot start is a FAILURE, not a skip.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PORTS=(61200 61201 61202 61203 61204 61205 61206 61207 61210 8081)

KEEP_GOING=0
SUITES=()
for arg in "$@"; do
  case "$arg" in
    --keep-going) KEEP_GOING=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) SUITES+=("$arg") ;;
  esac
done

# Default to every suite on disk, so a new one is picked up without editing this
# file — the same reasoning as `ciCoverage.test.ts`, which fails when CI misses
# one. A glob that matches nothing must not read as "all suites passed".
if [ ${#SUITES[@]} -eq 0 ]; then
  for f in scripts/*-e2e.mjs; do
    [ -e "$f" ] || continue
    name=$(basename "$f" -e2e.mjs)
    SUITES+=("$name")
  done
fi
if [ ${#SUITES[@]} -eq 0 ]; then
  echo "no e2e suites found in scripts/ — refusing to report success" >&2
  exit 1
fi

# `ss`, not `lsof`: lsof is absent from a non-interactive shell without the
# toolchain env, and a missing lsof turns this into a check that always passes.
ports_held() {
  local held=""
  for p in "${PORTS[@]}"; do
    if ss -ltn 2>/dev/null | grep -q ":$p "; then held="$held $p"; fi
  done
  printf '%s' "$held"
}

require_clear_ports() {
  bash scripts/dev.sh stop >/dev/null 2>&1
  local held
  held=$(ports_held)
  if [ -n "$held" ]; then
    # Do not proceed: a suite started against a half-dead stack fails for
    # reasons that have nothing to do with the code, which is how a bad
    # afternoon starts.
    echo "PORTS STILL HELD:$held — investigate before running anything" >&2
    for p in $held; do
      local pid
      pid=$(ss -lptn "sport = :$p" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
      [ -n "$pid" ] && echo "  $p → pid $pid cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)" >&2
    done
    return 1
  fi
  return 0
}

failed=()
for name in "${SUITES[@]}"; do
  suite="scripts/${name}-e2e.mjs"
  if [ ! -f "$suite" ]; then
    echo "no such suite: $suite" >&2
    failed+=("$name(missing)")
    [ "$KEEP_GOING" = 1 ] && continue || exit 1
  fi

  echo "===== $name ====="
  if ! require_clear_ports; then
    failed+=("$name(ports)")
    [ "$KEEP_GOING" = 1 ] && continue || exit 1
  fi

  # migration-e2e wants ONLY firestore+auth and does not go through e2e.sh —
  # running it through the web harness fails for reasons unrelated to the code.
  #
  # `rc` is the SUITE's status: PIPESTATUS read straight after the pipeline,
  # with nothing between. A `|| true` on the pipeline used to sit there, and
  # under pipefail a failing suite made the pipeline fail, so `true` ran and
  # PIPESTATUS held ITS status — every failed suite was reported as passed.
  # No `set -e` here, so a failing pipeline needs no guard.
  if [ "$name" = "migration" ]; then
    # shellcheck source=scripts/jdk21.sh
    . scripts/jdk21.sh
    npm run build -w @sabeel/shared >/dev/null 2>&1
    firebase emulators:exec --project demo-sabeel-kanban \
      --only firestore,auth "node $suite" 2>&1 | grep -E "checks passed|FAIL|Error|aborted"
    rc=${PIPESTATUS[0]}
  else
    bash scripts/e2e.sh "$suite" 2>&1 | grep -E "checks passed|FAIL|Error:|aborted"
    rc=${PIPESTATUS[0]}
  fi

  if [ "$rc" != 0 ]; then
    echo "  $name FAILED (exit $rc)" >&2
    failed+=("$name")
    [ "$KEEP_GOING" = 1 ] || { bash scripts/dev.sh stop >/dev/null 2>&1; exit 1; }
  fi
done

bash scripts/dev.sh stop >/dev/null 2>&1

if [ ${#failed[@]} -gt 0 ]; then
  echo "FAILED: ${failed[*]}" >&2
  exit 1
fi
echo "all ${#SUITES[@]} e2e suites passed"
