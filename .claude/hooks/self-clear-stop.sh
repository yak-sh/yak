#!/usr/bin/env bash
#
# self-clear-stop.sh — Stop hook: clear THIS session at turn-end, ASAP.
#
# operate-self-clear declares a ready-marker at a clean boundary but can't /clear its
# own pane mid-turn. The `*/1` holdco-idle-clear cron sends the clear once its gate
# chain passes — but a busy operator gets injected traffic (email/cron/task) every
# 30-60 min, and each injected turn STALES the marker (DROP-STALE), so the cron rarely
# catches a quiet minute. This hook fires the instant the DECLARING turn ends — before
# any successor turn lands to stale the marker — so the clear happens in seconds, not
# up to a minute (or never). The cron stays as the backstop, isMeta rule intact.
# See docs/designs/2026-07-15-stop-hook-self-clear.md.
#
# It runs the EXACT SAME gate chain as the cron via `holdco-idle-clear --once`: it acts
# ONLY if THIS session declared a marker (consent gate) AND the tree is clean AND the
# context is worth clearing AND the pane is at rest with an EMPTY input box. Any gate
# failing (or no marker) is a clean no-op. It ALWAYS exits 0 — a Stop hook must never
# block or fail a turn. Mirrors the robustness of wake-brief.sh / session-snapshot.sh.
set -uo pipefail

# Stop hook payload arrives as JSON on stdin: {session_id, transcript_path, cwd, ...}.
payload="$(cat 2>/dev/null || true)"
sid=""
if command -v jq >/dev/null 2>&1 && [ -n "$payload" ]; then
	sid="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null || true)"
fi

# The gate chain + /clear sender lives in holdco's repo (this is a supervisor mechanism).
# Prefer this repo's own copy (when the operator IS holdco), else holdco's well-known
# install. Absent entirely -> clean no-op (a venture still runs with holdco absent; it
# just falls back to the cron doing the clear, exactly as before this hook existed).
checker=""
for cand in \
	"${CLAUDE_PROJECT_DIR:-$PWD}/bin/holdco-idle-clear" \
	"$HOME/code/holdco/bin/holdco-idle-clear"; do
	[ -x "$cand" ] && { checker="$cand"; break; }
done
[ -n "$checker" ] || exit 0

# Consent + gate check for THIS session only. --once with the session id resolves the
# marker by filename; with no id it falls back to matching $TMUX_PANE (exported into the
# hook env). timeout caps the ~2s pane-at-rest double-sample so a wedged tmux can never
# hang the Stop. Never let a non-zero status escape — the Stop must always complete.
timeout 15 "$checker" --once "$sid" >/dev/null 2>&1 || true
exit 0
