#!/bin/zsh
# Three more interleaved passes over the three configurations, 41 rounds each,
# added to results.jsonl.
here=/tmp/claude-1000/-home-yaks-code-tasks/c743d857-89ba-46e0-97a8-25a59d04b780/scratchpad/history
A=$here/copy.db
B=$here/copyB.db
for n in 3 4 5; do
  $here/run.sh journal $A $n 41
  $here/run.sh history $B $n 41
  $here/run.sh neither $A $n 41
done
echo passes done
