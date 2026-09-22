# @yaks/durable-object

SQLite storage and hibernatable WebSocket support for
[@yaks/graph](../graph/README.md) in a Cloudflare Durable Object. The
application supplies the vocabulary, plugins, and request authorization.

Graph data persists in the object's embedded SQLite database. A **bundle** is
one entity's components represented as a JSON object; a **batch** is a list of
changes applied in one transaction. Socket subscriptions are saved in WebSocket
attachments so they can be restored after the object hibernates.

For graph write phases and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/durable-object jsr:@yaks/graph jsr:@yaks/vocab jsr:@yaks/api
```

## Storage and sockets

`storage(ctx.storage, vocab, base?)` adapts the object's SQLite API to an
[@yaks/sqlite](../sqlite/README.md) `Driver`. That package creates the schema,
reads components, and applies row changes. `ctx.storage.transactionSync`
provides the transaction. Storage operations are synchronous; graph plugins can
make an operation asynchronous, but code executing inside `transactionSync` must
remain synchronous.

`sockets(subs, ctx)` connects hibernatable WebSockets to
[@yaks/api](../api/README.md) subscriptions. The API registry re-evaluates saved
queries after committed changes; this adapter accepts sockets, dispatches
frames, and restores subscriptions after hibernation.

## The whole object

This example stores books with title, body, price, status, and an author
reference. `State` describes the subset of `DurableObjectState` used here, so
the example does not need Cloudflare's global types. The package also contains a
similar [example.ts](./example.ts).

```ts
import { api, type Handler, subscriptions } from '@yaks/api'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import {
  type DurableStorage,
  type Hibernation,
  type Sockets,
  sockets,
  storage,
  type Wire,
} from '@yaks/durable-object'

type State = Hibernation & { storage: DurableStorage }

let vocab = loadVocab({
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    book: {
      component: true,
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

  constructor(ctx: State) {
    let store = storage(ctx.storage, vocab, { number: true })
    store.install() // initialize tables and indexes
    let shop = graph({ storage: store, vocab })
    let subs = subscriptions(shop) // shared by HTTP and WebSocket handlers
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

Declare the class in your Worker's `wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "SHOP"
class_name = "Bookshop"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Bookshop"]
```

A Worker must forward requests to an object instance, for example using its
`SHOP.getByName('main').fetch(request)` binding. The class implements HTTP apply
and query routes and handles `/ws` itself:

```sh
curl -X POST https://shop.example/apply -H 'content-type: application/json' -d '[
  { "entity": { "eid": "b1" },
    "doc": { "title": "The Left Hand of Spring" },
    "book": { "price": 12, "status": "shelved" } }
]'

curl --get https://shop.example/query --data-urlencode 'q=.status=shelved&.price<20'
```

```ts
// After opening a WebSocket to /ws:
socket.send(JSON.stringify({ subscribe: '.status=shelved', id: 'shelf' }))
// Response: { id: 'shelf', bundles: [{ entity: { eid: 'b1', num: 1 }, ... }] }
```

The example stores body text directly. A column declared `store: 'blob'`
requires the corresponding blob storage and graph plugin setup; this adapter
does not provide that automatically. Schema installation is repeatable, but
application schema migrations still require coordination.

## Hibernation, and why `wake()`

A socket accepted with `ctx.acceptWebSocket` can remain connected while the
runtime discards the object instance. Reconstructing the instance loses its
in-memory subscription registry. The adapter saves each socket's subscriptions
in its attachment and restores them when needed.

Call `wake()` before handling HTTP requests so a write that wakes the object
also reaches existing subscribers. Restoring a subscription sends its current
results. Forward `webSocketMessage` and `webSocketClose` to `message` and
`close`; the adapter restores inherited sockets when processing frames as well.
Ordinary event-listener attachment through `@yaks/api` does not handle this
hibernation lifecycle.

Attachments have a 2 KB runtime limit. The adapter checks serialized attachment
size and refuses subscriptions it cannot save with a `RangeError` response.
Subscriptions use the `subs` field, preserving other application fields. It also
remembers up to 16 temporary relay keys in `relay` when they fit, allowing stale
peer state to be cleared after hibernation. The relay values themselves do not
persist.

## What the runtime is strict about

The driver converts booleans to 0/1, bigints to numbers, and `Uint8Array` values
to `ArrayBuffer` slices. BLOB results become `Uint8Array` again. Bigint
conversion can lose precision outside JavaScript's safe-integer range.

The runtime rejects transaction SQL such as `BEGIN` and `SAVEPOINT`; the adapter
uses nested `transactionSync` calls through `Driver.tx`. It enables foreign-key
enforcement when creating the driver.

Cloudflare-owned tables may appear in the SQLite catalog but reject application
reads. `prohibited(name)` recognizes `_cf_` names regardless of case or leading
underscore count. `reserved(name)` also recognizes SQLite's `sqlite_` tables,
for code enumerating application-owned tables.

## API

The package has one import path, `@yaks/durable-object`:

| Export                                                  | Purpose                                            |
| ------------------------------------------------------- | -------------------------------------------------- |
| `storage(ctx.storage, vocab, base?)`                    | Creates an `@yaks/sqlite` `Store`                  |
| `driver(ctx.storage)`                                   | Creates the underlying synchronous SQLite `Driver` |
| `sockets(subs, ctx)`                                    | Returns `accept`, `message`, `close`, and `wake`   |
| `prohibited`, `reserved`                                | Identify internal runtime tables                   |
| `DurableStorage`, `DurableSql`, `SqlCursor`, `SqlValue` | Structural storage types                           |
| `Hibernation`, `Wire`, `Sockets`, `Store`               | Structural socket and store types                  |

The store exposes `ddl`, `grown`, `install`, `read`, `rows`, and `tx`. Base
options include derived expressions, SQL extensions, a fixed `now`, schema text
expressions, numbering, and identity adoption. See the
[SQLite API](../sqlite/README.md#api) for details.

For a regular Worker without Durable Object hibernation, use `@yaks/workerd`'s
`workerUpgrade` with the `@yaks/api` WebSocket route. Subscriptions in that
arrangement last only as long as the Worker isolate.

## Composition

This adapter shares the graph `Storage` interface with in-process `@yaks/sqlite`
and asynchronous `@yaks/d1`. The SQLite schema and write planners are shared;
the transaction implementation differs. Conformance tests compare this package
with the embedded SQLite adapter using the same sequence of graph operations.

## Compatibility

The adapter targets Cloudflare Durable Objects with SQLite storage and
hibernatable sockets. Its published code imports no Deno or Node globals and
uses structural types instead of importing Cloudflare runtime code. `conform.ts`
checks compatibility with `@cloudflare/workers-types` separately to keep Workers
globals out of unrelated type-checks:

```sh
deno check --config packages/durable-object/workers.json packages/durable-object/conform.ts
```

## Related packages

- [@yaks/query](../query/README.md): query parsing.
- [@yaks/vocab](../vocab/README.md): component and reference schema.
- [@yaks/graph](../graph/README.md): bundles, validation, plugins, and
  `apply()`.
- [@yaks/sqlite](../sqlite/README.md): schema, SQL reads, and writes.
- [@yaks/api](../api/README.md): HTTP routes and subscriptions.

## License

Apache-2.0
