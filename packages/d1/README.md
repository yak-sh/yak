# @yaks/d1

A Cloudflare D1 storage adapter for [@yaks/graph](../graph/README.md). It stores
graph data in the D1 database supplied by the application, using the schema and
write statements from [@yaks/sqlite](../sqlite/README.md). Reads and
transactions are asynchronous.

A **bundle** is one entity's components represented as a JSON object. A
**batch** is a list of changes applied in one transaction. D1's `batch()` API
executes the SQL statements implementing those changes atomically. Application
reads made before that call are outside the database transaction; see
[The transaction](#the-transaction).

For graph write phases and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/d1 jsr:@yaks/graph jsr:@yaks/vocab
```

## What it is

`storage(binding, vocab, base?)` implements the graph `Storage` interface over a
D1 binding. It compiles queries, reads matching entities as bundles, and applies
patches. The graph handles validation, plugins, and deletion policy.

This Worker example assumes an existing D1 binding named `DB`. Its type is
expressed using the package's structural interface; a Cloudflare `D1Database`
satisfies that interface.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { type D1Like, type Stmt, storage } from '@yaks/d1'

let vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    book: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        price: { type: 'number' },
        status: { type: 'string', enum: ['draft', 'listed', 'sold'] },
      },
    },
    review: {
      component: true,
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
  async fetch<S extends Stmt<S>>(_req: Request, env: { DB: D1Like<S> }) {
    let store = storage(env.DB, vocab)
    await store.install()
    let g = graph({ storage: store, vocab })
    await g.apply([
      { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { price: 12 } },
      { entity: { eid: 'r1' }, review: { stars: 5, book: 'b1' } },
    ])
    return Response.json(await g.read('.kind=book&.price<20&.order=-price'))
  },
}
```

The example initializes the schema and writes sample data on every request for
simplicity. Applications should initialize schema deliberately and map requests
to their own authorized operations. `install()` runs vocabulary-derived DDL; it
does not implement the embedded adapter's full schema-upgrade procedure.

## API and exports

The package has one import path, `@yaks/d1`. `storage` returns a `Store` with:

| Method               | Result                                                    |
| -------------------- | --------------------------------------------------------- |
| `ddl()`              | SQL schema statements, synchronously                      |
| `install()`          | Promise resolving after schema statements execute         |
| `read(query, opts?)` | Promise of matching bundles                               |
| `rows(query, opts?)` | Promise of raw rows, including aggregates and projections |
| `get(eids)`          | Promise of those entities as stored, tombstones included  |
| `tx(body)`           | Promise of the callback result after its writes commit    |

Read options are `@yaks/sql`'s bind options, such as `derived`, `extend`, and
`now`; per-call options override `base`. Human numbering is opt-in through
`base.number: true`, or `{ except: ['entry'] }` for component exclusions.

The root also exports `D1Like`, `Stmt`, `D1Stmt`, `D1Result`, value/row types,
`bind`/`unbind`, query/gather helpers, shared SQL write builders, graph
`Storage`/`Tx` types, and the secrets vault below. See [mod.ts](./mod.ts) for
the complete list.

## Secrets

`d1Vault(db, key)` keeps a graph's secrets in D1, in two tables it creates on
first use: `yak_vault` holds each secret, and the salt its sentinels are hashed
under, encrypted with AES-GCM under `key`; `yak_vault_lock` holds the leases
that make a read, a change and its write back one step across isolates. It meets
[@yaks/secrets](../secrets)' vault by shape without importing it:

```ts
import { d1Vault } from '@yaks/d1'

// let vault = d1Vault(env.DB, key) // a CryptoKey for AES-GCM
// graph({ storage, vocab, plugins: [secrets(vault)] }) // @yaks/secrets
```

The database, its Time Travel history and its exports hold only ciphertext; the
key is the caller's to keep. A lease stands for 30 seconds if its holder dies
holding it, and a caller waits as long for one before it gives up.

## Async, with sync pass-through

The graph accepts storage methods returning either values or promises. Over D1,
`read()` and `tx()` always return promises, so await graph operations. With
synchronous SQLite storage, graph operations can return immediately unless a
plugin makes them asynchronous.

`parity_test.ts` runs the shared storage conformance cases over D1 and embedded
SQLite, checking returned bundles, rejected changes, and asynchronous behavior.
These shared cases do not remove the D1 transaction limitations below.

## The transaction

### What D1 gives

D1's `batch()` executes statements sequentially in one implicit transaction and
rolls them all back if a statement fails. It does not provide an interactive
transaction in which application code reads, decides, and writes while retaining
a database lock.

### What `tx()` does about it

| Operation          | Behavior                                                                   |
| ------------------ | -------------------------------------------------------------------------- |
| Read               | Executes immediately against committed data, with pending changes overlaid |
| Write              | Collects SQL statements without sending them                               |
| Callback completes | Sends collected statements in one D1 `batch()`                             |
| Callback fails     | Discards unsent statements                                                 |

The callback may be asynchronous. Write statements resolve ids inside SQL, such
as `select id from entity where eid = ?`, so references created in the same
write resolve when the statements execute. Both this package and `@yaks/sqlite`
use the same statement builders.

An in-memory overlay supplies read-your-own-writes: the adapter keeps the
pending state of changed entities, replaces their committed results, and
evaluates those entities with [@yaks/match](../match/README.md). This lets
cascading deletion see reference changes made earlier in the same operation.
Before any pending writes, reads use the database result directly. Overlay
queries have the capabilities and limits of the in-memory matcher, including its
available reference data and extensions; they are not a second execution of SQL
against pending rows.

### What is not promised

- **Serializable reads and writes:** reads are outside the final write
  transaction. Another writer may commit between a read and the flush.
- **Complete concurrent `$was` protection:** the graph checks preconditions
  against the values it can read, but a writer committing afterward and before
  the flush can escape detection. Use storage with an interactive transaction
  when these guards must prevent lost updates.
- **Immediate numbers:** when numbering is enabled, a new identity's `num` is
  assigned by the insert inside the write transaction. `patch` initially returns
  the identity without its number; the adapter fills it from `RETURNING` before
  `tx()` resolves.
- **Nested rollback:** a nested `tx()` creates an independent write transaction;
  D1 has no savepoints. The graph's normal `apply()` does not nest transactions.

The write statements are atomic even though the preceding reads are not isolated
from concurrent writes.

### Ordering within a transaction

Overlay reads return unchanged committed matches in database order, followed by
matching pending entities in the matcher's order. Ordering and limits are
therefore applied separately to these parts, not to the combined result. Hooks
requiring a globally ordered or paginated view of pending changes cannot rely on
this overlay behavior.

## Composition

`@yaks/d1`, `@yaks/sqlite`, and
[@yaks/durable-object](../durable-object/README.md) implement the same graph
storage interface, with different transaction guarantees. D1 uses the SQLite
layout: an identity table, component tables with integer references, tombstones,
declared indexes, and schema metadata. It does not open or provision the D1
database.

The adapter shares per-component read and write planning with SQLite. It sends
component gathers together in one D1 call instead of making a separate remote
call for each component. An ordinary query first selects matching ids and then
fetches their components; that is more than one call, and the selection and
gather are not one read snapshot.

## Types

`D1Like<S>` describes `prepare` and `batch`. `Stmt<S>` describes statement
`bind` and `all` methods. The statement is generic because it is both returned
by `prepare` and accepted by `batch`; this preserves compatibility with the
binding's own statement type.

`conform.ts` checks these interfaces against `@cloudflare/workers-types` in an
isolated type-check, keeping Workers globals out of other packages:

```sh
deno check --config packages/d1/workers.json packages/d1/conform.ts
```

## Compatibility

Designed for a Cloudflare Worker with a D1 binding. The package imports no
Cloudflare runtime code and can also run under Deno or Node with an object
implementing the same binding interface, as the test harness does.

## Values

`bind` passes strings, numbers, and booleans through, maps null/undefined to
null, converts bigints to numbers, and copies the selected range of a
`Uint8Array` into an `ArrayBuffer`. Converting a bigint to a number can lose
precision outside JavaScript's safe-integer range. `unbind` converts
array-valued BLOB results into `Uint8Array` values.
