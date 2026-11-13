# @yaks/durable-object

SQLite storage and hibernatable WebSocket support for
[@yaks/graph](../graph/README.md) in a Cloudflare Durable Object. The
application supplies the vocabulary, plugins, and request authorization.

Graph data persists in the object's embedded SQLite database. A **bundle** is
one entity's components represented as a JSON object; a **batch** is a list of
bundles applied in one transaction. Socket subscriptions are saved in WebSocket
attachments so they can be restored after the object hibernates.

For graph write phases and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/durable-object jsr:@yaks/graph jsr:@yaks/vocab jsr:@yaks/api
```

## Storage and sockets

`storage(ctx.storage, vocab, base?)` adapts the object's SQLite API to an
[@yaks/sql](../sql/README.md) `Driver`, and [@yaks/sqlite](../sqlite/README.md)
over that driver creates the schema, reads components, and applies row changes.
`ctx.storage.transactionSync` provides the transaction. Storage operations are
synchronous; graph plugins can make an operation asynchronous, but code
executing inside `transactionSync` must remain synchronous.

Pass an optional observer to `driver(ctx.storage, observe)` or as the fourth
argument to `storage(ctx.storage, vocab, base, observe)` to receive each drained
cursor's `rowsRead` and `rowsWritten` with a value-free SQL shape.
`profile(emit)` collects these samples in memory. `flush()` emits its first
nonempty summary immediately and subsequent summaries at most once per minute.

Cloudflare bills every row a statement reads or writes and offers no cap on it,
so every driver counts its statements against its object's **ceiling**
(`./ceiling.ts`): the rows the object may read and write in a minute and in an
hour (`WINDOWS`). Two failures are reported as they happen:

- `Scan`: one statement read `SCAN` (100,000) rows or more and `FAR` (100) times
  what its answer represents or it wrote. A direct `COUNT(*)` answer represents
  its counted inputs, including each group's count in a tally, and an `ANALYZE`
  represents every row it reads to count. It is reported once an hour for each
  statement shape, with the shape; the ratio alone does not establish which
  indexes the engine used.
- `Runaway`: the object's statements together passed a window's rows. It is
  reported once for that window, with the costliest shapes.

A host names where the reports go once, before its first driver:
`bounded(ctx.storage, { report, refuse })`. Every driver over that storage
counts against the same ceiling. With `refuse`, a statement past a window is
refused as `Stopped` (status 429, `retry.after` in milliseconds, `retry.defer`)
until the window ends: past its written rows the object still reads, and past
its read rows it takes nothing. A host asks `stopped(writing)` (the wait in
milliseconds, 0 when a statement is admitted) or `refusal(writing)` at its
doors, so a stopped object answers there rather than failing deep inside.
Statements a stopped object must still take, such as keeping a person's write
for later or an effect pool's word on how a run ended, run inside the ceiling's
`free(body)`, which holds across the awaits of an asynchronous body until it
settles and not for the timers it leaves; work that must not stop half way runs
on `freely(ctx.storage)`, a driver that counts and never refuses. What runs free
counts against windows of its own: it is told past them and stops nothing, so a
relocation's new object takes writes once it serves. Work that can wait asks
`under(share, written?, lane?)` how long until the object has spent under that
share of every window. Run as a lane's work (`lane(name, body)`, across awaits
like `free`), the share is of that lane's own rows, so two kinds of background
work each keep an allowance the other's backlog cannot spend; their rows still
count toward the object's windows and its stop. Lane tallies are the instance's:
a new instance starts them at nothing, its totals where they stood. An object
whose stopping costs more than its rows is `spare()`d: told, never refused.

The tallies outlive the instance, so an object evicted or restarted mid-window
goes on where it stood. `bounded` keeps them in one row of the object's
`ctx.storage.kv` as a window's rows pass half of what it may and as they pass
it, once the turn that passed it is over (a transaction its `Stopped` unwound
still read and wrote its rows), and a new instance reads that row at its first
statement. That costs no row a statement: at most two rows written a window for
reads and two for writes, none for an object spending under half. `ceiling`
takes the same as `kept()` and `keep(spent)`.

A `Stopped` that crosses a stub reaches its caller as a new error with the name,
message and own properties it was thrown with, never its class
([RPC error handling](https://developers.cloudflare.com/workers/runtime-apis/rpc/error-handling/),
enhanced error serialization, on from compatibility date 2026-04-21), so a
caller asks `stopped(error)`, which knows it by its name and its `retry.after`.
`crossed(error)` in `./testing.ts` hands an error over the same way.

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
        status: { type: 'string', enum: ['shelved', 'sold'] },
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

curl --get https://shop.example/query --data-urlencode 'q=.book.status=shelved&.book.price<20'
```

