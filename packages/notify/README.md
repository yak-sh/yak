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
- `chat{actor, target}` records an open conversation with a target.

Both `subscription` and `chat` declare uniqueness for `(actor, target)`.
Deleting either referenced entity cascades to its subscriptions; deleting a
notification's target cascades to the notification. Chat references instead use
`death: detach`, clearing the reference when its target is deleted.

Email belongs to [@yaks/mail](../mail), and scheduled reminders belong to
[@yaks/wake](../wake). This package does not send either.

## Exports and example

The root import exports the JSON Schema document `notifyDoc`.
`@yaks/notify/vocab` also exports `docs: [notifyDoc]` for plugin loaders. There
are no tools or effect handlers here.

```ts
import { notifyDoc } from '@yaks/notify'
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'

const vocab = loadVocab([notifyDoc])
const g = graph({ vocab, storage: ram(vocab) })
await g.apply([
  { entity: { eid: 'reader' } },
  { entity: { eid: 'release' } },
  {
    entity: { eid: 'release-watch' },
    subscription: { actor: 'reader', target: 'release', mode: 'watch' },
  },
])
console.log(await g.read('.subscription.mode=watch'))
```

The example stores data only in memory. Use a persistent storage adapter to
retain subscriptions across restarts.

## Compatibility

Deno, Node and browsers. JSON declarations, with no runtime calls.
