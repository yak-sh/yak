# @yaks/notify

How somebody is told.

- `knock{target}` — a nudge aimed at an entity, with the message that came with
  it.
- `subscription{actor, target, mode}` — whether an actor watches an entity or
  mutes it.
- `chat{actor, target}` — an open conversation with an entity, one per
  actor/entity pair.

A letter belongs to [@yaks/mail](../mail); a reminder belongs to
[@yaks/wake](../wake). This package covers the rest of being notified.

## Compatibility

Deno and Node — a JSON document, with no runtime calls.