```ts ignore
// After opening a WebSocket to /ws:
socket.send(JSON.stringify({ subscribe: '.book.status=shelved', id: 'shelf' }))
// Response: { id: 'shelf', bundles: [{ entity: { eid: 'b1', num: 1 }, ... }] }
```

The example stores body text directly. A property declared `store: 'blob'`
requires the corresponding blob storage and graph plugin setup; this adapter
does not provide that automatically. Schema installation is repeatable, but
application schema migrations still require coordination.

## One class, one alarm

`Durable` is the object as a class, for every kind of object a Worker serves.
What differs between kinds is its spec, which a subclass hands to `super`, or
answers from `specify()` where the spec names the subclass's own members:

- `open()` composes what the object holds, once an instance: its door (`serve`),
  the subscriptions its sockets serve (`subs`), and the works its alarm runs
  (`works`). An open that fails is tried again by the next entry.
- `report(error, entry)` takes every failure the object catches.
- `ceiling` is the row ceiling's options, refusing by default; `version` is the
  deploy the object runs.

Every entry opens first and wakes the sockets the object inherited. A door's
statement past the ceiling is answered `Stopped`, with how long to wait. A
socket is the door's to accept, through `accept(request)`, after whatever the
door checks. The first entry on a new `version` arms the alarm, which takes up
what the object owes: a deploy restarts it idle.

`clock(ctx.storage, works, options?)` is the alarm loop the class runs. Each
ring gives every work one slice (`SLICE`, ten seconds), and each answers when it
is next owed; the alarm is set for the soonest. While a slice runs the alarm
stands at `BACKSTOP`, so an instance cut off mid-slice is rung again. A work
that fails is reported and tried again `RETRY` (a minute) on; one the ceiling
stopped waits for its window. A write that owes work calls `clock.arm(at)`,
which keeps an alarm already set sooner.

```ts
import { Durable, type State } from '@yaks/durable-object'

class Counter extends Durable {
  constructor(ctx: State) {
    super(ctx, {
      open: async () => ({
        serve: () => new Response('ok'),
        works: { sweep: async (until) => null },
      }),
      report: (error, entry) => console.error(entry, error),
    })
  }
}
```

## Hibernation, and why `wake()`

A socket accepted with `ctx.acceptWebSocket` can remain connected while the
runtime discards the object instance. Reconstructing the instance loses its
in-memory subscription registry. The adapter saves each socket's subscriptions
in its attachment and restores them when needed.

Call `wake()` before handling HTTP requests so a write that wakes the object
also reaches existing subscribers. Restoring a subscription sends its current
results. Forward `webSocketMessage` and `webSocketClose` to `message` and
`close`, returning the latter's promise so final saves finish before the handler
ends; the adapter restores inherited sockets when processing frames as well.
Ordinary event-listener attachment through `@yaks/api` does not handle this
hibernation lifecycle.

