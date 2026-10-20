#!/bin/zsh
# One counted pass: statements and SQLite time per measurement.
here=/tmp/claude-1000/-home-yaks-code-tasks/c743d857-89ba-46e0-97a8-25a59d04b780/scratchpad/history
rm -f $here/results.jsonl
$here/run.sh journal $here/copy.db 6 41
$here/run.sh history $here/copyB.db 6 41
$here/run.sh neither $here/copy.db 6 41
mv $here/results.jsonl $here/results-counted.jsonl
