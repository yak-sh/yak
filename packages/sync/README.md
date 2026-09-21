# @yaks/sync

Keeps a local [@yaks/graph](../graph/README.md) in step with a server. It is a
graph plugin: it forwards local writes to the server as `POST /apply`, and it
opens a WebSocket to `/ws` where it holds subscriptions and applies what the
server pushes back.

Each component declares whether the server ever sees it and how long its value
lives, so a component the server owns and a component that never leaves the
browser can be written in the same call. This package does not store the
components that never leave; it only reports which ones those are.

For the structure of a bundle, the phases of a write, and what a storage adapter
is responsible for, see the [graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/sync
# or: npx jsr add @yaks/sync
```

## Use

The examples use a shared recipe box: recipes with a course and a serving count,
notes about them, cooks who wrote them.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { sync } from '@yaks/sync'

let vocab = loadVocab(recipeBox)
let g = graph({ storage: ram(vocab, { adopt: true }), vocab })
let link = sync(g, { url: 'https://recipes.example' })

link.subscribe('.course=dinner&.serves>4')
```

That is the whole setup. From then on:

```ts
g.apply([{
  entity: { eid: crypto.randomUUID() },
  doc: { title: 'Dal' },
  recipe: { serves: 4, course: 'dinner' },
}])
// → the bundles, immediately. No await: the page renders now, and the POST to
//   the server happens in the background.
```

`ram(vocab, { adopt: true })` matters: a client store has to accept the identity
the server assigns rather than assign its own, so the `num` a recipe has here is
the `num` it has everywhere.

## Writes are optimistic

An `apply()` call takes a list of bundles and commits all of them or none of
them; this README calls that list a batch. A batch commits **locally first** —
that is what makes a render instant — and is then sent to the server as
`POST /apply`. Three things can come back.

**Applied.** The server responds with the batch as IT applied it: the numbers it
assigned, the stamped columns it wrote, a tombstone for every entity its cascade
deleted. That response is applied back through the local graph, so the client
ends up holding exactly what a fresh read would return. It is marked on the way
in, so the plugin that sent the write does not immediately send the response
back out again.

**Refused.** The optimistic change is undone. Before the patches went in, the
plugin recorded each entity the batch was about to change, as it then stood; the
inverse of that batch restores every column it touched, clears the columns that
had no value, and drops the components it introduced. The refusal is then
reported, along with the batch that caused it.

```ts
let link = sync(g, {
  url: 'https://recipes.example',
  report: (t) => {
    // t.reverted tells you whether the local change was undone
    if (t.refused) toast(t.refused.message)
  },
})
```

**Unreachable.** Nothing is undone. A request that never got a response may
still have been applied on the server, and a client that guesses wrong about
that turns a network blip into data loss. The failure is reported with
`reverted: false`, and the write stands locally until a later response
reconciles it.

One exception, and it comes from the graph model rather than from this package:
**a delete is not optimistic.** Deletion is final in a yaks graph — an eid is
tombstoned and can never be reused — so a refused delete could never be patched
back. A batch that deletes anything is therefore held out of the local graph and
sent as it stands; the server's response arrives carrying its own tombstones,
and a refusal is reported with `reverted: false` because nothing was applied
locally. The cost is one round trip before the delete renders.

## Three kinds of state, one apply()

A client holds three kinds of state at once: what the server owns, what this
browser owns, and what dies with the tab. Each component declares which kind it
is, using the two core [@yaks/vocab](https://jsr.io/@yaks/vocab) keywords:

```json
{
  "$defs": {
    "recipe": {
      "type": "object",
      "properties": { "serves": { "type": "number" } }
    },
    "draft": {
      "type": "object",
      "sync": "none",
      "properties": { "text": { "type": "string" } }
    }
  }
}
```

| `sync`     | who is told about a write                               |
| ---------- | ------------------------------------------------------- |
| `"server"` | the server, which owns it and fans it out — **default** |
| `"peers"`  | the server, which relays it without storing it          |
| `"none"`   | nobody: it stays on the node that wrote it              |

| `durable`      | how long the value lives                                     |
| -------------- | ------------------------------------------------------------ |
| `"forever"`    | storage — the server's, or this client's vault — **default** |
| `"connection"` | memory, for as long as the writing connection lives          |
| `"5s"`, `"2m"` | the same, plus a timer restarted on each write               |

Both are core vocabulary keywords, so nothing has to be registered:
`syncOf(vocab, 'draft')` and `durableOf(vocab, 'draft')` read them back, and for
a component that never leaves this node, `local(vocab, 'draft')` returns
`'vault'` or `'memory'` — where its value would have to be kept, since no server
will send it back. All three kinds go through the same `apply()`: a batch that
writes a recipe and its unsaved draft in one call commits once, and only the
recipe is sent to the server.

What is sent is narrower than what was written, in three ways. Each of them is
the same idea — the server has no use for the local graph's conclusions about
itself:

- only components whose `sync` is not `none`;
- only the columns a client is allowed to write (a `created` stamp is the
  server's to write);
- only the bundles a **caller** passed to `apply()` — the entities a local
  cascade deleted and the provenance a local stamping phase wrote are
  conclusions the server will reach again from the same patch.

## Reading is a subscription

`subscribe(query)` sends `{"subscribe": "<query>", "id": "s1"}` over the
WebSocket at `/ws`. The server's answer, and every later change to the set it
selects, arrives as a frame on that socket and is applied to the local graph —
so a render reads the local store and never awaits.

```ts
let id = link.subscribe('.course=dinner')
g.read('.course=dinner') // → bundles, synchronously, from the local map
link.unsubscribe(id)
```

`subscribe(true)` asks for the raw feed instead: every committed batch, exactly
as `POST /apply` returned it.

An entity that **leaves** the set arrives in a frame's `gone` list. The frame
does not distinguish a deletion from an entity that merely stopped matching, so
this package removes that entity's server-owned components rather than
tombstoning it: an entity with no components matches no query — which is what
leaving the set means — and it can come back whole when it matches again, where
a tombstone could never be lifted. A deletion still tombstones, because a
deletion arrives as a `tombstone` component inside the frame's bundles.

`ready(id)` reports whether a subscription has applied an answer on the current
connection, and `onReady(fn)` calls `fn` when that changes — rows left over from
an earlier connection do not count as ready. `refresh(id)` re-sends one
subscription (or all of them) to get a fresh full answer.

## Reconnecting

A socket dies for reasons that have nothing to do with the client: a laptop lid,
a deploy, a proxy timeout. So:

- there is **one** reconnect timer per graph, with a delay that doubles from 250
  ms to a 30 s ceiling and resets the moment a socket opens — a second timer is
  how a server that is merely slow acquires a client that hammers it;
- every subscription is sent again on the new socket;
- the first frame of each is treated as a **reset**. The server tracks
  membership per connection, so a fresh subscription answers with the set as it
  stands and reports nothing about what left while the client was away. This
  package therefore tracks each subscription's members itself, and reports
  whatever it was holding and did not hear about again as gone.

## Both transports are injected

```ts
sync(g, {
  url: 'https://recipes.example',
  fetch: (request) => myHandler(request), // default: the global fetch
  connect: (url) => new MySocket(url), //    default: the global WebSocket
  timer: (fn, ms) => setTimeout(fn, ms), //   default: setTimeout
  headers: { authorization: `Bearer ${token}` },
})
```

`fetch` takes a `Request` and returns a `Response`, which is exactly what an
[@yaks/api](https://jsr.io/@yaks/api) handler is — so this package's own tests
run a client graph and a server graph in one process, with no network and no
sleeps.

## API

```ts
sync(graph, opts): Sync
```

registers the plugin on `graph` and returns:

- `plugin` — the `Plugin` it registered, for a caller that wants to inspect it.
- `subscribe(query, id?, opts?): string` — open a subscription; returns its id.
- `unsubscribe(id): void` — close one.
- `refresh(id?): void` — re-send one subscription, or all of them, to get a
  fresh full answer.
- `ready(id): boolean` — whether that subscription has applied an answer on the
  current connection.
- `onReady(fn): () => void` — register a callback for readiness changes,
  including an empty first answer; the returned function removes it.
- `open(): void` — open the socket without subscribing to anything.
- `connected(): boolean` — whether the socket is open right now.
- `idle(): Promise<void>` — resolves when every batch in flight has been
  answered. Await it before unloading a page, and in tests.
- `close(): void` — close the socket and stop reconnecting.

Pass a `replica` in the options to supply your own working-set policy —
retention, ownership of which entities a subscription holds, and protection for
entities with a write in flight. Frames that carry partial-row coverage or
payload riders require one.

The pieces are also exported on their own, so an application that is assembled
differently can use them without calling `sync()`: `outward` (what a committed
batch sends to the server) and `inverse` (how to undo it), `post` (send one
batch and reconcile the response), `land` and `strip` (what an incoming frame
does to a graph), `wire` (the socket and the subscriptions held open across it),
and the marks `echo` and `asking` that keep the two directions apart.

## Compatibility

**Browser, Deno, Node, Bun, and Cloudflare Workers.** The package imports no
platform-specific API: `fetch` and `WebSocket` are read out of the injected
options (the globals are only a default), and it type-checks under
`lib: ["dom", "esnext"]` with no `Deno` types in the compilation at all. Its
dependencies are the sibling packages: `@yaks/graph` for bundles, `apply()` and
the plugin interface, and `@yaks/vocab` for the `sync` and `durable` keywords.

## Related packages

[@yaks/graph](https://jsr.io/@yaks/graph) owns bundles and `apply()`;
[@yaks/ram](https://jsr.io/@yaks/ram) is the map a client keeps them in;
[@yaks/api](https://jsr.io/@yaks/api) implements the server side of the
subscriptions this package opens; [@yaks/query](https://jsr.io/@yaks/query) is
the grammar a subscription is written in. This package connects the two ends.

## License

Apache-2.0

## Workers and MessagePorts

`portLink(port, options)` carries the same requests and subscription frames over
a `Worker` or a `MessagePort` instead — no HTTP, no JSON serialization, no
sockets. Both ends use the same function. It supports request/reply calls and
the `Frame` type described above. A receiver applies subscription frames with
`land(graph, frame)`; on the server side those frames can come from @yaks/api's
`subscriptions` registry.

```ts
const client = portLink(worker, {
  frame: (frame) => {
    void land(localGraph, frame)
  },
})
await client.request('subscribe', ['books', '.book'])
```

The receiving end supplies an explicit `receive(method, value)` handler. Only
expose the operations you intend the other end to call. This helper does not
authorize queries, and it does not implement optimistic writes, reconnection, or
subscription membership; those stay the responsibility of whoever assembles the
two ends. In particular, `land` removes the components of `gone` entities, so
overlapping subscriptions must not evict data another subscription still needs.

Requests have a 30-second default timeout and a limit of 256 outstanding
requests, both configurable through `timeout` and `maxPending`. A timeout
rejects the caller; it **does not cancel an operation that may already have
run**. Do not blindly retry writes. `close()` removes the message listeners and
rejects pending requests, but does not terminate or close the port, which
belongs to the caller. `stats` counts messages sent, messages received, and
subscription frames. Frame streams have no credit-based backpressure yet.

### Request deadlines

`portLink` requests use the link's configured timeout (30 seconds by default). A
caller can override it per request:

```ts
await link.request('close', undefined, { timeout: null })
```

`null` disables the deadline for that request only. Closing the link, the other
end disconnecting, and worker errors all still reject it. This is for graceful
drains whose duration is not known in advance, and it leaves deadlines in place
on ordinary requests. A caller can still keep a separate explicit force-close
action.
