#!/bin/zsh
# run.sh <kind> <db> <tag> [rounds]: one bench run, its JSON lines kept.
here=/tmp/claude-1000/-home-yaks-code-tasks/c743d857-89ba-46e0-97a8-25a59d04b780/scratchpad/history
cd /home/yaks/code/tasks/.claude/worktrees/agent-af10fb6e0f3e3e2d3 || exit 1
start=$(date +%s)
timeout 1200 deno run -A --config deno.json packages/sqlite/history_bench.ts "$2" "$1" "${4:-21}" > "$here/run-$1-$3.log" 2>&1
code=$?
grep '^{' "$here/run-$1-$3.log" >> "$here/results.jsonl"
echo "$1 $3 exit $code in $(( $(date +%s) - start ))s load $(cut -d' ' -f1 /proc/loadavg)"
grep -v '^{' "$here/run-$1-$3.log" | grep -iv 'warning\|ignored\|npm:\|lifecycle\|nodeModulesDir\|enable it\|╭\|╰' | grep -v '^\s*│\s*$' | tail -15
