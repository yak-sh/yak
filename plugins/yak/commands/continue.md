---
description: Carry this conversation to another model in yak, or bring a yak session here
argument-hint: '[provider/]model [words] | S-<n>'
disable-model-invocation: true
---

The yak prompt hook answers `/yak:continue` before you are asked anything, and
it did not answer `/yak:continue $ARGUMENTS`: yak serve is not reachable at the
address the yak plugin's `server` option names.

In one line, tell the person to start `yak serve` (or run `yak hooks install`,
which points the plugin at it) and send the command again. Do nothing else.
