# @yaks/sqlite

SQLite storage for [@yaks/graph](../graph/README.md). It creates tables from a
component vocabulary, compiles queries, reads entities, and applies
transactional patches. A **bundle** is one entity's components represented as a
JSON object. A **batch** is a list of changes applied in one transaction.

The application supplies a SQLite connection and initializes the schema. The
package stores graph data and database metadata in that connection's database.
For the graph's write phases and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## The model

An entity has a public string id and a set of components. Each component is a
record stored in its own table. For example, a blog post can combine `doc`
(title and body) with `post` (publication status and author).

Identity is nested in the bundle's `entity` component:

```json
{
  "entity": { "eid": "cake-01" },
  "doc": { "title": "Lemon cake" },
  "recipe": { "serves": 8 }
}
```

Reads return bundles. Writes accept patches in the same shape: omitted values
are unchanged, a null property is cleared, and a null component removes its row.

## Usage

```sh
deno add jsr:@yaks/sqlite jsr:@yaks/graph jsr:@yaks/vocab
```

This Deno example opens an in-memory database. Use a file path for persistence.
The `@yaks/sqlite/db` module selects the system SQLite library before importing
the embedded driver and provides a prepared-statement cache.

```ts
import { Database, driver } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    post: {
      component: true,
      type: 'object',
      kind: true,
      before: ['doc'],
      properties: {
        published: { type: 'boolean' },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
  },
})
let db = new Database(':memory:')
let sql = driver(db)
let store = storage(sql, vocab, { number: true })
store.install()
let g = graph({ storage: store, vocab })

await g.apply([
  { entity: { eid: 'kate' }, doc: { title: 'Kate' } },
  {
    entity: { eid: 'p1' },
    doc: { title: 'Hello world', body: 'first post' },
    post: { published: true, author: 'kate' },
  },
])
console.log(await g.read('.published=1'))
db.close()
```

### Write

Applications normally write through `graph.apply()`, which checks admission and
preconditions, runs plugins, and plans cascading deletion. The storage adapter
implements the resulting row changes and transaction. Low-level callers can use
`store.tx(tx => tx.patch(changes))`, but that bypasses graph validation and
plugins.

```ts
// With g from the example, before closing db:
await g.apply([
  { entity: { eid: 'p1' }, post: { published: false } }, // keep author
])
await g.apply([{ entity: { eid: 'p1' }, post: null }]) // remove component
await g.apply([{ entity: { eid: 'p1' }, $delete: true }]) // delete entity
```

A deleted entity keeps its identity row and gains a tombstone; its id cannot be
reused. Reference properties declare deletion behavior: `cascade` deletes their
owner, `release` removes their component, `detach` clears the reference, and
`keep` retains it as history. `tx.remove()` removes exactly the entities passed
to it; the graph determines the full cascade.

### Read

```ts
// With store from the example, before closing db:
store.read('.published=1')
store.read('.kind=post&.limit=10')
store.read('.post.author.doc.title~=kate')
store.rows('.published=1&.count') // aggregate rows with value and n fields
```

`read` accepts a query string or `@yaks/query` AST and returns whole bundles,
resolving stored integer references back to public ids. Use `rows` for aggregate
and field-projection results. See [@yaks/query](../query/README.md) for
operators, lists, ranges, time phrases, kind filters, ordering, pagination, and
aggregates.

## API

`storage(driver, vocab, base?)` returns a synchronous `Store`:

| Method               | Result                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| `ddl()`              | Schema statements derived from the vocabulary                           |
| `grown()`            | Statements adding columns missing from existing tables                  |
| `install()`          | Creates/updates schema, indexes, metadata, and archetype classification |
| `read(query, opts?)` | Matching bundles                                                        |
| `rows(query, opts?)` | Raw result rows                                                         |
| `tx(body)`           | Runs the callback in a transaction and returns its result               |

`install()` preserves existing data, adds missing columns, rebuilds tables when
required by supported schema changes, and recreates declared indexes. It does
not replace an application's migration plan. It initializes the store epoch and
number sequence and runs bounded `PRAGMA optimize` for file-backed drivers, so
the planner can use table statistics.

A transaction provides `read`, `get(eids)`, `pick(eids, names)`, `patch`,
`remove`, `doom`, and `bindings`. `get` retrieves whole entities including
tombstones; `pick` retrieves identity and selected components, potentially a
superset. `patch` returns newly created identities, with `num` when numbering is
enabled. `doom` resolves cascading deletion, and `bindings` evaluates rules
against pending changes.

SQL transactions commit on callback completion and roll back on failure; a
promise-returning callback is awaited. Nested calls use savepoints. A driver
with `file: true` starts the outer transaction with `BEGIN IMMEDIATE`, acquiring
the write lock before reads. A driver supplying its own `tx` controls
transaction behavior; Durable Object callbacks must remain synchronous.

