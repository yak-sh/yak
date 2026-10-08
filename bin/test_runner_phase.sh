#!/usr/bin/env bash
# A phase for test_runner_fixture.ts's runner to own: a leader that starts a
# grandchild in its process group, each writing what it was sent to files in
# the case's directory. A shell rather than a runtime, so a case costs a
# process and not a Deno start. Bash, because a grandchild started with `&`
# has SIGINT ignored, and only bash lets it trap that signal again.
#
#   <name>.ready         the leader ran (its pid), before any exit code
#   <name>.leader.signals  each signal a stubborn leader got, one a line
#   grandchild.pid       the grandchild, once it handles both signals
#   grandchild.signal    the first signal it got
#   grandchild.signals   each signal it got, one a line
#
# A grandchild exits on its first signal once the case writes `release`, so
# the runner's settlement is still in flight while the case sends more; a
# stubborn one, and its leader, outlive every signal but SIGKILL.
#
# Run: test_runner_phase.sh [stubborn-]<name> <dir> [code]
exec 2>/dev/null
phase=$1
dir=$2
code=$3
name=${phase#stubborn-}
stubborn=${phase%%-*}
[ "$stubborn" = stubborn ] || stubborn=

echo $$ >"$dir/$name.ready"
[ -n "$code" ] && exit "$code"

if [ "$stubborn" ]; then
  trap "echo SIGINT >>'$dir/$name.leader.signals'" INT
  trap "echo SIGTERM >>'$dir/$name.leader.signals'" TERM
fi

(
  signal=
  got() {
    signal=${signal:-$1}
    printf %s "$signal" >"$dir/grandchild.signal"
    echo "$1" >>"$dir/grandchild.signals"
  }
  trap 'got SIGINT' INT
  trap 'got SIGTERM' TERM
  echo $BASHPID >"$dir/grandchild.pid"
  while [ "$stubborn" ] || [ -z "$signal" ] || [ ! -e "$dir/release" ]; do
    sleep 0.005
  done
  [ "$signal" = SIGINT ] && exit 130
  exit 143
) &

while :; do sleep 0.01; done
