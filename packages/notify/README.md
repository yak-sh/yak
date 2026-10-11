# @yaks/notify

Defines graph components for notifications, watch/mute preferences, and open
chats. These are stored records, not a notification delivery service: the
application decides when to create a notification and how to display or send it.

## Stored data

An entity is a record identified by `entity.eid`; components are named objects
on that record.

- `knock{target}` records a notification for another entity. Put its message in
  a `doc{body}` component from [@yaks/doc](../doc) on the same record.
- `subscription{actor, target, mode}` records whether an actor watches (`watch`)
  or mutes (`mute`) a target. The actor is the entity identifying the recipient.
  An absent mode neither watches nor mutes. Personal `opened{at, by, via}` and
  `archived{at, by, via}` marks from [@yaks/kernel](../kernel) sit on this row,
  not on the target; clearing the mode preserves attention.
- `chat{actor, target}` records an open conversation with a target.

Both `subscription` and `chat` declare uniqueness for `(actor, target)`.
Deleting either referenced entity cascades to its subscriptions; deleting a
notification's target cascades to the notification. Chat references instead use
`death: detach`, clearing the reference when its target is deleted.

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

```ts
import { notifyDoc } from '@yaks/notify'
import { markAttention } from '@yaks/notify/attention'
import { kernelDoc } from '@yaks/kernel'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'

const vocab = loadVocab([notifyDoc, kernelDoc])
const g = graph({ vocab, storage: ram(vocab) })
const reader = mint()
const release = mint()
await g.apply([
  {
    entity: { eid: 'release-watch' },
    subscription: { actor: reader, target: release, mode: 'watch' },
  },
])
await g.apply(await markAttention(g, reader, release, 'opened'))
const [attention] = await g.get(['release-watch'])
equal(attention.subscription?.mode, 'watch')
equal(!!attention.opened, true)
equal((await g.get([release]))[0]?.opened, undefined)
```

The example stores data only in memory. Use a persistent storage adapter to
retain subscriptions across restarts.

## Compatibility

Deno, Node and browsers. The root exports are pure; the `./attention` boundary
reads a graph and returns patches for its caller to apply.
