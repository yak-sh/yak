#!/bin/sh
# A provider that is not one: it prints the JSONL an agent would print, then
# exits. It exists so the whole machine — request, launch, detach, tail, adopt,
# stop — is exercised end to end with no model, no key and no network, and in a
# shell rather than a runtime so a test that uses it costs a process and not a
# second.
#
# It speaks claude's dialect, so the reader under test is the shipped one. The
# instruction doubles as the script, which is this fake's nature: a provider
# reads it as work, this reads it as stage directions.
#
#   linger   keep running after the last line, until it is signalled
#   quiet    skip the terminal event — an agent that just stops talking
#   fail     exit 3 instead of 0
#
# Run: fake.sh <session> <model> <instruction>
session=$1
model=$2
said=$3

echo "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"$session\",\"model\":\"$model\"}"
echo "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"working: $said\"}]}}"
echo 'not json, and never a transcript'
case "$said" in
*quiet*) ;;
*) echo "{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"done\",\"usage\":{\"output_tokens\":34}}" ;;
esac
case "$said" in
*linger*) while :; do sleep 0.1; done ;;
esac
case "$said" in
*fail*) exit 3 ;;
esac
exit 0
