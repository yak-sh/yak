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
promise settles, and errors propagate after unsubscribing.
`record(target, run,
{ parent })` explicitly links the nominated root to an
outer span while still returning only its own complete tree; without that option
a nominated root does not inherit an ambient parent. A synchronous `run` returns
`{ result, spans }` directly; an asynchronous `run` returns a promise. The tree
is independent of the bounded history, so large calls remain complete, and
concurrent subscribers keep their subscriptions and history.

`Event` exports `id`, optional `parent`, `kind`, `name`, `stage`, monotonic
`time`, optional `start` and `duration`, optional `package` and `plugin`,
optional `outcome`, and numeric `counts`. Kinds are `apply`, `phase`, `rule`,
`query`, `get`, `effect`, `request`, `fanout`, `sql`, `bench`, and
`process-start`. Outcomes are `ok`, `check`, `refused`, `error`, and
`interrupted`. A span's start and end share one string ID; pass that ID as a
child's `parent`. IDs are channel-local, not durable or cross-process
identities. `instant(activity, end?)` records a point event without an open
span.

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

A `process-start` span records host startup, distinct from an `apply` span's
`compose` phase. `@yaks/cli.compose` emits it on the config object's channel,
with `phase` children for its parts. Subscribe to that config before calling
`compose`; subscribing to the graph after it opens cannot observe startup.

```ts
import { equal } from '@yaks/testing'
import { channel } from '@yaks/trace'

let config = {}
let c = channel(config)
let stop = c.subscribe(() => {})
let root = c.begin({ kind: 'process-start', name: '@yaks/cli.compose' })
let part = c.begin({
  kind: 'phase',
  name: '@yaks/cli.compose.sqlite',
  parent: root?.id,
})
part?.end()
root?.end()
equal(c.history().at(-1)?.kind, 'process-start')
stop()
```

`during(span, run)` makes that span available to synchronous boundaries through
`context()` and `peek()` without a target. `scope(context, run)` restores a
captured context at an asynchronous boundary. Both restore the caller when `run`
returns, throws or returns a promise. Without a host-installed context carrier,
context never stays ambient across an `await`. `context(ancestorId)` returns the
current context only when that span is in its synchronous ancestry, so a
retained boundary can keep its own operation's parent during reentrant work.
Expired recordings return no context.

```ts
import { context, during, peek, record, scope } from '@yaks/trace'
import { equal, ok } from '@yaks/testing'

let target = {}
let captured = record(target, () => {
  let c = ok(peek(target))
  return during(c.begin({ kind: 'apply', name: 'apply' }), () => {
    let at = ok(context())
    scope(at, () => {
      equal(peek(), c)
      equal(context()?.parent, at.parent)
    })
    return at
  })
})
equal(context(), undefined)
// The recorder disconnected: captured contexts cannot revive its recording.
scope(captured.result, () => equal(peek(), undefined))
equal(peek(), undefined)
```

A **context carrier** provides task-local context through `get()` and `run()`.
`installContext(carrier)` lets a host supply one without adding a runtime
dependency to this package. `during()` and `scope()` then preserve their context
across awaits. A child with no explicit parent inherits that context's parent
only on the same channel. The cleanup returned by `installContext` restores the
previous carrier.

```ts
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  context,
  during,
  installContext,
  measure,
  peek,
  record,
} from '@yaks/trace'
import type { Context } from '@yaks/trace'
import { equal, ok } from '@yaks/testing'

let local = new AsyncLocalStorage<Context | undefined>()
let restore = installContext({
  get: () => local.getStore(),
  run: (ctx, run) => local.run(ctx, run),
})
try {
  let target = {}
  let captured = await record(target, () => {
    let c = ok(peek(target))
    return during(c.begin({ kind: 'request', name: 'request' }), async () => {
      await Promise.resolve()
      return during(c.begin({ kind: 'sql', name: 'book select' }), () => {
        measure({ statements: 1, rowsRead: 4 })
        equal(context()?.channel, c)
      })
    })
  })
  equal(captured.spans[1].parent, captured.spans[0].id)
  equal(captured.spans[0].counts, { statements: 1, rowsRead: 4 })
} finally {
  restore()
}
```

`measure(counts)` charges numeric measurements to the current span and its open
ancestors. Its totals are inclusive: charging a SQL statement once gives both
that SQL span and its enclosing request the statement's row counts. Siblings and
interleaved requests do not charge each other. An accumulated measurement
replaces a same-named count supplied to `end`; other end counts are preserved.

`shareChannel(target, source)` makes two objects use the same channel. A host
whose graph is replaced can retain its own channel and give each graph that
channel; sharing creates no subscriber.

```ts
import { during, peek, record, shareChannel } from '@yaks/trace'
import { equal, ok } from '@yaks/testing'

let host = {}
let graph = {}
shareChannel(graph, host)
let captured = record(host, () => {
  let c = ok(peek(host))
  return during(c.begin({ kind: 'request', name: 'request' }), () => {
    ok(peek(graph)).begin({ kind: 'get', name: 'get' })?.end()
  })
})
equal(captured.spans[1].parent, captured.spans[0].id)
equal(peek(graph), undefined)
```

A request recorder can use `record(target, run, { history: false })` to keep
only its returned tree, without retaining its events in channel history. Other
subscribers that ask for history continue receiving it. The default keeps
history for live inspection.
