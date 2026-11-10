# @yaks/notify

Defines graph components for notifications, watch/mute preferences, and open
chats. These are stored records, not a notification delivery service: the
application decides when to create a notification and how to display or send it.

## Stored data

An entity is a record identified by `entity.eid`; components are named objects
on that record.

- `knock{target, from}` records a nudge aimed at another entity, one that asks
  for attention. Put its message in a `doc{body}` component from
  [@yaks/doc](../doc) on the same record. `from` names whose act or words it
  tells, where it tells someone's: the actor who finished a task, the person who
  sent a text. A knock its writer says for itself leaves it out.
- `notification{about}` records words emitted, not said, telling someone what
  happened to `about` (which may live in another graph). Its words are its
  `doc{body}`, and who it is for is [@yaks/mail](../mail)'s `deliver{to}`: a
  person, or a project for everyone standing in it. It is a thread of its own;
  @yaks/inbox lanes it as Updates.
- `subscription{actor, target, mode}` records whether an actor watches (`watch`)
  or mutes (`mute`) a target. The actor is the entity identifying the recipient.
  An absent mode neither watches nor mutes. Personal `opened{at, by, via}` and
  `archived{at, by, via}` marks from [@yaks/kernel](../kernel) sit on this row,
  not on the target; clearing the mode preserves attention.
- `chat{actor, target}` records an open conversation with a target.

Both `subscription` and `chat` declare uniqueness for `(actor, target)`.
Deleting either referenced entity cascades to its subscriptions; deleting a
knock's target cascades to the knock, while a notification keeps its `about` and
a knock its `from`. Chat references instead use `death: detach`, clearing the
reference when its target is deleted.

Email belongs to [@yaks/mail](../mail), and scheduled reminders belong to
[@yaks/wake](../wake). This package does not send either.

## Exports and example

The root import exports `notifyDoc`, the pure `threadOf` subject policy, and
`attention`, atomic mark replacement bundles. `@yaks/notify/attention` exports
`markAttention(graph, actor, target, mark)`, which reuses the actor/target row
and returns patches for its personal mark. `ancestry(graph, letter)` follows
`mail.reply_to` by eid or Message-ID and returns the letter followed by its
ancestors. It checks `mail.message_id` and `notified.message_id` where the graph
declares them, so an empty identity created for a Message-ID reference does not
become the thread root. `@yaks/notify/vocab` also exports `docs: [notifyDoc]`
for plugin loaders. There are no tools or effect handlers here.

To refresh the mark on an existing subscription, apply the bundles returned by
`attention` to that subscription's eid:

```ts
import { attention } from '@yaks/notify'
import { equal } from '@yaks/testing'

const patches = attention('release-watch', 'opened')
equal(patches, [
  { entity: { eid: 'release-watch' }, opened: null },
  { entity: { eid: 'release-watch' }, opened: {} },
])
```

The first patch clears the previous mark; the second gets a fresh server stamp.
When the subscription's eid is unknown, use
`await graph.apply(await markAttention(graph, reader, release, 'opened'))`. This
finds or creates the actor/target row while preserving its watch/mute mode.

## Compatibility

Deno, Node and browsers. The root exports are pure; the `./attention` boundary
reads a graph and returns patches for its caller to apply.
