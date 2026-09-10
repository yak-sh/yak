#!/usr/bin/env bash
# One inode shared by all worktrees. Never unlink it: waiters hold this inode.
set -euo pipefail
lock="${TMPDIR:-/tmp}/yaks-throughput-bench.lock"
exec 9<>"$lock"
if ! flock -n 9; then
  owner=$(cat "$lock")
  echo "bench: waiting for lock held by pid ${owner:-unknown (acquiring lock)} ($lock; timeout 1800s)" >&2
  flock -w 1800 9 || { echo 'bench: timed out waiting for benchmark lock' >&2; exit 1; }
fi
printf '%s\n' "$$" > "$lock"
# exec retains fd 9, so the kernel releases the lock on exit, including signals.
# The stale pid text is informational only; flock, never the text, owns the lock.
exec deno run -A "$(dirname "$0")/bench.ts" "$@"
