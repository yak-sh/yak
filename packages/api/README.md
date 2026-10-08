# @yaks/api

Serves graph writes, queries, and live query subscriptions through an HTTP and
WebSocket request handler. Your application supplies the
[graph](../graph/README.md#data-model), authentication policy, and server
runtime.

A **handler** takes a `Request` and returns a `Response`, synchronously or
asynchronously (`Handler`). A **route** gives a handler an HTTP method and path
(`Route`): `{ method: 'GET', path: '/health', handle }`. A **filter** checks
each request before a route answers it, refusing the request by throwing
(`Filter`).

A **subscription** holds a [query](../query/README.md#query-model) and pushes
its answer to one client when a committed [batch](../graph/README.md#data-model)
affects it. A **frame** is one subscription message (`Frame`), such as
`{ id: 'books', bundles: [...] }`. A **sink** receives frames (`Sink`). The
**subscription registry** keeps subscriptions for sinks (`Subs`). It lives in
memory; keep it, or its handler, between requests.

## Install

```sh
deno add jsr:@yaks/api
# or: npx jsr add @yaks/api
```

## Use

The handler can be called directly, without binding a port:

```ts
import { api } from '@yaks/api'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string' },
        price: { type: 'number' },
      },
    },
  },
})
const g = graph({ vocab, storage: ram(vocab) })
const handle = api({ graph: g })
const bundles = [{ entity: { eid: 'b1' }, book: { title: 'Dune', price: 12 } }]
const written = await handle(
  new Request('https://shop.test/apply', {
    method: 'POST',
    body: JSON.stringify(bundles),
  }),
)
equal(written.status, 200)
equal(await written.json(), bundles)
const answer = await handle(new Request('https://shop.test/query?q=.book'))
equal(await answer.json(), bundles)
const declarations = await handle(new Request('https://shop.test/vocab'))
equal((await declarations.json()).docs, vocab.docs)
```

| Endpoint         | Request                                                           | Response                             |
| ---------------- | ----------------------------------------------------------------- | ------------------------------------ |
| `POST /apply`    | JSON array of [bundles](../graph/README.md#data-model), or NDJSON | Applied bundles                      |
| `GET /query?q=…` | URL-encoded query                                                 | Bundles or an aggregate value        |
| `POST /query`    | JSON string or `{"q":"…"}`                                        | Same as GET                          |
| `/ws`            | WebSocket upgrade                                                 | Subscription frames                  |
| `GET /vocab`     | GET                                                               | `{ docs, keywords }` for `loadVocab` |

`/apply` returns [patches](../graph/README.md#data-model) and graph-generated
changes, rather than every stored component. `?check=1` runs the write pipeline
and rolls the transaction back; effects do not run. It reserves nothing and
provides no transaction across graphs. A subsequent write can still fail.

`GET /query?live=1&q=…` uses the subscription registry's `snapshot`: stored
bundles with current relayed values. Ordinary `/query` reads stored data,
including saved relayed values. A saved value does not count as a connected
writer's presence after that writer disconnects.

## Exports

| Import             | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/api`        | `api`, `Options`, `Handler`, `Route`, `routed`, `Filter`; `Authenticate`, `signed`, `PeerWriter`; `ask`, `write`, `pour`, `poured`, `CHUNK`, `WriteContext`; `published`; `subscriptions`, `Subs`, `Ask`, `Frame`, `Sink`, `Opening`; `attach`, `decode`, `Incoming`, `queue`, `receive`, `sink`, `Socket`, `Upgrade`; `denoUpgrade`, `denoListen`, `Listen`, `Listener`, `Addr`; `json`, `refusal`, `refuse`, `fault`, `Refusal`, `Unauthorized`; `served`, `requested`, `agent`, `Report`, `Watch`, `Answered`; `timed` |
| `@yaks/api/vocab`  | `apiDoc`, `docs`, `description`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `@yaks/api/routes` | `handler`, `Hosting`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@yaks/api/tools`  | `runs`, `Serving`, `PORT`, `HOSTNAME`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Query answers

A query with `.fields` returns narrowed bundles and separate bundles for
entities reached through references. Aggregate queries return a value instead of
bundles. Both GET and POST use the same query syntax and storage support.

```ts
import { api, type Frame, subscriptions } from '@yaks/api'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string' },
        price: { type: 'number' },
      },
    },
  },
})
const g = graph({ vocab, storage: ram(vocab) })
await g.apply([{ entity: { eid: 'b1' }, book: { title: 'Dune', price: 12 } }])
const handle = api({ graph: g })
const ask = async (q: string) =>
  (await handle(
    new Request('https://shop.test/query', {
      method: 'POST',
      body: JSON.stringify({ q }),
    }),
  )).json()
equal(await ask('.book&.count'), { count: 1 })
equal(await ask('.book&.distinct=book.price'), { distinct: ['12'] })
equal(await ask('.book&.tally=book.price'), { tally: { '12': 1 } })
equal(await ask('.book&.fields=book.title'), [{
  entity: { eid: 'b1' },
  book: { title: 'Dune' },
}])
const subs = subscriptions(g)
const frames: Frame[] = []
const to = (frame: Frame) => {
  frames.push(frame)
}
await subs.open(to, 'titles', '.book&.fields=book.title')
equal(frames[0].coverage, { b1: { book: ['title'] } })
await subs.open(to, 'count', '.book&.count')
equal(frames[1], { id: 'count', count: 1 })
await subs.drop(to)
```

## Authentication and caller context

`authenticate(request)` runs on every request, including reads and WebSocket
upgrades. Its [actor](../graph/README.md#data-model) replaces client-supplied
`$actor` on every incoming bundle. Omitting it, or returning `null`, permits
unattributed requests. Throw `Unauthorized` to answer with HTTP 401.
Authentication does not decide which entities or properties a caller may access;
the graph and application supply that policy.

`write(request, bundles)` adds caller context before signing a JSON batch or
each NDJSON chunk, including checked writes. `read(request)` supplies graph
`ReadOpts` for queries, socket frames and applied write replies. Applied replies
use the graph's answer hooks with `patch: true`, so callers receive their own
vocabulary while storage keeps the graph's vocabulary.

```ts
import { api, signed, Unauthorized } from '@yaks/api'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({ $defs: {} })
const g = graph({ vocab, storage: ram(vocab) })
const handle = api({
  graph: g,
  authenticate: () => {
    throw new Unauthorized('sign in')
  },
})
const response = await handle(new Request('https://shop.test/vocab'))
equal(response.status, 401)
equal(await response.json(), { error: 'Unauthorized', message: 'sign in' })
equal(
  signed([{ entity: { eid: 'b1' }, $actor: { by: 'untrusted' } }], {
    by: 'member',
  }),
  [{ entity: { eid: 'b1' }, $actor: { by: 'member' } }],
)
```

## Streaming imports

A **chunk** is the group of up to `CHUNK` (50) input bundles that `pour` applies
in one transaction. Send `application/x-ndjson` to `/apply`: one bundle per
line, with blank lines skipped. `poured` accepts any content type containing
`ndjson`. Request and response bodies are streamed; each completed chunk emits
its applied input bundles, omitting additional entities generated by the graph.

```ts
import { api, poured } from '@yaks/api'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
    },
  },
})
const g = graph({ vocab, storage: ram(vocab) })
const handle = api({ graph: g })
const bundle = { entity: { eid: 'b1' }, book: { title: 'Dune' } }
const input = () =>
  new Request('https://shop.test/apply?check=1', {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson' },
    body: '\n' + JSON.stringify(bundle) + '\n',
  })
equal(poured(input()), true)
const checked = await handle(input())
equal((await checked.text()).trim(), JSON.stringify(bundle))
equal(await g.read('.book'), [])
const committed = await handle(
  new Request('https://shop.test/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson' },
    body: JSON.stringify(bundle),
  }),
)
equal((await committed.text()).trim(), JSON.stringify(bundle))
equal(await g.read('.book'), [bundle])
```

The status stays 200 once streaming starts. A failure is the final response
line: `{ error, message, line, committed }`. `line` is a 1-based input line
number; `committed` counts input bundles in successful preceding chunks. The
failed chunk rolls back; earlier chunks remain committed. For an apply failure,
the handler checks the chunk with one bundle omitted at a time to locate the
failure. If no single omission succeeds, it reports the chunk's first line.
Processing stops after the failure; the reported line need not be the only bad
line or the last line read.

Under `?check=1`, `committed` counts bundles that passed checks, and later
chunks cannot depend on entities earlier chunks would have created. A `$name`
[alias](../graph/README.md#ids-and-names) resolves only within its chunk; use
known eids for references across chunks.

## Outgoing bundles

`published` omits components declaring `sync: none` from HTTP responses, socket
frames and projection coverage. It preserves identities, aliases, stamps and
deletion markers without changing stored bundles.

```ts
import { published } from '@yaks/api'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    local: {
      component: true,
      type: 'object',
      sync: 'none',
      properties: {
        note: { type: 'string' },
      },
    },
  },
})
const bundle = { entity: { eid: 'b1' }, local: { note: 'this node' } }
equal(published(vocab, [bundle]), [{ entity: { eid: 'b1' } }])
equal(bundle.local.note, 'this node')
```

## Subscriptions

`subscriptions(graph)` observes the graph's `effect` phase, including direct
application writes. `open` sends the current answer and subsequent changes;
`close` closes one subscription; `drop` closes every subscription for a sink.
`subscribe: true` selects the **raw feed**, which sends each committed batch
without an initial answer. `commit` admits bundles from another process, and
`restore` opens saved subscriptions together, sharing initial reads.

```ts
import { type Frame, subscriptions } from '@yaks/api'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, until } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: {
        price: { type: 'number' },
      },
    },
  },
})
const g = graph({ vocab, storage: ram(vocab) })
const subs = subscriptions(g)
const frames: Frame[] = []
const to = (frame: Frame) => {
  frames.push(frame)
}
await subs.restore([{ sink: to, id: 'cheap', query: '.book.price<20' }])
equal(frames[0].bundles, [])
await g.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
await until(() => frames.length == 2)
equal(frames[1].bundles, [{ entity: { eid: 'b1' }, book: { price: 12 } }])
await g.apply([{ entity: { eid: 'b1' }, book: { price: 25 } }])
await until(() => frames.length == 3)
equal(frames[2].gone, ['b1'])
await subs.close(to, 'cheap')
await subs.open(to, 'all', true)
await g.apply([{ entity: { eid: 'b2' }, book: { price: 10 } }])
await until(() => frames.length == 4)
equal(frames[3].id, 'all')
await subs.drop(to)
```

Query frames contain current matching bundles and `gone` eids for deleted
entities or entities that stopped matching. A refresh may send the whole answer.
Queries that can test one entity at a time use
[@yaks/match](../match/README.md); queries with references, ordering or limits
use dependency reads or refreshes. Writes return at commit without waiting for
subscriber reads; commits arriving during a read share the next pass.

A small answer of a query tested one entity at a time is held in memory and kept
current from what each commit moves. Subscriptions asking the same query with
the same options share it, and it outlives the last of them for a while: a
client that closes a subscription and opens it again is answered without a read.

A `.fields` [projection](../graph/README.md#projections) carries `coverage` for
selected bundles. A covered property omitted from its bundle is absent; an
uncovered property was not read. Entities reached through references travel in
`peers`, with `peerCoverage` and `peerGone`, outside the selected set. Aggregate
queries send `{ id, count }`, `{ id, distinct }` or `{ id, tally }` on opening
and when their value changes. Initial query frames carry `transientReset` eids
and may carry [transient frames](../graph/README.md#transient-text).

`subscriptions(graph, { invalidate })` accepts an application dependency rule:
returning `true` from `invalidate(query, applied)` refreshes that subscription.
It does not discover dependencies outside the query automatically.

### Relayed values

A **relay** forwards `sync: peers` components to other sinks watching their
entities. It holds one value per entity and component under its last writer's
connection, merging partial patches. It never echoes a connection's own values.
A clear (`{ component: null }`), disconnect or declared duration expiry clears
that value. Raw feeds receive every relay; query subscriptions receive existing
values when they open or an entity joins their answer.

```ts
import { type Frame, subscriptions } from '@yaks/api'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    cursor: {
      component: true,
      type: 'object',
      sync: 'peers',
      durable: 'connection',
      properties: { x: { type: 'number' } },
    },
    position: {
      component: true,
      type: 'object',
      sync: 'peers',
      durable: 'forever',
      save: '.entity',
      properties: { x: { type: 'number' } },
    },
  },
})
const g = graph({ vocab, storage: ram(vocab) })
const subs = subscriptions(g)
const writer = (_frame: Frame) => {}
const seen: Frame[] = []
const reader = (frame: Frame) => {
  seen.push(frame)
}
await subs.open(reader, 'all', true)
const cursor = { entity: { eid: 'b1' }, cursor: { x: 4 } }
await subs.relay(writer, [cursor])
equal(seen[0].relay, [cursor])
equal(await g.read('.cursor'), [])
equal(await subs.snapshot('.cursor.x=4'), [cursor])
await g.apply([{ entity: { eid: 'b1' } }])
await subs.relay(writer, [{ entity: { eid: 'b1' }, position: { x: 7 } }])
equal(await g.read('.position'), [{
  entity: { eid: 'b1' },
  position: { x: 7 },
}])
await subs.drop(writer)
equal(await subs.snapshot('.cursor'), [])
await subs.drop(reader)
```

Without `save`, relayed values stay outside storage. A component's **save
query** selects the stored entities whose latest relayed value should be stored.
For example, `save: '.player (!position | .updated.at<="30s ago")'` saves only
stored players with no position yet or an update at least thirty seconds old. It
does not inspect the incoming value. A stored entity that never matches is never
saved, including an explicit clear.

The server checks on arrival and after relevant stored facts change. A relative
time condition is checked every second only while the stored entity satisfies
its other eligibility predicates. An entity lacking a required component owns no
clock retry. When a writer disconnects, its latest value remains pending until
the query matches; disconnect never bypasses the query. Every relay, with or
without `save`, passes `graph.admit` before it is held or forwarded. Admission
runs ordinary write checks as the connection's authenticated writer, including
ownership, request guards and schema constraints. Partial patches are checked
with the latest admitted peer value, and the relay forwards the checked result
after write hooks and rules. Certified plugins check temporary rows without
stored writes; other plugins use an ordinary dry run. Each save applies as the
connection's authenticated actor and vocabulary versions (`PeerWriter`). A
refused input leaves the previous accepted value intact; a refused save is sent
to its writer.

A query can select by relayed values; moving, clearing or expiring them changes
membership. Subscription `bundles` carry stored components, while `relay`
carries current relayed values. A projection through a reference cannot be read
over relayed values.

## WebSocket protocol

`attach` connects a socket to a subscription registry and drops its
subscriptions on close. `receive` dispatches one message; `decode` admits UTF-8
text of up to 64 KiB before JSON parsing. Oversized or malformed messages
produce a `refused` frame with a recoverable top-level id, or an empty id. They
do not close the socket or disturb other subscriptions.

```text
→ { subscribe: "<query>" | true, id: "<id>", acks?: true, frames?: true }
→ { ack: "<token>" }
→ { unsubscribe: "<id>" }
→ { relay: Bundle[] }
← { id, bundles, gone?, coverage?, peers?, peerCoverage?, peerGone? }
← { id, count } | { id, distinct } | { id, tally }
← { id, relay: Bundle[] } | { id, transient: TransientFrame[] }
← { id, refused: { error, message, … } }
← { frames: [{ id, … }, …], ack: "<token>" }
```

An **ack** is the token a client echoes after applying a frame. With
`acks:
true`, non-relay frames wait for their ack before more non-relay frames
are sent. `frames: true` groups adjacent non-relay frames under one ack;
acknowledge only after applying the whole group. Relay-only frames carry no ack
or replay state. On reconnect, clients reopen subscriptions and resend relayed
values.

`queue` handles socket buffering and acks; `sink` queues frames until the socket
opens. Relay frames wait up to 16 ms and merge recent patches, retaining a clear
before a later partial patch. A membership or stored-data frame flushes
preceding relays first. Admission uses the component's declared pace, caps
unpaced traffic, and closes persistent floods. Rejected inputs leave accepted
values intact.

```ts
import { decode, type Frame, queue } from '@yaks/api'
import { equal } from '@yaks/testing'

const sent: (Frame & { ack: string })[] = []
const q = queue({
  send: (text) => {
    sent.push(JSON.parse(text))
  },
})
q.enable()
q.send({ id: 'books', bundles: [] })
q.send({ id: 'books', gone: ['b1'] })
equal(sent.length, 1)
q.ack(sent[0].ack)
equal(sent.length, 2)
equal(sent[1].gone, ['b1'])
equal(decode('{"unsubscribe":"books"}'), { value: { unsubscribe: 'books' } })
q.close()
```

A socket can be wired without an HTTP upgrade when the host already owns it:

```ts
import { attach, type Frame, type Socket, subscriptions } from '@yaks/api'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal, until } from '@yaks/testing'

const vocab = loadVocab({ $defs: {} })
const g = graph({ vocab, storage: ram(vocab) })
const subs = subscriptions(g)
const events = new EventTarget()
const frames: Frame[] = []
const socket: Socket = {
  readyState: 1,
  send: (text) => {
    frames.push(JSON.parse(text))
  },
  addEventListener: events.addEventListener.bind(events),
}
attach(subs, socket)
events.dispatchEvent(
  new MessageEvent('message', {
    data: JSON.stringify({ subscribe: '.entity', id: 'all' }),
  }),
)
await until(() => frames.length == 1)
equal(frames[0].bundles, [])
events.dispatchEvent(
  new MessageEvent('message', {
    data: JSON.stringify({ unsubscribe: 'all' }),
  }),
)
events.dispatchEvent(new Event('close'))
```

Durable writes use `/apply`; socket relays only carry `sync: peers` components.
`denoUpgrade` is the default WebSocket upgrade. Other runtimes supply an
`Upgrade` returning `{ socket, response }`; Cloudflare Workers can use
`workerUpgrade` from [@yaks/workerd](../workerd/README.md).

## Refusals and request reports

A **refusal** is the JSON error body sent to a caller (`Refusal`): its error
name, message, and enumerable details except `stack`. `refusal` constructs that
body; `refuse` adds the HTTP status from
[@yaks/graph](../graph/README.md#admission-and-schema-checks). `json` constructs
a JSON response. `fault` logs errors whose status is at least 500, leaving
expected client refusals unlogged.

```ts
import { json, refusal, refuse, Unauthorized } from '@yaks/api'
import { equal } from '@yaks/testing'

const error = new Unauthorized('sign in')
equal(refusal(error), { error: 'Unauthorized', message: 'sign in' })
equal(refuse(error).status, 401)
equal(await json({ ready: true }).json(), { ready: true })
```

| Status | Error names                                               |
| ------ | --------------------------------------------------------- |
| 400    | `Refused`, `Unsupported`, `SyntaxError`, `Unknown`        |
| 401    | `Unauthorized`                                            |
| 403    | `Denied`                                                  |
| 404    | `NotFound` (also unknown routes)                          |
| 405    | Wrong endpoint method, or `/ws` without an upgrade header |
| 409    | `Stale`                                                   |
| 500    | Unmapped error names                                      |

Socket refusals are frames, and streaming import refusals are final NDJSON
lines. An HTTP answer at 500 or over carries `x-request-id` and is handed to
`report` as a bundle with the **request component**, which records method, URL
without query string, matched route, status, duration and reduced user agent.
`served` watches any handler this way. An answer already carrying `x-request-id`
is not reported again. `report` chooses where to keep the bundle; the default
reports to the console. `requested` constructs it and `agent` reduces a
`User-Agent`.

```ts
import { agent, requested, served, timed } from '@yaks/api'
import { type Bundle } from '@yaks/graph'
import { equal } from '@yaks/testing'

const request = new Request('https://shop.test/books?private=value')
const reports: Bundle[] = []
const handle = served(() => new Response('unavailable', { status: 503 }), {
  report: (bundle) => {
    reports.push(bundle)
  },
  route: () => '/books',
})
const response = await handle(request)
equal(reports[0].entity.eid, response.headers.get('x-request-id'))
equal(requested('r1', request, { status: 503, ms: 2 }).request, {
  method: 'GET',
  url: 'https://shop.test/books',
  status: 503,
  ms: 2,
})
equal(agent('curl/8.5.0'), 'curl 8.5.0')
const lines: string[] = []
const fetch = timed((line) => {
  lines.push(line)
}, () =>
  new Response('', {
    headers: { 'server-timing': 'read;dur=2' },
  }))
await fetch(request)
equal(lines, ['GET /books?private=value 200  read;dur=2'])
```

`timed` is a client fetch wrapper that prints the response's `Server-Timing`
header through a supplied callback, returning the response unchanged.

## Plugin routes and serving

`@yaks/api/routes` exports `handler(host)`, which composes plugin routes and
filters with the four endpoints. Exact paths beat prefixes; longer prefixes beat
shorter ones; plugin order breaks ties. A plugin's exact route can override an
endpoint. A catch-all route only answers paths no endpoint claims. Host commits
from `host.feed` reach the subscription registry as well as local graph commits.

```ts
import { routed } from '@yaks/api'
import { handler } from '@yaks/api/routes'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({ $defs: {} })
const g = graph({ vocab, storage: ram(vocab) })
const route = {
  method: 'GET',
  path: '/health',
  handle: () => new Response('ready'),
}
equal(routed(route, 'GET', '/health'), true)
const checked: string[] = []
const handle = handler({
  graph: g,
  who: () => null,
  routes: [route],
  filters: [(request) => {
    checked.push(new URL(request.url).pathname)
  }],
})
equal(
  await (await handle(new Request('https://shop.test/health'))).text(),
  'ready',
)
equal(checked, ['/health'])
```

`@yaks/api/vocab` declares the request component and the `serve` tool.
`@yaks/api/tools` implements `serve`: it binds a TCP port, starts the host's
[duties](../cli/README.md#duties-the-work-nobody-is-asking-for), and returns
when the server stops. Port and hostname come from tool arguments, then
configuration, then `PORT` (8787) and `HOSTNAME` (`127.0.0.1`). It reports the
bound address on stderr while the call remains running. Stopping, it takes no
new connection, closes its sockets and lets the requests in flight finish for
`grace` seconds (`GRACE`, 10), then returns whether or not they did, so a
request that never ends cannot hold the process. `share` lets a second server
started the same way listen on the port at once (SO_REUSEPORT; Deno needs
`--unstable-net`, which this repository's deno.json turns on), and `ready` names
a file it writes its pid to once listening: a replacement answers before the
server it replaces stops, the way `yak restart` hands the box's web over
([@yaks/cli](../cli/README.md)). Without `share` a taken port is refused. See
[@yaks/tools](../tools/README.md) for tool execution and
[@yaks/cli](../cli/README.md) for host configuration.

A host configured with this package exposes the tool through `yak`:

```json
{
  "db": "graph.db",
  "plugins": ["@yaks/api"],
  "port": 8787
}
```

```sh
yak serve --config yak.json
# In another terminal, check the served vocabulary:
curl --fail http://127.0.0.1:8787/vocab
```

The following binds a local port, so it is excluded from documentation tests:

```ts ignore
import { api, denoListen } from '@yaks/api'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({ $defs: {} })
const g = graph({ vocab, storage: ram(vocab) })
let port = 0
const server = denoListen({
  port: 0,
  hostname: '127.0.0.1',
  onListen: (addr) => {
    port = addr.port
  },
}, api({ graph: g }))
try {
  equal((await fetch(`http://127.0.0.1:${port}/vocab`)).status, 200)
} finally {
  await server.shutdown()
  await server.finished
}
```

## Limits

This package creates no database. [Storage](../graph/README.md#data-model)
adapters persist graph data; [@yaks/query](../query/README.md) defines query
syntax and the adapter decides which queries it supports. Authorization belongs
to the application and graph plugins. Feature packages own their routes, such as
[@yaks/mcp](../mcp/README.md)'s `/mcp`.

The handler uses standard web interfaces. `denoListen` and `denoUpgrade` look up
Deno at call time and throw outside Deno. Other runtimes provide their own
WebSocket upgrade, and runtimes that bind their own ports do not use `serve`.

## License

Apache-2.0
