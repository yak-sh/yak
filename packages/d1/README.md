# @yaks/d1

A [@yaks/graph](https://jsr.io/@yaks/graph) **storage adapter** backed by
Cloudflare **D1**.

## Install

```sh
deno add jsr:@yaks/d1
# or: npx jsr add @yaks/d1
```

## What it is

D1 is a serverless SQLite reachable only over an async API, so this adapter is
**async end to end**: every read and every write returns a promise. It composes
the yaks query → vocabulary → SQL stack over a D1 binding to satisfy the
`Storage` seam:

- **read** — a query in, matching entities out as whole bundles;
- **write** — a change patched into rows, with the death cascade a delete
  implies.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/d1'

// A bookstore: an entity is whatever components it wears. A book is a `doc`
// plus a `book`; a review is a `doc` plus a `review` pointing at the book.
let shelf = loadVocab({
  $defs: {
    doc: {
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    book: {
      type: 'object',
      kind: true,
      properties: {
        pages: { type: 'number' },
        price: { type: 'number' },
        status: { enum: ['draft', 'listed', 'sold'] },
      },
    },
    review: {
      type: 'object',
      kind: true,
      properties: {
        stars: { type: 'number' },
        book: { type: 'string', ref: 'book', death: 'cascade' },
      },
    },
  },
})

export default {
  async fetch(_req: Request, env: { DB: D1Database }) {
    let store = storage(env.DB, shelf)
    await store.install() // create-if-not-exists; safe on every request

    let g = graph({ storage: store, vocab: shelf })

    await g.apply([
      { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { price: 12 } },
      { entity: { eid: 'r1' }, review: { stars: 5, book: 'b1' } },
    ])

    let cheap = await g.read('.kind=book&.price<20&.order=-price')
    return Response.json(cheap)
  },
}
```

## Async, with sync pass-through

`Storage` is async-**or**-sync, and @yaks/graph threads either: its `then`
awaits a promise and passes a plain value straight through. So the **same**
`apply()` — the same phases, the same plugins, the same death cascade — is
synchronous over [@yaks/sqlite](https://jsr.io/@yaks/sqlite) and asynchronous
here, and nothing in between has to know which.

That is not a claim, it is a test: `parity_test.ts` runs the conformance script
that ships beside the reference adapter through a graph over D1 and a graph over
in-process SQLite, and asserts they never disagree — same bundles returned, same
batches refused, same entities read back — while asserting that this side did in
fact go async.

## The transaction

**Read this before you rely on it.** D1's shape is not the shape an embedded
database has, and this adapter does not pretend otherwise.

### What D1 gives

`batch()` runs a list of statements sequentially inside one implicit
transaction, and rolls the whole list back if any statement fails. That is a
true atomic write.

What D1 does **not** give is an _interactive_ transaction: there is no call that
opens a transaction, lets your code read, decide, and write inside it, and
commits at the end. Nothing holds a lock while your code thinks.

### What `tx()` does about it

A transaction here is **deferred-write**:

|        |                                                      |
| ------ | ---------------------------------------------------- |
| reads  | run immediately, against the committed database      |
| writes | gathered as statements, not sent                     |
| return | flushes the gathered statements as **one** `batch()` |
| throw  | discards them — nothing was ever sent                |

Every statement is written to be self-sufficient so that it can wait: an owner
id is a subquery (`select id from entity where eid = ?`) rather than a value
looked up first, so a batch that mints an entity and then points at it resolves
inside the batch, in order, with no round trip. Those statements are
[@yaks/sqlite](https://jsr.io/@yaks/sqlite)'s — one write path, run one at a
time over an embedded engine and gathered into a batch here — so a patch cannot
mean one thing in one store and something else in another.

**Read-your-own-writes** is answered from an overlay, not from the database.
`apply()` needs it — the death cascade asks who points at a dying entity _after_
the batch's own patches have gone in — so every entity the transaction has
written is kept in memory as it will be once the batch lands, and a read inside
the transaction is the committed answer with those entities replaced by their
pending state, re-judged with [@yaks/match](https://jsr.io/@yaks/match) (the
same query grammar the database answers). A transaction that has not written
anything yet never routes a query through the overlay, and reads exactly as the
database does.

### What is not promised

- **The write is atomic. The transaction is not serializable.** The reads are
  not enrolled in the write batch, because D1 has nowhere to put them. Between a
  read and the flush another writer may move what was read. This is
  read-committed with an atomic write batch.
- **`$was` is exact against your own concurrency, best-effort against a
  simultaneous writer.** The precondition guard reads the current value and
  refuses the batch if it moved — which catches every stale write it can see —
  but the window between that read and the flush is not locked, so a writer who
  commits inside that window is not detected. Over @yaks/sqlite the same guard
  is exact. If a lost update is unacceptable for a given column, D1 is the wrong
  store for it.
- **Concurrent minting collides loudly.** `entity.num` is minted from a
  high-water mark read once per transaction and carries a unique index, so two
  writers minting at the same instant fail the batch rather than half-apply it.
  Retry.
- **A nested `tx()` is a separate batch.** D1 has no savepoints. Nothing in
  `apply()` nests one.

The failure D1 cannot prevent is a lost update nobody noticed. The failure it
_does_ prevent — a half-written batch — is prevented completely.

### Ordering, in one corner

A read inside a transaction returns the committed matches in the database's
order, then the transaction's own pending matches after them. A `.order=` over a
set the batch itself changed is therefore ordered within each part rather than
across both. Nothing in `apply()` orders a read; this matters only if your own
hook does.

## Where it sits

One of three interchangeable adapters behind the same `Storage` seam:

- **@yaks/d1** — Cloudflare D1, async (this package);
- **[@yaks/durable-object](https://jsr.io/@yaks/durable-object)** — a Durable
  Object's embedded, synchronous SQLite;
- **[@yaks/sqlite](https://jsr.io/@yaks/sqlite)** — in-process SQLite, and the
  reference every adapter is held to.

The schema is @yaks/sqlite's: D1 _is_ SQLite, so the DDL a vocabulary implies is
derived in one place and this package runs it. The per-component gather is
shared the same way, so a column the filter resolves one way cannot come back
gathered another — and so is the write path, statement for statement. What this
package owns is the round-trip shape — a whole bundle, however many components,
is gathered in one `batch()` rather than one statement at a time — and the
transaction above.

## Types

Shipped source names only the Workers runtime API and standard web APIs; the D1
surface is declared structurally (`D1Like`, `Stmt`) so nothing here depends on
Cloudflare at runtime. `conform.ts` checks those declarations against
`@cloudflare/workers-types` itself, under its own `deno check` (the runtime's
types are globals, so one file wears them and the rest of the repo does not).

A prepared statement is a **type parameter** rather than a narrowed slice,
because it is both what `prepare` returns and what `batch` takes — a slice would
have to be a supertype and a subtype of `D1PreparedStatement` at once. The
adapter treats a statement as opaque: it binds values, runs it, or hands it
back.

## Compatibility

Runs anywhere a D1 binding does — **Cloudflare Workers** — and, because the
binding is structural, on **Deno** and **Node** against any object with the same
`prepare`/`batch` shape. The package imports no runtime-specific API.

## Values

D1's own type table, applied at the edge: `null`, numbers, strings and booleans
bind as they are (a boolean stores as 0/1); a `bigint` becomes a number, which
D1 requires; a `Uint8Array` becomes the `ArrayBuffer` it is a window onto. On
the way back, a BLOB — which D1 hands over as an array of byte values — becomes
bytes again, so a caller never learns which database answered.