`base` includes `@yaks/sql` bind options (`derived`, `extend`, `now`, and a
custom dialect), merged with per-read options. `text` supplies expressions for
the `doc_value` view. `number` controls human numbering, and `adopt: true`
accepts numbers supplied in patches when mirroring another store.

### The driver

The root package does not open connections. Its synchronous driver interface is:

```ts
import type { Param, Row } from '@yaks/sqlite'

type Driver = {
  query: (sql: string, params: Param[]) => Row[]
  exec: (sql: string) => void
  run?: (sql: string, params: Param[]) => number
  tx?: <R>(body: () => R) => R
  file?: boolean
  arms?: number
}
```

`run` optionally executes writes without materializing rows. `tx` is for engines
such as a Durable Object that provide a transaction API instead of accepting
transaction SQL; it must support nesting. `arms` sets the compound-query group
size, defaulting to `@yaks/sql`'s conservative `ARMS`; the embedded driver uses
`STOCK`. Query values use bound parameters.

`@yaks/sqlite/db` exports `Database`, the other `@db/sqlite` exports, `driver`,
and `sqlitePath`. It honors `DENO_SQLITE_PATH`, otherwise selecting the
platform's system library. This module uses Deno environment/FFI APIs. The root
adapter can instead receive another runtime's synchronous SQLite driver.

### Exports

| Import path          | Purpose                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `@yaks/sqlite`       | Storage, driver types, schema/read/write helpers, overlays, archetype helpers, metadata, and migrations |
| `@yaks/sqlite/db`    | Embedded Deno database and cached driver                                                                |
| `@yaks/sqlite/vocab` | `sqliteDoc` and `docs`, declaring storage and archetype diagnostic tools                                |
| `@yaks/sqlite/tools` | `runs({ sql }, options?)`, implementing those checks on the application's connection                    |

The vocabulary export declares tools, not graph components. The checks inspect
foreign-key enforcement/violations, SQLite integrity, and archetype consistency;
`sample` limits reported archetype examples. See [mod.ts](./mod.ts) for the root
export list.

## The storage layout

- `entity`: integer `id`, public `eid`, optional `num`, and archetype pointer.
- `tombstone`: deletion records excluded from normal queries.
- One table per stored component, keyed by integer `entity`. References store
  integer target ids; ordinary references have foreign keys, while `keep`
  references can preserve historical ids. A component without properties is
  represented by the existence of its row.
- Indexes from vocabulary `unique`/`index` declarations. SQLite enforces unique
  constraints, including competing inserts.
- `doc_value`: a read view when the vocabulary declares `doc`.
- `server_meta`: database metadata, separate from graph entities.
- `entity_sequence` and triggers: the human-number high-water mark.

Required properties become NOT NULL, enums become CHECK constraints, and
declared defaults fill omitted values. A `{ "now": true }` default uses the
current time for new writes. Added columns preserve literal defaults and CHECK
constraints; time defaults do not backdate existing rows. Declared partial
unique indexes apply only where their `present` properties have values.

Full-text indexing is optional: install the schema from `@yaks/fts` and pass its
search extension in `base.extend`. SQLite storage does not create FTS indexes
itself.

<a id="the-batch-as-a-world-the-overlay"></a>

### Querying pending changes with an overlay

`overlay(driver, vocab, batch, covers)` represents pending changes in a SQL
statement, allowing rules to query the state that would result from a write. It
returns a `with` prefix, parameters, a dialect resolver `at`, and removed-row
information `gone`.

Each affected component gets a common table expression (CTE) combining untouched
committed rows with merged pending rows. Component removals and deleted entities
are excluded. New entities receive temporary negative integer ids so references
within the pending changes can join correctly. The CTE exists only for its SQL
statement; it creates no database object.

The `gone` data lets rules distinguish a component removed by this write from
one that never existed. `rules.ts` implements the `-comp` deletion clause
through an SQL extension. Against committed data without an overlay, that clause
is false.

The CTE implementation avoids temporary tables, which Durable Object SQLite
rejects and which could redirect unqualified writes while present. It reads the
committed table directly and materializes only affected data. Pass the component
names the rules inspect; untouched components need no overlay. Dialect hooks
including `table`, `source`, and `refEqAt` keep references and correlated
subqueries on the same pending state. This package does not provide a browser
cache implementation.

### The store's own key/value

`server_meta` stores text values such as synchronization epochs, progress
markers, and application migration markers. These rows have no entity identity
and do not appear in bundles or graph queries.

```ts
import { EPOCH, epoch, meta } from '@yaks/sqlite'

// sql is the driver from the usage example; keep db open for these calls.
let m = meta(sql)
m.set('sweep', '2026-01-01')
m.get('sweep') // string | undefined
m.del('sweep')
epoch(sql) // creates the epoch if absent, otherwise returns it
m.get(EPOCH) // read-only lookup; may return undefined
```

