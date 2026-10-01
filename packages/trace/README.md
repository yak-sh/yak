# @yaks/trace

A dependency-free runtime activity channel keyed by the object being observed.
Producers use `peek(target)`, which never creates a channel and returns nothing
unless a consumer is subscribed. No trace events, IDs, clocks or metadata are
created on that idle path. Consumers explicitly create a channel, subscribe, and
then read its bounded 256-event history. Unsubscribe stops recording; history
contains only previously observed events, not activity during the gap.

```ts
import { channel, peek } from '@yaks/trace'

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
console.assert(received.join(',') == 'start,end')
console.assert(activity.history().length == 2)
stop()
console.assert(peek(target) == undefined)
```

`Event` exports `id`, optional `parent`, `kind`, `name`, `stage`, monotonic
`time`, optional `start` and `duration`, optional `package` and `plugin`,
optional `outcome`, and numeric `counts`. Kinds are `apply`, `phase`, `rule`,
`query`, `get`, `effect`, `request`, and `fanout`. Outcomes are `ok`, `check`,
`refused`, `error`, and `interrupted`. A span's start and end share one string
ID; pass that ID as a child's `parent`. IDs are channel-local, not durable or
cross-process identities. `instant(activity, end?)` records a point event
without an open span.

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
