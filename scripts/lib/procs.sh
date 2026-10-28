# shellcheck shell=bash
# Process helpers for the dev scripts. Sourced, never run: `dev.sh` and
# `e2e.sh` share these so "who holds this port" and "what did I start" have
# one answer each, on Linux and on macOS alike.
#
# NOTHING HERE MATCHES A PROCESS BY NAME. A pattern matches other checkouts,
# sibling projects and the shell running the pattern (CLAUDE.md, "NEVER match
# a process by pattern"). Everything is by pid, parent pid or process group.
#
# Bash 3.2 compatible: macOS ships it, and these run there.

# Pick the port tool once. `ss` and `grep -P` are Linux-only, and `lsof` is
# missing from a non-interactive Linux shell without the toolchain env, so an
# empty answer must never mean "I could not look". Checked by the caller at
# source time: `exit` inside a `$(...)` would end only the substitution.
if command -v ss >/dev/null 2>&1; then
  PORT_TOOL=ss
elif command -v lsof >/dev/null 2>&1; then
  PORT_TOOL=lsof
else
  PORT_TOOL=
fi

# Pids listening on TCP port $1, one per line. Succeeds with no output when
# nothing listens: `lsof` exits 1 then, and under `set -e -o pipefail` (e2e.sh)
# that silently ended the caller.
port_pids() {
  if [ "$PORT_TOOL" = ss ]; then
    # sed, not `grep -oP`: BSD grep has no -P and fails closed, silently.
    ss -lptn "sport = :$1" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u || true
  else
    lsof -ti:"$1" -sTCP:LISTEN 2>/dev/null | sort -u || true
  fi
}

# The working directory of pid $1, physical path, or nothing if it is gone.
cwd_of() {
  readlink "/proc/$1/cwd" 2>/dev/null \
    || lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true
}

# Pid $1 and every descendant, children before parents. Walked by PARENT pid,
# and collected before anything is signalled: once a parent dies its children
# are reparented and can no longer be found from it.
pid_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    pid_tree "$child"
  done
  echo "$1"
}

# Members of process group $1, one pid per line. Numeric compare on the pgid
# column, not a match on anyone's command line.
group_pids() {
  ps -A -o pid= -o pgid= 2>/dev/null | awk -v g="$1" '$2 == g { print $1 }' || true
}

# Whether pid $1 is still running. A zombie is not: it has exited and only
# waits for its parent to reap it, which for the caller's own children happens
# after the caller's trap returns, so `kill -0` alone reports them alive.
running() {
  kill -0 "$1" 2>/dev/null || return 1
  case "$(ps -o stat= -p "$1" 2>/dev/null)" in Z*) return 1 ;; esac
  return 0
}

# Send TERM to pids "$@", wait up to 10s for them to go, KILL the rest.
# Prints the pids still running after that (none, normally).
terminate() {
  local pid alive
  [ "$#" -gt 0 ] || return 0
  kill "$@" 2>/dev/null || true
  for _ in $(seq 1 20); do
    alive=""
    for pid in "$@"; do running "$pid" && alive="$alive $pid"; done
    [ -z "$alive" ] && return 0
    sleep 0.5
  done
  # shellcheck disable=SC2086 # word-split on purpose: a list of pids
  kill -9 $alive 2>/dev/null || true
  sleep 0.5
  for pid in $alive; do running "$pid" && echo "$pid"; done
  return 0
}
