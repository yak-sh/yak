# @yaks/durable-object

A yaks graph inside a Cloudflare **Durable Object**: its embedded SQLite is the
storage, and its hibernatable WebSockets are the live-sync fan-out.

One object is a single, strongly-consistent home for one graph — a shop, a
project, a customer's whole app — with no database to run and nothing to connect
to.

## Install

```sh
deno add jsr:@yaks/durable-object
# or: npx jsr add @yaks/durable-object
```

## Two halves

**Storage.** `storage(ctx.storage, vocab)` is
[@yaks/graph](https://jsr.io/@yaks/graph)'s `Storage`, and it is one line of
composition: the object's SQLite becomes a
[@yaks/sqlite](https://jsr.io/@yaks/sqlite) `Driver`, and that package owns the
schema, the compiled reads, the patches and the death cascade. No SQL is written
twice, and a graph reads the same in an object as it does on a server.

Because `ctx.storage.sql` is synchronous, so is everything above it: `apply()`
returns bundles, not a promise.

**Sockets.** `sockets(subs, ctx)` carries frames between the object's WebSockets
and [@yaks/api](https://jsr.io/@yaks/api)'s subscriptions. What a subscription
MEANS — a saved query whose answer is pushed again when a committed batch
changes it — lives in @yaks/api; only the wire is here.

## The whole object

A bookshop: books with a price and a status, and whoever wrote them. This is
`example.ts` in the package, compiled on every build; `DurableObjectState` is
the type your Worker already has from `@cloudflare/workers-types`.

```ts
import { api, type Handler, subscriptions } from '@yaks/api'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { type Sockets, sockets, storage, type Wire } from '@yaks/durable-object'

let vocab = loadVocab({
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string', store: 'blob' },
      },
    },
    book: {
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        price: { type: 'number' },
        status: { enum: ['shelved', 'sold'] },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
  },
})

export class Bookshop {
  #live: Sockets
  #route: Handler

  constructor(ctx: DurableObjectState) {
    let store = storage(ctx.storage, vocab)
    store.install() // create-if-not-exists: every wake-up is safe
    let shop = graph({ storage: store, vocab })
    let subs = subscriptions(shop) // one registry, shared
    this.#live = sockets(subs, ctx)
    this.#route = api({ graph: shop, subs })
  }

  fetch(request: Request): Response | Promise<Response> {
    this.#live.wake()
    return new URL(request.url).pathname == '/ws'
      ? this.#live.accept(request)
      : this.#route(request)
  }

  webSocketMessage(ws: Wire, data: string | ArrayBuffer): void {
    this.#live.message(ws, data)
  }

  webSocketClose(ws: Wire): void {
    this.#live.close(ws)
  }
}
```

Bind the class in `wrangler.toml` and route to it:

```toml
[[durable_objects.bindings]]
name = "SHOP"
class_name = "Bookshop"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Bookshop"]
```

Then the object answers the three routes [@yaks/api](https://jsr.io/@yaks/api)
defines:

```sh
curl -X POST https://shop.example/apply -d '[
  { "entity": { "eid": "b1" },
    "doc":  { "title": "The Left Hand of Spring" },
    "book": { "price": 12, "status": "shelved" } }
]'

curl 'https://shop.example/query?q=.status=shelved%26.price<20'
```

```ts
socket.send(JSON.stringify({ subscribe: '.status=shelved', id: 'shelf' }))
// ← { id: 'shelf', bundles: [ { entity: { eid: 'b1', num: 1 }, … } ] }
```

## Hibernation, and why `wake()`

A socket accepted with `ctx.acceptWebSocket` **outlives the object**. The
runtime evicts the object between two frames and rebuilds it on the next one, so
an idle client costs nothing — but every subscription held in memory is gone
while that client still believes it is watching.

So what a socket asked for is written on the socket itself, in its attachment,
which is the one thing that survives. A woken object rebuilds its registry from
there:

- `wake()` re-opens the subscriptions of every socket the object inherited. Call
  it at the top of `fetch`, so a batch applied by the request that woke the
  object still reaches the sockets.
- Re-opening answers each subscription with its current set — a resync, not a
  silence. A client that missed batches while the object slept is told where
  things stand.
- The runtime caps an attachment at 2KB. A subscription that would push it over
  is refused with a `RangeError` frame rather than dying quietly at the next
  hibernation. Your own attachment fields are left alone; the asks live under
  one key.

`message` and `close` are the object's `webSocketMessage` and `webSocketClose`
handlers — hibernated sockets deliver no events, which is why @yaks/api's
`attach()` (which listens) is not the door here.

## What the runtime is strict about

Both of these are handled for you; they are here because they explain the shape
of the code.

- **Values are narrow.** A binding must be an `ArrayBuffer`, a string, a number
  or null. A boolean would bind as the text `'true'` and a bigint throws, so the
  driver converts both, and a blob comes back as bytes like every other adapter.
- **Transactions are not SQL.** `begin` and `savepoint` are refused as
  statements; `ctx.storage.transactionSync` is the transaction, and it nests.
  That is what @yaks/sqlite's `Driver.tx` seam exists for.

Foreign keys are turned on when the store is bound — the enforcement the
schema's references are written for, which the runtime leaves off per
connection.

## API

```ts
storage(ctx.storage, vocab, base?) // → Store: @yaks/graph's Storage, synchronous
driver(ctx.storage) //               → the @yaks/sqlite Driver underneath it
sockets(subs, ctx) //                → { accept, message, close, wake }
```

`Store` is [@yaks/sqlite](https://jsr.io/@yaks/sqlite)'s: `ddl()`, `install()`,
`read()`, `rows()`, `tx()`. `base` options — a derived-column registry, a fixed
`now` for time phrases — ride every read.

The other socket door is a plain Worker's: a `WebSocketPair` accepted in the
isolate, for [@yaks/api](https://jsr.io/@yaks/api)'s own `/ws` route. That one
is [@yaks/workers](https://jsr.io/@yaks/workers)' `workerUpgrade`, and it holds
its subscriptions only as long as the isolate lives — inside a Durable Object,
`sockets` hands them to the runtime instead.

## Where it sits

One of three interchangeable storage adapters, all implementing the same
`Storage` seam:

- **@yaks/durable-object** — a Durable Object's embedded SQLite (this package);
- **[@yaks/sqlite](https://jsr.io/@yaks/sqlite)** — an in-process SQLite, and
  the reference every other adapter is tested against;
- **@yaks/d1** — Cloudflare D1, async.

A graph is portable across them: this package runs the same batch-for-batch
conformance script @yaks/sqlite defines, and must agree with it on every step.

## Compatibility

**Cloudflare Workers.** The published code uses only the Workers runtime API and
standard web APIs — no Node or Deno globals — but it is for a Durable Object,
which is Cloudflare's.

The runtime shapes it needs (`DurableStorage`, `DurableSql`, `Hibernation`,
`Wire`) are declared structurally, so nothing here imports Cloudflare code and
your own `DurableObjectState` satisfies them as it stands. That claim is not
taken on trust: `workers_check.ts` asserts it against
`@cloudflare/workers-types` itself, on its own (`deno task check:workers`),
because those types arrive as globals that would redefine `Response` and
`WebSocket` for every file sharing a type-check with them.

## The family

A query string is parsed by [@yaks/query](https://jsr.io/@yaks/query); a
vocabulary is described with [@yaks/vocab](https://jsr.io/@yaks/vocab);
[@yaks/graph](https://jsr.io/@yaks/graph) owns the bundle wire and `apply()`;
[@yaks/sqlite](https://jsr.io/@yaks/sqlite) owns the SQL this package runs; and
[@yaks/api](https://jsr.io/@yaks/api) is the door in front of all of it.

## License

Apache-2.0
