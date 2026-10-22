#!/usr/bin/env bash
# Run EVERY browser suite, sequentially, with the port hygiene each one needs.
#
#   scripts/e2e-all.sh              # all suites, stop at the first failure
#   scripts/e2e-all.sh --keep-going # run them all, report failures at the end
#   scripts/e2e-all.sh richtext web # just these, by short name
#
# The suites are CI's: the npm scripts ci-tools.json lists in
# `ci.browserSuites`, each `bash scripts/e2e.sh <suite>`. A short name is the
# script's last word: `screens` is `test:screens`, `web` is `test:e2e`, and any
# other `<name>` is `test:e2e:<name>`. The board-ownership migration rehearsal
# is not one of them: it runs inside `npm run test:emulator`.
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
# and carries on holding the web port and the emulator block. The next run then
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

# Every port of this checkout's block, from ci-tools (`sabeel-ci ports` prints
# one "<port> <name>" per line), and Metro's 8081, which every React Native
# checkout on the machine shares.
PORTS=()
while read -r port _; do PORTS+=("$port"); done < <(npx --no sabeel-ci ports)
if [ "${#PORTS[@]}" -eq 0 ]; then
  echo "e2e-all.sh: sabeel-ci ports gave no ports (npm ci first?)" >&2
  exit 1
fi
PORTS+=(8081)

KEEP_GOING=0
SUITES=()
for arg in "$@"; do
  case "$arg" in
    --keep-going) KEEP_GOING=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) SUITES+=("$arg") ;;
  esac
done

# Default to CI's list, so a suite CI runs is run here without editing this
# file; `ciCoverage.test.ts` fails when a suite on disk is missing from it. An
# empty list must not read as "all suites passed".
if [ ${#SUITES[@]} -eq 0 ]; then
  while read -r script; do
    case "$script" in
      test:screens) SUITES+=(screens) ;;
      test:e2e) SUITES+=(web) ;;
      *) SUITES+=("${script#test:e2e:}") ;;
    esac
  done < <(node -p "require('./ci-tools.json').ci.browserSuites.join('\n')")
fi
if [ ${#SUITES[@]} -eq 0 ]; then
  echo "no browser suites in ci-tools.json — refusing to report success" >&2
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
  case "$name" in
    screens) script=test:screens ;;
    web) script=test:e2e ;;
    *) script="test:e2e:$name" ;;
  esac
  if ! node -e "process.exit(require('./package.json').scripts[process.argv[1]] ? 0 : 1)" "$script"; then
    echo "no such suite: npm run $script" >&2
    failed+=("$name(missing)")
    [ "$KEEP_GOING" = 1 ] && continue || exit 1
  fi

  echo "===== $name ====="
  if ! require_clear_ports; then
    failed+=("$name(ports)")
    [ "$KEEP_GOING" = 1 ] && continue || exit 1
  fi

  # `rc` is the SUITE's status: PIPESTATUS read straight after the pipeline,
  # with nothing between. A `|| true` on the pipeline would sit there, and
  # under pipefail a failing suite made the pipeline fail, so `true` ran and
  # PIPESTATUS held ITS status — every failed suite was reported as passed.
  # No `set -e` here, so a failing pipeline needs no guard.
  npm run "$script" 2>&1 | grep -E "checks passed|FAIL|Error:|aborted"
  rc=${PIPESTATUS[0]}

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
