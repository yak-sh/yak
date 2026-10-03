# @yaks/trace

A dependency-free runtime activity channel keyed by the object being observed.
Producers use `peek(target)`, which never creates a channel and returns nothing
unless a consumer is subscribed. No trace events, IDs, clocks or metadata are
created on that idle path. Consumers explicitly create a channel, subscribe, and
then read its bounded 256-event history. Unsubscribe stops recording; history
contains only previously observed events, not activity during the gap.

```ts
import { channel, peek } from '@yaks/trace'
import { equal } from '@yaks/testing'

let target = {}
let activity = channel(target)
let received: string[] = []
let stop = activity.subscribe((event) => received.push(event.stage))
let observing = peek(target)
if (observing) {
  let span = observing.begin({
    kind: 'apply',
    name: '@yaks/graph.apply',
    package: '@yaks/graph',
  })
  span?.end({ counts: { bundles: 1 } })
}
equal(received, ['start', 'end'])
equal(activity.history().length, 2)
stop()
equal(peek(target), undefined)
```

`record(target, run)` subscribes for one call and returns `{ result, spans }`. A
**span tree** is an array of events connected by their `id` and `parent`: the
root comes first, followed by its descendants. Each span appears once, as its
end event with `duration`, or as its start event if still open when the call
finishes. Instant events appear whole. The tree keeps phase names, durations,
attribution, outcomes and counts.

```ts
import { peek, record } from '@yaks/trace'
import { equal, ok } from '@yaks/testing'

let target = {}
let captured = await record(target, () => {
  let activity = ok(peek(target))
  let root = ok(activity.begin({ kind: 'apply', name: 'apply' }))
  return Promise.resolve().then(() => {
    activity.begin({
      kind: 'phase',
      name: 'prepare',
      parent: root.id,
    })?.end()
    root.end()
    return 42
  })
})
equal(captured.result, 42)
equal(captured.spans.map((span) => span.name), ['apply', 'prepare'])
equal(captured.spans[1].parent, captured.spans[0].id)
ok(captured.spans.every((span) => span.duration! >= 0))
equal(peek(target), undefined)
```

`run` must begin the operation's root synchronously, before its first `await`;
its descendants carry parent IDs across asynchronous work. Interleaved calls on
the same channel stay out of the tree. Recording ends when `run` returns or its
promise settles, and errors propagate after unsubscribing. A synchronous `run`
returns `{ result, spans }` directly; an asynchronous `run` returns a promise.
The tree is independent of the bounded history, so large calls remain complete,
and concurrent subscribers keep their subscriptions and history.

`Event` exports `id`, optional `parent`, `kind`, `name`, `stage`, monotonic
`time`, optional `start` and `duration`, optional `package` and `plugin`,
optional `outcome`, and numeric `counts`. Kinds are `apply`, `phase`, `rule`,
`query`, `get`, `effect`, `request`, `fanout`, `sql`, and `bench`. Outcomes are
`ok`, `check`, `refused`, `error`, and `interrupted`. A span's start and end
share one string ID; pass that ID as a child's `parent`. IDs are channel-local,
not durable or cross-process identities. `instant(activity, end?)` records a
point event without an open span.

Names identify code, not data. Producers must never include entity IDs, bundle
values, query text, URLs, secrets or credentials. Counts contain only numeric
metrics. Events and count objects are frozen; subscriber failures are isolated
from the producer. A span opened in one recording cannot end in a later
recording after all subscribers disconnected. Duration measures local runtime
work and may be zero on runtimes whose clocks advance only with I/O.

The channel owns no scheduler, durable telemetry, transport, API authentication
or UI. SSE, tools and other views consume this same channel and own their queue,
authorization and unsubscribe lifetimes. Activity from another process is not
implicitly transported alongside graph replication.