`install()` initializes the epoch. A missing epoch means an existing client
cursor cannot be validated against this store. `META` exports the table name
`server_meta`, which avoids conflict with a component named `meta`. Installation
can reuse an existing table with the expected shape.

Whole-entity reads bind identity sets through `json_each(?)`, requiring SQLite
JSON support. The selected ids are fixed before components are gathered, so a
concurrent writer cannot change window membership partway through the read.

### Archetype reads

Load `archetypeDoc` and install the `archetypes()` graph plugin from
`@yaks/archetype` to maintain each entity's component-set pointer. Storage
installation classifies existing rows. Presence and kind queries lazily load a
catalog; value-only queries do not. Applications using `catalog(driver)` to
compile their own queries must compile and execute within one read transaction,
as this package's read path does.

Whole-entity reads group entities by the component tables their archetype
identifies and query only owners with each component. `get` and `pick` use this
information even for single entities. Readers ignore tables outside their
vocabulary without changing the descriptor. Only table sets are cached, allowing
rollback, other writers, and schema changes to remain visible.

A raw SQL writer must call `reclassify(driver, eids)` inside its transaction
after changing component rows. It returns changed pointers and new descriptors
as bundles that the application can broadcast; descriptor entities and unknown
ids are ignored. Stores without archetypes and unclassified low-level writes
fall back to inspecting component presence. An incomplete catalog declines the
query optimization instead of hiding entities. The fixture benchmarks compare
the classified and fallback read paths.

### Selective human numbering

Numbering is opt-in: use `{ number: true }`, or
`{ number: { except: ['entry'] } }` to exclude entities with certain components.
Omitting `number` or setting it to false leaves new entities unnumbered.
Exclusions inspect all patches in the admitted write, including a reference
whose target appears later, and override other components on the same entity.
`@yaks/ram` accepts the same policy.

Adding an excluded component clears an existing number. Removing it does not
allocate a replacement. Applications enabling exclusions on existing data must
clear historical numbers themselves; `@yaks/harness` does this for `entry` when
opening its database. A bare reference created in an earlier transaction may
already have consumed a number before its eventual components were known.

The transactional `entity_sequence` high-water mark is initialized from existing
numbers and advanced by insert/update triggers. Clearing a number does not
recycle it, including after reopening the database. `adopt: true` instead
accepts an incoming identity's `num` or explicit null when replicating another
graph.

## Preannounced migrations

`migrations(driver)` provides a small cooperative control table independent of
application tables. A migrator commits an announcement, waits outside a write
transaction, then commits its synchronous migration and completion record
atomically:

```ts
import { migrations, watchMigrations } from '@yaks/sqlite'

const control = migrations(driver)
control.ready() // call before installing application tables; refuses pending/failed work

// On each application connection, after initialization:
const monitor = watchMigrations(control, (reason) => {
  // Stop accepting work, drain current callbacks, close the connection, and
  // tell the operator to restart. The monitor does not own those resources.
  console.error(reason.message)
}, 1000)

// On a separate, quiescent migrator connection (not inside another transaction):
await control.run('documents/add-summary-v1', (db) => {
  db.exec('alter table doc add column summary text')
}, { intervalMs: 1000, marginMs: 100 })

monitor.stop() // before closing the application connection
```

The example assumes `driver` is an existing SQLite driver. Use the same maximum
polling interval across cooperating applications; a longer interval on any peer
needs a correspondingly longer grace period. The default is one second plus a
100 ms migration margin. Polling performs one control-table read per interval,
not a query before every application operation. An observed generation change
stops the monitor and invokes its callback once, even if it missed the pending
phase.

The single row retains a generation, migration name, pending/applied/failed
state, announcement/deadline timestamps, and completion/error information. It is
not a migration history or a replacement for application migration markers.
`announce`, `apply`, and `fail` expose the stages separately. Concurrent
announcements serialize through `BEGIN IMMEDIATE`; a pending or failed migration
cannot be silently replaced. A failed callback rolls back its DDL/data changes,
then records failure separately. A crash may leave `pending`; it requires
operator investigation. `acknowledge(generation)` explicitly releases a failed
or abandoned announcement **after** repair/inspection; it does not undo changes
or determine whether replay is safe. All migration callbacks must be synchronous
and must not start external side effects or manage their own transactions.

**This is best-effort cooperation, not a corruption-prevention guarantee.** A
suspended process, delayed timer, or long-running callback can outlast the grace
period. There are no peer acknowledgments. SQLite serializes write transactions,
but that does not establish application-level schema compatibility. Stop peers
explicitly for migrations that require guaranteed quiescence. A crash between
rollback and recording failure can also leave a pending announcement.

Deploy this protocol to all participating writers before depending on it.
Unaware clients, raw SQL, and migrations outside this API do not participate.
The control table must be initialized during that rollout. On a fresh open,
`ready()` cannot determine whether older application code understands a
migration that already completed; version compatibility still belongs to the
application. Data-only transformations are announced just like DDL when
performed via this API.

## License

Apache-2.0
