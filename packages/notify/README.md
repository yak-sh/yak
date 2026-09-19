# @yaks/notify

How somebody is told.

- `knock{target}` — a nudge pointed at a thing, with the words that rode along.
- `subscription{actor, target, mode}` — watch it, or mute it.
- `chat{actor, target}` — an open conversation with a thing, one per pair.

A letter is [@yaks/mail](../mail)'s; a reminder is [@yaks/wake](../wake)'s. This
is the rest of being told.

## Compatibility

Deno and Node — a JSON document, no runtime calls.
