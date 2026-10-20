#!/bin/zsh
# The three configurations, twice each, interleaved so load swings on the box
# fall on all of them alike; then the storage comparison.
here=/tmp/claude-1000/-home-yaks-code-tasks/c743d857-89ba-46e0-97a8-25a59d04b780/scratchpad/history
A=$here/copy.db
B=$here/copyB.db
rm -f $here/results.jsonl
$here/run.sh journal $A 1 21
$here/run.sh history $B 1 21
$here/run.sh neither $A 1 21
$here/run.sh history $B 2 21
$here/run.sh neither $A 2 21
$here/run.sh journal $A 2 21
python3 -I $here/storage.py $A $B > $here/storage.txt 2>&1
echo storage done