Attachments have a 2 KB runtime limit. Small subscription maps use the `subs`
field, preserving other application fields. When queries exceed that limit, the
adapter keeps them in the object's SQLite and holds their key in `subref`. The
socket still holds its serial ACK and up to 16 temporary relay keys, so ACKs and
relays do not write the subscription row. Closing the socket removes the row.
The relay values themselves remain in memory. Components declaring `save` also
keep a durable snapshot through the graph's `apply()`. Pass the handshake's
authenticated writer and vocabulary versions as `accept`'s third argument; the
attachment retains them across hibernation. Unsaved values keep a timer until
their save is due; a quiet saved value leaves no timer. Legacy sockets reconnect
before their first saved relay to obtain the writer's vouch.

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

## Resets

The runtime moves an object to a new instance when it likes (a deploy, a runtime
update, another machine, a failure inside its own storage, a lost connection to
it), and the instance it moved fails its work in flight; whoever owns that work
runs it again. `moved(error)` recognizes those words, "Network connection lost."
among them: a caller meets it when its call is cut off, and an instance whose
own storage lost its connection refuses every statement in it.
`replaced(ctx.storage)` says whether this instance is the one that was moved: a
reset instance still answers a read but refuses every write, so it asks through
a transaction. `vacating(run, ctx.storage)` is `run`'s answer, or those words as
soon as `replaced` turns true while `run` still waits, asked every `LOOK` ms: a
request its instance was reset under can wait on what never settles, and its
caller sends it again to the live instance. `evicted(error)` is a reset a caller
should send again for, and `killed(error)` a kill for the CPU or memory limit,
which no code of the object sees. `opaque(error)` is the runtime's own internal
error, which names only a reference: the work is tried again, and reported if it
keeps failing. `retried(send, replayable, retry, wait)` sends a call again while
it fails in words `retry` knows (`evicted` by default), pausing before each
resend as `backoff` says; `wait` waits a pause out, `jittered(clock)` by default
(half of it or more, on the runtime's clock unless given one), and a test hands
its own.

```ts
import { assertEquals } from '@std/assert'
import { moved, replaced } from '@yaks/durable-object'

let error = new Error('Durable Object reset because its code was updated.')
let reset = {
  sql: { exec: () => [] },
  transactionSync: () => {
    throw error
  },
}
// This instance was reset: the next one runs the work again, so no report.
assertEquals(moved(error) && replaced(reset), true)
```

## The door to an object

A caller reaches an object only by fetch, through a stub its namespace hands out
by name. `stubOf(ns, name, hint?)` is that stub, created where the location hint
says (`'enam'`, say): the runtime reads a hint only at an object's first get and
never moves an object. A stub is bound to the request that took it, so take one
per call; getting one costs nothing.

`doorOf(send, scrub?)` is a `Door`: a path, an init and the call's headers in,
the object's answer out (`consume(path, read, …)` reads it). It builds every
request from scratch, drops the init's headers named in `scrub` before setting
the call's own, and hands the request to `send`, which has the last word on its
headers. An init that is a `Request` carries its method, body and headers
across, which is how a socket upgrade reaches the object.

`resending(door, { report?, wait? })` sends a call again, as `retried` paces it,
when the runtime reset the object or lost the call: thrown, or answered as a
500's refusal body (`reset(response)`, `thrown(response)`). A call is sent again
only while that is safe: its request can be built again (no streamed body, and
not `replayable: false`), and every send carries one `IDEMPOTENCY` key, which a
caller may name, so an object that applied it before its answer was lost answers
the next send as it answered the first (@yaks/api receipts). An answer is read
whole inside the retry, so a restart that cuts off its body is sent again too; a
stream is handed on as it comes. A read that fails in the runtime's opaque words
is sent again, a write is not, and a kill for the object's limits or a refusal
for memory goes to `report` before anything else sees it.

```ts
import { assertEquals } from '@std/assert'
import { doorOf, resending, stubOf } from '@yaks/durable-object/door'

let sends = 0
let ns = {
  idFromName: (name: string) => name,
  get: () => ({
    fetch: () =>
      Promise.resolve(
        ++sends == 1
          ? Response.json({ message: 'Network connection lost.' }, {
            status: 500,
          })
          : new Response('ok'),
      ),
  }),
}
let door = resending(
  doorOf((req) => stubOf(ns, 'ada', 'enam').fetch(req), ['x-who']),
  { wait: () => Promise.resolve() },
)
assertEquals(await (await door('/query')).text(), 'ok')
assertEquals(sends, 2)
```

What a call says beyond that is the caller's: yaks.app's kernel names the
headers only it may set as `scrub`, and its `send` stamps its deploy and the app
on every request (workers/yak/door.ts).

## API

`@yaks/durable-object` exports everything below. A reader of the object's
storage that holds no socket imports `@yaks/durable-object/sql` (`driver`),
`/store` (`storage`), `/resets` (the reset helpers), `/door` (the door to an
object), `/ceiling` or `/alarm` alone, without `sockets` and the `@yaks/api`
dispatch it brings:

| Export                                                  | Purpose                                             |
| ------------------------------------------------------- | --------------------------------------------------- |
| `storage(ctx.storage, vocab, base?)`                    | Creates an `@yaks/sqlite` `Store`                   |
| `driver(ctx.storage, observe?)`                         | Creates the underlying synchronous SQLite `Driver`  |
| `freely(ctx.storage, observe?)`                         | A `driver` the ceiling counts and never refuses     |
| `profile(emit)`                                         | Aggregates cursor costs into bounded summaries      |
| `bounded(ctx.storage, options?)`, `ceiling(options?)`   | Report a scan or a runaway, and stop the object     |
| `stopped(error)`                                        | Whether a failure is a stop, here or across a stub  |
| `Durable`, `Spec`, `Opened`, `State`                    | The object class and what makes one kind of object  |
| `clock(ctx.storage, works, options?)`, `Work`           | The one alarm loop, in slices                       |
| `sockets(subs, ctx)`                                    | Returns `accept`, `message`, `close`, and `wake`    |
| `stubOf(ns, name, hint?)`, `Namespace`, `Stub`          | An object's stub by name, placed by a hint          |
| `doorOf(send, scrub?)`, `Door`, `Send`, `Call`          | A request built from scratch for every call         |
| `resending(door, { report?, wait? })`, `IDEMPOTENCY`    | A door that sends a call again across a reset       |
| `reset(response)`, `thrown(response)`                   | A reset an object answered, read or thrown          |
| `prohibited`, `reserved`                                | Identify internal runtime tables                    |
| `moved`, `replaced`, `evicted`, `killed`, `opaque`      | Tell a reset of this instance from a failure        |
| `vacating(run, ctx.storage, clock?, every?)`, `LOOK`    | Fail a request whose instance was replaced          |
| `retried`, `backoff`, `jittered`                        | Send a call again when the object was reset or lost |
| `DurableStorage`, `DurableSql`, `SqlCursor`, `SqlValue` | Structural storage types                            |
| `Hibernation`, `Wire`, `Sockets`, `Store`               | Structural socket and store types                   |

The store exposes `ddl`, `grown`, `install`, `read`, `rows`, `get`, and `tx`.
Base options include derived expressions, SQL extensions, a fixed `now`, schema
text expressions, numbering, and identity adoption. See the
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
checks compatibility with `@cloudflare/workers-types` in the Workers program of
`deno task check:types`, apart from Deno's, to keep Workers globals out of
unrelated type-checks:

```sh
deno task check:types packages/durable-object/conform.ts
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

When a trace context is subscribed, the SQL driver emits one `sql` span per
statement. Its code name comes from the SQL AST, never rendered values. The
span's `rowsRead` and `rowsWritten` counts are the runtime cursor's billed
counts, not the number of returned rows; `statements` includes failed calls.
These measurements are charged inclusively to enclosing spans through
[@yaks/trace](../trace/README.md). Recording adds no SQL reads or writes.
