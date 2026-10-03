# @yaks/sync

Synchronizes a client graph with a server, applies live query updates, and
reconciles optimistic writes or reverts them when refused. Use it with
[@yaks/graph](../graph/README.md#data-model) and a server implementing
[@yaks/api](../api/README.md).

A **Sync** is a graph's connection to a server, returned by `sync()`. It
registers a [plugin](../graph/README.md#data-model) that posts local
[changes](../graph/README.md#data-model) to `/apply` and applies server updates
received on `/ws`.

A Sync holds [subscriptions](../api/README.md#subscriptions) under ids and
applies their [frames](../api/README.md#subscriptions). A subscription can ask
for a [query](../query/README.md#query-model) or `true` for the raw stream of
committed patches.

An **optimistic write** is a change committed locally before the server answers
it. `report` receives a `Trouble`: the sent bundles,
[refusal](../api/README.md#refusals-and-request-reports) or transport error, and
whether the optimistic write was reverted. `Refusal` carries the server's
`error`, `message`, and optional error-specific fields.

## Install

```sh
deno add jsr:@yaks/sync jsr:@yaks/graph jsr:@yaks/ram jsr:@yaks/vocab
# Node projects: npx jsr add @yaks/sync @yaks/graph @yaks/ram @yaks/vocab
```

## Connect and write

Both HTTP and socket transports can be injected. This example supplies an HTTP
response in process; no server or network is needed. Applications normally use
the default global `fetch` and `WebSocket`.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { sync } from '@yaks/sync'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { component: true, properties: { title: { type: 'string' } } },
  },
})
const g = graph({ storage: ram(vocab), vocab })
g.install()
const link = sync(g, {
  url: 'https://books.example',
  fetch: async (request) => {
    equal(request.method, 'POST')
    equal(new URL(request.url).pathname, '/apply')
    const sent = await request.json()
    equal(sent[0].book, { title: 'Dune' })
    return Response.json([{ entity: { eid: 'b1' }, book: { title: 'DUNE' } }])
  },
})
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Dune' } }])
equal((await g.get(['b1']))[0].book, { title: 'Dune' })
await link.idle()
equal((await g.get(['b1']))[0].book, { title: 'DUNE' })
link.close()
```

With synchronous storage and hooks, `apply()` commits locally synchronously.
Awaiting it does not await the server; `idle()` waits for the queued HTTP
requests to settle, including failures. Requests are sent serially in local
commit order. Use [RAM's adoption options](../ram/README.md) when the client
must accept server-assigned entity numbers.

An accepted response contains applied patches, including server-generated
numbers, stamps, and tombstones, rather than complete snapshots. The Sync
applies it with `trusted: true` and `replica: true`, excluding components the
client's vocabulary does not declare. What local rules added to server-stored
components is undone before that response lands.

A refusal reverts the sent properties and everything the write's rules added.
Caller-written local and peer values stay. A transport failure keeps the local
change: the server may have applied it before the connection failed. There is no
automatic HTTP retry.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { sync, type Trouble } from '@yaks/sync'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { component: true, properties: { title: { type: 'string' } } },
  },
})
const g = graph({ storage: ram(vocab), vocab })
g.install()
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Dune' } }])
const trouble: Trouble[] = []
let unreachable = false
const link = sync(g, {
  url: 'https://books.example',
  fetch: () => {
    if (unreachable) throw new Error('connection lost')
    return Response.json({ error: 'Denied', message: 'read only' }, {
      status: 403,
    })
  },
  report: (t) => trouble.push(t),
})
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Changed' } }])
await link.idle()
equal((await g.get(['b1']))[0].book, { title: 'Dune' })
equal(trouble[0].reverted, true)
unreachable = true
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Unconfirmed' } }])
await link.idle()
equal((await g.get(['b1']))[0].book, { title: 'Unconfirmed' })
equal(trouble[1].reverted, false)
unreachable = false
await g.apply([{ entity: { eid: 'b1' }, $delete: true }])
await link.idle()
equal((await g.get(['b1']))[0].tombstone, undefined)
equal(trouble[2].reverted, false)
link.close()
```

A change containing a deletion waits for the server in its entirety. Deletion
has no local inverse; an accepted response supplies the tombstones. The inverse
patches for optimistic writes affect touched properties and do not implement
general conflict resolution for overlapping writes.

`submit(bundles)` uses the same HTTP queue but waits for the server to resolve
identity before applying its answer. It rejects on refusal or transport failure.
Its caller must remove browser-owned components first;
[@yaks/client](../client/README.md) does this for alias writes.

## Select outgoing state

The vocabulary owns
[sync, durable, pace, and save](../vocab/README.md#state-lifetimes). `syncOf`
and `durableOf` are re-exported from that package. This package selects
components for each transport:

| Helper                    | Result                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `outbound(vocab, name)`   | Whether the component leaves this node (`sync` is not `none`).                                     |
| `stored(vocab, name)`     | Whether stored snapshots include it (`server`, or peers with `save`).                              |
| `local(vocab, name)`      | `'vault'` for local persistent state, `'memory'` for other local state, `null` for outgoing state. |
| `outward(bundles, vocab)` | Caller-written server components and writable properties, retaining `$was` and deletion requests.  |
| `inverse(bundles, vocab)` | Patches reverting a refused optimistic write.                                                      |
| `guessed(bundles, vocab)` | Patches undoing local rules' server-stored results before an accepted response.                    |

`local()` describes storage the caller must provide; it neither persists nor
expires data. Computed and stamped properties are excluded from outgoing writes,
as are patches added by local rules or later write phases.

The helpers recognize caller-written bundles through `$sent`, a
[request](../graph/README.md#data-model) containing the prior bundle. `asking`
adds it; `asked` tests it; `before` reads that prior bundle. `$ruled` records
rule-added bundles through `ruling` and `ruled`. `$echo` identifies server
updates through `echo` and `echoed`. `clean` removes all three requests. `SENT`,
`RULED`, and `ECHO` export their names.

```ts
import { loadVocab } from '@yaks/vocab'
import {
  asked,
  asking,
  before,
  clean,
  inverse,
  local,
  outbound,
  outward,
  stored,
} from '@yaks/sync'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { component: true, properties: { title: { type: 'string' } } },
    draft: {
      component: true,
      sync: 'none',
      properties: { text: { type: 'string' } },
    },
  },
})
const was = { entity: { eid: 'b1' }, book: { title: 'Dune' } }
const patch = {
  entity: { eid: 'b1' },
  book: { title: 'Changed' },
  draft: { text: 'local' },
}
const sent = asking(patch, was)
equal(asked(sent), true)
equal(before(sent), was)
equal(clean(sent), patch)
equal(outward([sent], vocab), [{
  entity: { eid: 'b1' },
  book: { title: 'Changed' },
}])
equal(inverse([sent], vocab), [was])
equal(local(vocab, 'draft'), 'vault')
equal(outbound(vocab, 'draft'), false)
equal(stored(vocab, 'book'), true)
```

Peer components travel over the socket. Each write commits locally immediately;
`pace` folds intermediate writes into one patch per entity and component. The
first write after a quiet interval leaves immediately; the last folded patch
leaves when the interval ends. Clearing a component sends immediately and
discards its folded patch. Values sent together share their pace timer.

The Sync keeps its own peer values across socket connections and sends them
again before resubscribing. The server associates each value with its latest
writing connection, so an older connection's close cannot clear the value
claimed by the newer connection. A saved peer snapshot cannot replace a newer
value this node is still writing.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { hear, sync } from '@yaks/sync'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    cursor: {
      component: true,
      sync: 'peers',
      durable: 'connection',
      pace: '100ms',
      properties: { x: { type: 'number' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })
g.install()
const events = new EventTarget()
const messages: unknown[] = []
const timers: (() => void)[] = []
const socket = {
  readyState: 0,
  send: (data: string) => messages.push(JSON.parse(data)),
  close: () => {},
  addEventListener: events.addEventListener.bind(events),
}
const link = sync(g, {
  url: 'https://books.example',
  connect: () => socket,
  timer: (fn) => timers.push(fn),
  fetch: () => {
    throw new Error('peer writes must use the socket')
  },
})
link.open()
socket.readyState = 1
events.dispatchEvent(new Event('open'))
await g.apply([{ entity: { eid: 'b1' }, cursor: { x: 1 } }])
await g.apply([{ entity: { eid: 'b1' }, cursor: { x: 2 } }])
equal(messages, [{ relay: [{ entity: { eid: 'b1' }, cursor: { x: 1 } }] }])
timers.shift()!()
equal(messages[1], { relay: [{ entity: { eid: 'b1' }, cursor: { x: 2 } }] })
await hear(g, {
  id: 'books',
  relay: [{ entity: { eid: 'b1' }, cursor: { x: 3 } }],
})
equal((await g.get(['b1']))[0].cursor, { x: 3 })
await link.idle()
link.close()
```

## Subscribe and reconnect

`subscribe(query, id?, opts?)` returns the subscription id. `subscribe(true)`
requests committed patches. Query syntax belongs to
[@yaks/query](../query/README.md#query-model).

The injected socket below shows readiness without network access. `onReady`
reports changes and refusals, including empty first answers; it does not call
the listener immediately.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { sync } from '@yaks/sync'
import { equal } from '@yaks/testing'

const vocab = loadVocab({ $defs: {} })
const g = graph({ storage: ram(vocab), vocab })
g.install()
const events = new EventTarget()
const messages: unknown[] = []
const socket = {
  readyState: 0,
  send: (data: string) => messages.push(JSON.parse(data)),
  close: () => {
    socket.readyState = 3
  },
  addEventListener: events.addEventListener.bind(events),
}
const link = sync(g, { url: 'https://books.example', connect: () => socket })
const readiness: boolean[] = []
const remove = link.onReady((_id, ready) => readiness.push(ready))
const id = link.subscribe(true, 'all')
equal(link.ready(id), false)
socket.readyState = 1
events.dispatchEvent(new Event('open'))
equal(messages[0], { subscribe: true, id: 'all', acks: true, frames: true })
events.dispatchEvent(
  new MessageEvent('message', { data: JSON.stringify({ id, bundles: [] }) }),
)
equal(link.ready(id), true)
equal(readiness, [true])
link.refresh(id)
equal(link.ready(id), false)
link.unsubscribe(id)
remove()
link.close()
```

Frames land in order. Each packet is acknowledged after its frames finish
applying. Until the first answer arrives, local queries can return incomplete
cached data. `refusal(id)` exposes the refusal until a successful answer or an
unsubscribe clears it.

The socket reconnects with a delay doubling from `wait` (default 250 ms) to
`most` (default 30 seconds), resetting on open. `timer` supplies reconnect and
pace timers. Refused subscriptions are not reopened automatically; explicitly
subscribe on their id to retry. The first successful frame after reconnecting
replaces prior membership, adding missing entities to `gone`. Cached data alone
never makes a subscription ready on a new connection.

`wire(options)` provides this socket behavior without installing a graph plugin;
its `land` callback receives frames after membership bookkeeping. It also
exposes `relay(bundles)` for peer writes. `backoff` calculates the next
reconnect delay:

```ts
import { backoff, wire } from '@yaks/sync'
import { equal } from '@yaks/testing'

const w = wire({
  url: 'https://books.example',
  land: () => {},
  report: () => {},
})
equal(w.connected(), false)
equal(backoff(250, 30_000), 500)
equal(backoff(20_000, 30_000), 30_000)
w.close()
```

## Apply incoming frames and snapshots

`land(graph, frame, mine?)` applies incoming bundles as patches, relayed values,
and transient updates, and strips synchronized components from `gone` entities.
`strip(graph, eids)` does that removal directly. Identity and local components
remain, so leaving a result set is not deletion; only an incoming tombstone
marks deletion. A Sync preserves entities held by overlapping subscriptions.
Direct `land` callers must provide that protection themselves.

`hear(graph, frame, mine?)` applies only the frame's relayed peer values. A
reset clears missing peer values for its members, except components this node is
still writing. `Mine` is the predicate identifying those components.

`snapshot(graph, bundles, options?)` replaces server-stored components, clearing
omitted properties within the supplied
[coverage](../graph/README.md#projections). It retains local and unsaved peer
components. `preserve(eid, component, property?)` can retain omitted values
owned elsewhere; `mine` protects this node's peer writes.

`replicate(graph, bundles)` marks and applies server patches as trusted replica
writes. Register `marks` on a graph that uses these incoming helpers without a
Sync; it declares the requests they use.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { covers, delivered, land, marks, snapshot } from '@yaks/sync'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      properties: { title: { type: 'string' }, pages: { type: 'number' } },
    },
    draft: {
      component: true,
      sync: 'none',
      properties: { text: { type: 'string' } },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })
g.use(marks)
g.install()
await g.apply([{
  entity: { eid: 'b1' },
  book: { title: 'Dune', pages: 412 },
  draft: { text: 'notes' },
}])
await snapshot(g, [{ entity: { eid: 'b1' }, book: { title: 'DUNE' } }])
equal((await g.get(['b1']))[0].book, { title: 'DUNE', pages: null })
await land(g, { id: 'books', gone: ['b1'] })
equal((await g.get(['b1']))[0].book, undefined)
equal((await g.get(['b1']))[0].draft, { text: 'notes' })
const scope = delivered({ entity: { eid: 'b1' }, book: { title: 'Dune' } })
equal(scope, { book: ['title'] })
equal(covers(scope, 'book', 'title'), true)
equal(covers(scope, 'book', 'pages'), false)
```

`covers` tests coverage; `delivered` derives coverage from a bundle's supplied
components and properties. `Coverage` is re-exported from @yaks/graph.

A **Replica** is the optional policy passed to `sync()` to manage retained
entities, subscription ownership, and pending-write protection. It supplies
`subscribe`, `unsubscribe`, `land`, and `protect`. Frames with `coverage`,
`peerCoverage`, `peers`, or `peerGone` require a Replica; standalone `land`
rejects them. `peers` carries entities reached by projections, independently of
query membership; `relay` carries peer-written components.
[@yaks/client](../client/README.md) supplies the Replica policy. `SubscribeOpts`
controls local priming (`prime`) and the answer's semantic identity
(`answerKey`) for that policy.

## Workers and MessagePorts

A **PortLink** carries request replies and frames over a caller-owned `Worker`
or `MessagePort`, using structured-clone messages. `portLink()` creates one end;
`receive(method, value)` handles requests on the other end. The helper provides
no graph policy, authorization, optimistic writes, reconnection, or frame
backpressure.

```ts
import { type Frame, portLink } from '@yaks/sync'
import { equal } from '@yaks/testing'

const { port1, port2 } = new MessageChannel()
const frames: Frame[] = []
const client = portLink(port1, { frame: (frame) => frames.push(frame) })
const server = portLink(port2, { receive: (_method, value) => value })
try {
  equal(await client.request('echo', { title: 'Dune' }), { title: 'Dune' })
  server.frame({ id: 'books', bundles: [] })
  await client.request('echo', undefined, { timeout: null })
  equal(frames, [{ id: 'books', bundles: [] }])
  equal(client.stats.frames, 1)
} finally {
  client.close()
  server.close()
  port1.close()
  port2.close()
}
```

Requests default to a 30-second timeout and at most 256 outstanding requests.
`timeout` and `maxPending` configure these limits. Per-request
`{ timeout: null }` disables its deadline; disconnection still rejects it. A
timeout does not cancel work at the other end. `close()` removes listeners,
notifies the other end, and rejects pending requests without terminating or
closing the caller-owned port. `stats` counts sent and received messages and
frames.

Errors arrive as ordinary `Error` objects unless the receiver supplies
`encodeError` and the requester supplies `decodeError`. The encoded value must
support structured cloning; a decoder can restore an Error subclass and its
data.

```ts
import { portLink } from '@yaks/sync'
import { equal, throws } from '@yaks/testing'

class Conflict extends Error {
  constructor(public current: unknown) {
    super('changed since read')
  }
}
const { port1, port2 } = new MessageChannel()
const client = portLink(port1, { decodeError: (value) => new Conflict(value) })
const server = portLink(port2, {
  receive: (_method, value) => {
    throw new Conflict(value)
  },
  encodeError: (error) => (error as Conflict).current,
})
try {
  const error = await throws(() => client.request('write', { title: 'Dune' }))
  equal(error instanceof Conflict, true)
  equal((error as Conflict).current, { title: 'Dune' })
} finally {
  client.close()
  server.close()
  port1.close()
  port2.close()
}
```

## Exports

There is one root export, with no sub-module exports.

| Export       | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/sync` | `sync`, `Sync`, `SyncOpts`, `Replica`, `SubscribeOpts`; `post`, HTTP types (`Fetch`, `PostOpts`, `Refusal`, `Report`, `Trouble`); `land`, `strip`, `snapshot`, `hear`, `Mine`; `wire`, `backoff`, socket types (`Ask`, `Connect`, `Frame`, `Socket`, `Timer`, `Wire`, `WireOpts`); `syncOf`, `durableOf`, `local`, `outbound`, `stored`, `outward`, `inverse`, `guessed`; `asked`, `asking`, `before`, `clean`, `echo`, `echoed`, `marks`, `replicate`, `ruled`, `ruling`, `SENT`, `RULED`, `ECHO`; `covers`, `delivered`, `Coverage`; `portLink`, `Port`, `PortLink`, `RequestOptions` |

`post(bundles, options)` sends and reconciles one write outside the Sync's
ordered queue, resolving to whether its outcome is known. It uses the same
selection and reconciliation as `sync()`. Use `asking` to mark caller input, or
supply `PostOpts.sent` for an already selected change and `held: true` when it
has not committed locally.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { marks, post, sync } from '@yaks/sync'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { component: true, properties: { title: { type: 'string' } } },
  },
})
const g = graph({ storage: ram(vocab), vocab })
g.use(marks)
g.install()
const answer = [{ entity: { eid: 'b1' }, book: { title: 'Dune' } }]
const fetch = () => Response.json(answer)
equal(
  await post(answer, {
    graph: g,
    url: 'https://books.example',
    fetch,
    sent: answer,
    held: true,
    report: () => {},
  }),
  true,
)
equal((await g.get(['b1']))[0].book, { title: 'Dune' })
const link = sync(g, { url: 'https://books.example', fetch })
equal(await link.submit(answer), answer)
link.close()
```

## Limits

Connection, subscription, and pending-request state live in memory. Entity data
belongs to the graph's [storage](../graph/README.md#data-model). This package
provides neither persistent storage nor a durable offline-write queue. It does
not enforce local expiry timers or persist local components.

`close()` does not abort queued HTTP writes or unregister the graph plugin.
Finish pending work before discarding the graph; browser unload does not
guarantee time to await it. HTTP `headers` do not authenticate the socket; that
belongs to the supplied `connect` implementation or server session handling.

The package uses web transport APIs and `lib: ["dom", "esnext"]`, without Deno
runtime types. Inject transports when a runtime lacks compatible defaults.
[@yaks/ram](../ram/README.md) supplies in-memory storage;
[@yaks/api](../api/README.md) implements the server protocol.

## License

Apache-2.0
