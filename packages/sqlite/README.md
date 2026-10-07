# @yaks/sqlite

SQLite storage for [@yaks/graph](../graph/README.md). It builds a schema from a
[vocabulary](../vocab/README.md#vocabulary), reads
[queries](../query/README.md#query-model) as
[bundles](../graph/README.md#data-model), and applies transactional
[patches](../graph/README.md#data-model).

A **store** (`Store`) is the synchronous SQLite implementation of
[Storage](../graph/README.md#data-model), bound to a
[driver](../sql/README.md#driver) and a vocabulary by `storage()`. The **spine**
is the `entity` table's identity for an entity: its integer `id`, public `eid`,
optional `num`, and [archetype](../archetype/README.md) pointer. Component
tables refer to that integer `id`; bundles carry the public eid.

**server_meta** is the table of text key/value metadata kept outside graph
entities. `meta(driver)` reads, writes, and clears it. An **epoch** is the
store's persisted lineage identity, minted once by `epoch(driver)`; a client
cursor from a different epoch cannot resume against this store.

The application supplies the connection. The package owns the schema, reads,
writes, and transactions; the [graph](../graph/README.md#data-model) owns
admission, preconditions, plugins, and deletion decisions.

## Usage

```sh
deno add jsr:@yaks/sqlite jsr:@yaks/graph jsr:@yaks/vocab
```

This Deno example opens an in-memory database. Use a file path for persistence.
`open(path)` from `@yaks/sqlite/db` returns a driver over the database there,
with a prepared-statement cache, and a `close()`.

```ts
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

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
let sql = open(':memory:')
try {
  let store = storage(sql, vocab)
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
  equal((await g.read('.post.published=1')).map((b) => b.entity.eid), ['p1'])
  equal((await g.read('.post'))[0].post, { published: true, author: 'kate' })
  equal(store.tx((tx) => tx.doom(['kate'])).loose, [{
    eid: 'p1',
    comp: 'post',
    prop: 'author',
  }])
  await g.apply([{ entity: { eid: 'kate' }, $delete: true }])
  equal((await g.read('.post'))[0].post, { published: true, author: null })
} finally {
  sql.close()
}
```

## Exports

| Import path          | Purpose                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/sqlite`       | Storage, schema/read/write helpers, [overlays](#querying-pending-changes-with-an-overlay), archetype helpers, metadata, and migrations |
| `@yaks/sqlite/db`    | `open(path)`: an embedded Deno database as a cached driver                                                                             |
| `@yaks/sqlite/vocab` | `sqliteDoc` and `docs`, declaring storage and archetype diagnostic tools                                                               |
| `@yaks/sqlite/tools` | `runs({ storage: storage(sql, vocab) }, options?)`, implementing those checks on the application's connection                          |

The vocabulary export declares [tools](../tools/README.md), not graph
components. The checks inspect foreign-key enforcement/violations, SQLite
integrity, and archetype consistency; `sample` limits reported archetype
examples. See [mod.ts](./mod.ts) for the root export list.

## Write

Applications normally write through `graph.apply()`, which checks admission and
preconditions, runs plugins, and plans cascading deletion. The storage adapter
implements the resulting row changes and transaction. Low-level callers can use
`store.tx(tx => tx.patch(bundles))`, but that bypasses graph validation and
plugins.

```ts
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { equal, throws } from '@yaks/testing'

let sql = open(':memory:')
try {
  let store = storage(sql, loadVocab(docDoc))
  store.tx((tx) =>
    tx.patch([
      { entity: { eid: 'p1' }, doc: { title: 'Hello', body: 'First' } },
    ])
  )
  store.tx((tx) => tx.patch([{ entity: { eid: 'p1' }, doc: { title: null } }]))
  equal(store.get(['p1'])[0].doc, { title: null, body: 'First' })
  await throws(() =>
    store.tx((tx) => {
      tx.patch([{ entity: { eid: 'p1' }, doc: null }])
      throw new Error('abort')
    })
  )
  equal(store.read('.doc').length, 1)
  store.tx((tx) => tx.remove([{ eid: 'p1' }]))
  equal(store.read('.doc'), [])
  equal('tombstone' in store.get(['p1'])[0], true)
  store.tx((tx) => {
    tx.revive(['p1'])
    tx.patch([{ entity: { eid: 'p1' }, doc: { title: 'Again' } }])
  })
  equal(store.get(['p1'])[0].doc, { title: 'Again', body: null })
} finally {
  sql.close()
}
```

A deleted entity keeps its identity row and gains a tombstone. `tx.revive()`
removes the tombstone, and the identity keeps its eid, number and integer id;
which writes bring an entity back is @yaks/graph's to decide. Reference
properties declare [death behavior](../vocab/README.md#routing-and-references).
`tx.remove()` removes exactly the entities passed to it; the graph determines
the full cascade. Where the store keeps archetypes, it clears only the tables
each entity's archetype names, with any rows the open transactions wrote since
its pointer (`heldBy`); an entity with no pointer, or one naming no descriptor,
has every component table cleared. The transaction points each one no tracker
has pointed at the tombstone set as it closes (`entomb`), so a presence lookup
passes the dead by however they were removed.

## Read

`read` accepts a query string or [query AST](../query/README.md#query-model) and
returns whole bundles, resolving stored integer references back to public ids.
Use `rows` for aggregate and field-projection results. See
[@yaks/query](../query/README.md) for operators, lists, ranges, time phrases,
kind filters, ordering, pagination, and aggregates.

```ts
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { equal } from '@yaks/testing'

let sql = open(':memory:')
try {
  let store = storage(sql, loadVocab(docDoc))
  store.tx((tx) =>
    tx.patch([
      { entity: { eid: 'a' }, doc: { title: 'A' } },
      { entity: { eid: 'b' }, doc: { title: 'B' } },
    ])
  )
  equal(store.rows('.doc .count'), [{ value: '', n: 2 }])
  equal(store.rows('.doc.title=A .fields=doc.title'), [{
    eid: 'a',
    'doc.title': 'A',
  }])
  equal(store.get(['b'], ['doc'])[0].doc, { title: 'B', body: null })
  equal(sql.query(store.screen('.doc.title=A')!).length, 1)
} finally {
  sql.close()
}
```

## API

`storage(driver, vocab, base?)` returns a synchronous `Store`:

| Method                       | Result                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- |
| `worn(comp, prop)`           | Whether a property value implies component presence                     |
| `ddl()`                      | Schema statements derived from the vocabulary                           |
| `grown()`                    | Statements adding columns missing from existing tables                  |
| `install()`                  | Creates/updates schema, indexes, metadata, and archetype classification |
| `read(query, opts?, comps?)` | Matching bundles, read as one snapshot without taking the write lock    |
| `rows(query, opts?)`         | Raw result rows                                                         |
| `screen(query, opts?)`       | A statement selecting the ids a query admits, compiled as reads are     |
| `get(eids, comps?)`          | Those entities as stored, read without taking the write lock            |
| `tx(body)`                   | Runs the callback in a transaction and returns its result               |

`install()` preserves existing data, adds missing columns, and rebuilds a table
whose foreign keys or checks (a reference's death word, an enum) no longer match
the vocabulary, then retires obsolete vocabulary indexes and creates the
declared ones. When a text property becomes a reference, including a `keep`
reference with no foreign key, it resolves each stored eid to the entity spine's
integer id during the rebuild. A reference with a foreign key can resolve back
to eid text when its declaration reverses. A `keep` reference has no physical
key identifying its old interpretation, so a code rollback must retain its
current declaration. A value that cannot resolve leaves the old table untouched
and reports an error. A table whose rows the new shape would refuse, such as a
value an enum no longer lists, is left as it stood and reported through
`base.report` (the console by default): its rows need an application migration
that prepares them. It initializes the store epoch and number sequence and runs
bounded `PRAGMA optimize` for file-backed drivers, so the planner can use table
statistics. A database in memory that nothing has installed into is made from a
template: the first one a process makes for a vocabulary is kept, and each later
one is a copy of it, since copying a schema is a page copy and making one is
hundreds of statements (@yaks/sql `Driver.template`).

A file-backed store reads and writes only the schema already installed. Bind it
with `storage()` to query an existing graph; call `install()` explicitly when
creating or upgrading that graph. Opening a store does not install schema, run
migrations, inspect every table, analyze indexes, or repair objects another
connection removed. A query needing a missing table or column fails rather than
changing the file. An explicit install over a current file changes no schema,
but may update planner statistics. Installation belongs to the graph's
installer, not to commands opening it.

In-memory stores belong to their caller alone and install automatically at the
first operation unless a schema readiness check asserts they are prepared.

A **schema readiness check** is a single-owner host's assertion that the bound
vocabulary's schema, derived columns, metadata and archetypes already stand.
`base.schemaReady` runs at the first graph operation, not at binding. True skips
installation and schema inspection; false falls back to installation. The host
must bind a new store when its schema changes. File drivers ignore the check:
only an explicit `install()` changes their schema. Explicit `install()` always
validates.

```ts
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let sql = open(':memory:')
try {
  let vocab = loadVocab({ $defs: {} })
  storage(sql, vocab).install()
  // A single-owner host can also verify a persisted schema stamp here.
  let store = storage(sql, vocab, { schemaReady: () => true })
  equal(store.get(['absent']), [])
} finally {
  sql.close()
}
```

A transaction provides `read`, `get(eids, comps?)`, `patch`, `remove`, `revive`,
`doom`, and `bindings`. `get` retrieves entities including tombstones, whole or
carrying only the components `comps` names, and reads no other table. `patch`
returns newly created identities, with `num` when numbering is enabled. `doom`
resolves cascading deletion, and `bindings` evaluates rules against pending
changes.

SQL transactions commit on callback completion and roll back on failure; a
promise-returning callback is awaited. Nested calls use savepoints. A driver
with `file: true` starts the outer transaction with `BEGIN IMMEDIATE`, acquiring
the write lock before reads. A driver supplying its own `tx` controls
transaction behavior; Durable Object callbacks must remain synchronous.

`base` includes `@yaks/sql` bind options (`derived`, `backed`, `extend`, `now`,
and a custom dialect), merged with per-read options. A `derived` entry's `text`
expression also resolves its column in the `doc_value` view.

A component declared `computed: true` gets no table: it is read through the
[backing](../sql/README.md#computed-components) another package supplies
(`Backing`), as @yaks/journal's `_tx` and `_change` are. The store tags each
backing with `tagOf(epoch, comp)` once the first install has minted its epoch
(read from metadata without minting), so a backed entity's eid names it in this
store and no other. `read` and `get` return such entities like any other;
`patch` refuses one, since nothing writes it. `number` controls human numbering,
and `adopt: true` accepts numbers supplied in patches when mirroring another
store.

### Read options

[Derived properties](../sql/README.md#derived-properties) and
[backings](../sql/README.md#computed-components) use the same expressions in
filters and gathered bundles. This example reads a computed property from an
expression and a computed component from rows owned outside the spine:

```ts
import { open } from '@yaks/sqlite/db'
import { columns, storage } from '@yaks/sqlite'
import { as, col, fn, lit, select } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { equal, throws } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    note: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string' },
        data: { type: 'object' },
        loud: { type: 'string', computed: true },
      },
    },
    event: {
      component: true,
      computed: true,
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
    },
  },
})
let sql = open(':memory:')
try {
  let store = storage(sql, vocab, {
    derived: {
      'note.loud': {
        tag: 'text',
        expr: () => fn('upper', col('title', 'note')),
      },
    },
    backed: {
      event: {
        rows: select({
          cols: [as(lit(1), 'entity'), as(lit('Started'), 'title')],
        }),
      },
    },
  })
  store.tx((tx) =>
    tx.patch([{
      entity: { eid: 'a' },
      note: { title: 'Hello', data: { colors: ['blue'] } },
    }])
  )
  equal(store.read('.note.loud=HELLO')[0].note, {
    title: 'Hello',
    data: { colors: ['blue'] },
    loud: 'HELLO',
  })
  equal(columns(sql, 'note'), ['entity', 'title', 'data'])
  equal(store.worn('note', 'loud'), true)
  let event = store.read('.event')[0]
  equal(store.get([event.entity.eid])[0].event, { title: 'Started' })
  await throws(() =>
    store.tx((tx) =>
      tx.patch([
        { entity: { eid: event.entity.eid }, event: { title: 'Changed' } },
      ])
    ), 'computed')
} finally {
  sql.close()
}
```

### The driver

The root package does not open connections. It runs on `@yaks/sql`'s synchronous
`Driver`, which takes a statement as a node of `@yaks/sql`'s AST, renders it and
returns the rows. Every statement this package sends is built as a node.

`run` optionally executes writes without materializing rows. `tx` is for engines
such as a Durable Object that provide a transaction API instead of accepting
transaction SQL; it must support nesting. `arms` sets the compound-query group
size, defaulting to `@yaks/sql`'s conservative `ARMS`; the embedded driver uses
`STOCK`. Query values use bound parameters.

`@yaks/sqlite/db` exports `open(path)` and nothing of the embedded driver
itself, so a driver swap touches only this package. `open` creates a missing
directory and turns on foreign keys; a file also runs in WAL mode with
`synchronous = normal`, a 64 MiB retained WAL limit, and a one-minute busy
timeout. It honors `DENO_SQLITE_PATH`, otherwise selecting the platform's system
library. This module uses Deno environment/FFI APIs. The root adapter can
instead receive another runtime's synchronous SQLite driver.

The embedded driver emits one `sql` span per statement while
[@yaks/trace](../trace/README.md) observes it or an enclosing graph operation.
Names contain the logical table and verb, such as `doc select` or
`entity
update`; transaction names omit savepoint identifiers, and pragma names
omit arguments and values. SQL text and bound values never enter the trace. A
successful span counts returned rows for reads and affected rows for writes,
including writes without `returning`. Each attempted statement also charges
`statements`, `rowsRead` and `rowsWritten` to its span and open ancestors;
failed statements count once without charging a stale affected-row count. These
inclusive metrics use the returned rows and native changes count, with no
additional SQL. SQL nests under the current phase, hook, rule, read or
transaction. No subscriber means no statement metadata, spans, clocks or counts
are allocated.

```ts
import { open } from '@yaks/sqlite/db'
import { insert } from '@yaks/sql'
import { record } from '@yaks/trace'
import { equal } from '@yaks/testing'

let sql = open(':memory:')
try {
  sql.query({ t: 'create table', name: 'note', cols: [{ name: 'title' }] })
  let captured = record(
    sql,
    () => sql.query(insert('note', { title: 'Hello' })),
  )
  equal(captured.spans[0].name, 'note insert')
  equal(captured.spans[0].counts, {
    rows: 1,
    statements: 1,
    rowsRead: 0,
    rowsWritten: 1,
  })
} finally {
  sql.close()
}
```

## Schema installation

`schema(vocab)` builds statements for a fresh database.
`retabled(driver, vocab, reads?)` keeps an identical document view and replaces
only a changed one. `standing(driver,
vocab)` reads existing tables;
`grown(vocab, standing)` builds missing-column statements, and
`refit(vocab, standing)` builds table-rebuild statements. `fit(driver, vocab)`
executes growth and rebuilds, returning errors for tables whose existing values
cannot fit. `Store.install()` also maintains indexes, metadata, and archetypes.

```ts
import { open } from '@yaks/sqlite/db'
import { columns, storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'
import { equal, throws } from '@yaks/testing'

let sql = open(':memory:')
try {
  let first = loadVocab({
    $defs: {
      note: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
    },
  })
  let old = storage(sql, first)
  old.tx((tx) => tx.patch([{ entity: { eid: 'a' }, note: { title: 'Kept' } }]))
  let next = loadVocab({
    $defs: {
      note: {
        component: true,
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string', default: 'Empty' },
        },
      },
    },
  })
  let store = storage(sql, next)
  equal(store.grown().length, 1)
  store.install()
  equal(columns(sql, 'note'), ['entity', 'title', 'summary'])
  equal(store.get(['a'])[0].note, { title: 'Kept', summary: 'Empty' })
  equal(store.grown(), [])
  let constrained = loadVocab({
    $defs: {
      note: {
        component: true,
        type: 'object',
        properties: {
          title: { type: 'string', enum: ['Kept', 'Other'] },
          summary: { type: 'string', default: 'Empty' },
        },
      },
    },
  })
  let checked = storage(sql, constrained)
  checked.install()
  await throws(() =>
    checked.tx((tx) =>
      tx.patch([
        { entity: { eid: 'a' }, note: { title: 'Refused' } },
      ])
    ), 'CHECK')
  equal(checked.get(['a'])[0].note, { title: 'Kept', summary: 'Empty' })
} finally {
  sql.close()
}
```

## The storage layout

- `entity`: integer `id`, public `eid`, optional `num`, and
  [archetype](../archetype/README.md) pointer.
- `tombstone`: deletion records excluded from normal queries.
- One table per stored component, keyed by integer `entity`, and none for a
  computed one. References store integer target ids; ordinary references have
  foreign keys, while `keep` references can preserve historical ids. A component
  without properties is represented by the existence of its row.
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

<a id="the-batch-as-a-world-the-overlay"></a>

### Querying pending changes with an overlay

An **overlay** represents pending patches as common table expressions in one SQL
statement. `overlay(driver, vocab, bundles, covers)` lets rules read the state
those patches would produce. It returns common table expressions in `with`, a
component source-name resolver `at`, removed-row information `gone`, covered
component names in `covers`, and eid-to-integer mappings in `ids`. Bound
parameters are carried by the common table expression nodes.

Each affected component gets a common table expression combining untouched
committed rows with merged pending rows. Component removals and deleted entities
are excluded. New entities receive temporary negative integer ids so references
within the pending changes can join correctly. The common table expression
exists only for its SQL statement; it creates no database object.

The `gone` data lets rules distinguish a component removed by this write from
one that never existed. `rules.ts` implements the `-comp` deletion clause
through an SQL extension. Against committed data without an overlay, that clause
is false.

The overlay avoids temporary tables, which Durable Object SQLite rejects and
which could redirect unqualified writes while present. It reads the committed
table directly and materializes only affected data. Pass the component names the
rules inspect; untouched components need no overlay. Dialect hooks including
`table`, `source`, and `refEqAt` keep references and correlated subqueries on
the same pending state. This package does not provide a browser cache
implementation.

```ts
import { open } from '@yaks/sqlite/db'
import { matched, overlay, storage } from '@yaks/sqlite'
import { match } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { equal } from '@yaks/testing'

let sql = open(':memory:')
try {
  let vocab = loadVocab(docDoc)
  let store = storage(sql, vocab)
  store.tx((tx) =>
    tx.patch([{ entity: { eid: 'a' }, doc: { title: 'Before' } }])
  )
  let bundles = [{ entity: { eid: 'a' }, doc: { title: 'After' } }]
  let over = overlay(sql, vocab, bundles, ['doc'])
  let hits = matched(
    sql,
    match('.doc.title=After'),
    vocab,
    {},
    { at: over.at },
    over.with,
  )
  equal(hits.map((b) => b.entities), [['a']])
  equal(
    store.tx((tx) =>
      tx.bindings([match('.doc.title=After')], bundles, ['doc'])
    )[0],
    hits,
  )
  equal(store.read('.doc.title=After'), [])
} finally {
  sql.close()
}
```

### The store's own key/value

`meta(driver)` reads, writes, and clears server_meta. These values have no
entity identity and do not appear in bundles or graph queries.

```ts
import { open } from '@yaks/sqlite/db'
import { EPOCH, epoch, epochAt, meta, storage } from '@yaks/sqlite'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let sql = open(':memory:')
try {
  equal(epochAt(sql), undefined)
  storage(sql, loadVocab({ $defs: {} })).install()
  let m = meta(sql)
  m.set('sweep', '42')
  equal(m.get('sweep'), '42')
  m.del('sweep')
  equal(m.get('sweep'), undefined)
  equal(epoch(sql), m.get(EPOCH))
  equal(epoch(sql), epochAt(sql))
} finally {
  sql.close()
}
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
installation classifies existing rows. A **catalog** is a lazy snapshot that
maps matching archetypes to their integer ids. Presence and kind queries load a
catalog; value-only queries do not. Applications using `catalog(driver)` to
compile their own queries must compile and execute within one read transaction,
as this package's read path does.

Whole-entity reads group entities by the component tables their archetype
identifies and query only owners with each component. `get` uses this
information even for single entities. Readers ignore tables outside their
vocabulary without changing the descriptor. Only table sets are cached, allowing
rollback, other writers, and schema changes to remain visible.

Every `Store.tx(body)` maintains archetype pointers for patches, removals, and
revivals made through its `Tx`. Its **ledger** records component-table presence
changes and which entities have already been classified; `ledger().owed()` names
those still needing classification when the callback finishes. A transaction
opened inside another also hears the outer ones' ledgers. Within the
transaction, `Tx.get` reads pending component changes from their physical rows.
`Tx.read` classifies pending changes before querying the archetype index; later
patches continue from that classified shape.

A raw SQL writer, past the store, must call `reclassify(driver, eids)` inside
its transaction after changing component rows: whole reads, presence filters and
deletes all go by the pointer. It returns changed pointers and new descriptors
as bundles that the application can broadcast; descriptor entities and unknown
ids are ignored. `drift(driver)` is the audit (`archetype_check`): it reads
every owner's presence and counts the pointers that disagree, writing nothing;
`mend(driver)` classifies every one it finds again, a few thousand to a unit.
Stores without archetypes and unclassified low-level writes fall back to
inspecting component presence. An incomplete catalog declines the query
optimization instead of hiding entities.

```ts
import { open } from '@yaks/sqlite/db'
import {
  drift,
  identity,
  inspect,
  mend,
  reclassify,
  storage,
} from '@yaks/sqlite'
import { archetypeDoc } from '@yaks/archetype'
import { docDoc } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { by, lit } from '@yaks/sql'
import { equal } from '@yaks/testing'

let sql = open(':memory:')
try {
  let store = storage(sql, loadVocab([archetypeDoc, docDoc]))
  store.tx((tx) => tx.patch([{ entity: { eid: 'a' }, doc: { title: 'A' } }]))
  equal(drift(sql).drifted, 0)
  equal(identity(sql, 'a').tables, ['doc'])
  equal(inspect(sql).shown.find((t) => t.name == 'doc')?.rows, 1)
  sql.query({
    t: 'update',
    table: 'entity',
    set: { archetype: lit(null) },
    where: by({ eid: 'a' }),
  })
  equal(drift(sql).sample, ['a'])
  equal(mend(sql), 1)
  store.tx(() => {
    sql.query({ t: 'delete', from: 'doc' })
    reclassify(sql, ['a'])
  })
  equal(drift(sql).drifted, 0)
  equal(store.read('.doc'), [])
} finally {
  sql.close()
}
```

### Diagnostic tools

`inspect(driver, limit?, preferred?)` counts tables and indexes without reading
component values; `identity(driver, eid)` reports physical presence and
tombstoning. Both cap inspection at 160 tables. The tools declared by
`sqliteDoc` check foreign keys, SQLite integrity, and archetype pointers;
`runs({ storage: storage(sql, vocab) }, { sample })` implements them on the
application's connection. They report findings without repairing data.

```ts
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { sqliteDoc } from '@yaks/sqlite/vocab'
import { runs } from '@yaks/sqlite/tools'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let sql = open(':memory:')
try {
  let vocab = loadVocab(sqliteDoc)
  let g = graph({ vocab, storage: storage(sql, vocab) })
  await g.install()
  let checks = runs({ storage: storage(sql, vocab) }, { sample: 3 })
  let call = { entity: { eid: 'check' }, call: { args: {} } }
  let [clean] = await checks.storage_check(call, g) as Bundle[]
  equal(clean.finding, undefined)
  let [absent] = await checks.archetype_check(call, g) as Bundle[]
  equal(absent.finding, { level: 'warn' })
} finally {
  sql.close()
}
```

### Selective human numbering

[Human numbering](../id/README.md) is opt-in: use `{ number: true }`, or
`{ number: { except: ['entry'] } }` to exclude entities with certain components.
Omitting `number` or setting it to false leaves new entities unnumbered.
Exclusions inspect all patches in the admitted write, including a reference
whose target appears later, and override other components on the same entity.
`@yaks/ram` accepts the same policy.

Adding an excluded component clears an existing number. Removing it does not
allocate a replacement. Applications enabling exclusions on existing data must
clear historical numbers themselves. A bare reference created in an earlier
transaction may already have consumed a number before its eventual components
were known.

The transactional `entity_sequence` high-water mark is initialized from existing
numbers and advanced by insert/update triggers. Clearing a number does not
recycle it, including after reopening the database. `adopt: true` instead
accepts an incoming identity's `num` or explicit null when replicating another
graph.

```ts
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { idDoc } from '@yaks/id/vocab'
import { spineDoc } from '@yaks/kernel/vocab'
import { docDoc } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let sql = open(':memory:')
try {
  let vocab = loadVocab([spineDoc, idDoc, docDoc, {
    $defs: {
      entry: { component: true, type: 'object', properties: {} },
    },
  }])
  let store = storage(sql, vocab, {
    number: { except: ['entry'] },
    adopt: true,
  })
  store.tx((tx) =>
    tx.patch([
      { entity: { eid: 'a', num: 40 }, doc: { title: 'Adopted' } },
      { entity: { eid: 'b' }, entry: {} },
      { entity: { eid: 'c' }, doc: { title: 'Allocated' } },
    ])
  )
  equal(store.get(['a', 'b', 'c']).map((b) => b.entity.num), [
    40,
    undefined,
    41,
  ])
} finally {
  sql.close()
}
```

## Preannounced migrations

A **migration control** (`MigrationControl`) coordinates an application
migration through one `_yaks_migration` table. A **generation** is the integer
incremented with each committed announcement. A **migration watch**
(`MigrationWatch`) polls a migration control and calls its callback once when
the generation changes, pending or failed work appears, or polling fails.

The graph installer calls `installMigrations(driver)` to create the control
table. Applications bind `migrations(driver)` and call `ready()` before opening
their graph; binding never creates a table. `run(name, change)` commits an
announcement, waits without holding a write transaction, then commits a
synchronous migration and its completion record together. `announce`, `apply`,
and `fail` expose the stages separately.

This example uses a zero grace period and an explicit watch check because both
connections are controlled by the example. Cooperating applications use the same
maximum polling interval: `run()` defaults to one second plus a 100 ms margin,
and `watchMigrations()` defaults to one second.

```ts
import { open } from '@yaks/sqlite/db'
import {
  columns,
  installMigrations,
  migrations,
  watchMigrations,
} from '@yaks/sqlite'
import { equal, throws } from '@yaks/testing'

let path = await Deno.makeTempFile({ suffix: '.db' })
let app = open(path), migrator = open(path)
let notices: Error[] = []
installMigrations(app)
let control = migrations(app)
let changes = migrations(migrator)
let watch = watchMigrations(control, (reason) => notices.push(reason))
try {
  equal(control.ready(), 0)
  let claim = changes.announce('add-note', 0)
  await throws(() => control.ready(), 'pending')
  watch.check()
  equal(notices.length, 1)
  changes.apply(claim, (db) =>
    db.query({
      t: 'create table',
      name: 'note',
      cols: [{ name: 'title', type: 'text' }],
    }))
  watch.check()
  equal(notices.length, 1)
  equal(control.ready(), claim.generation)
  equal(columns(app, 'note'), ['title'])
  let failed = changes.announce('abort', 0)
  await throws(() =>
    changes.apply(failed, () => {
      throw new Error('abort')
    }), 'abort')
  equal(control.read()?.state, 'failed')
  // After inspecting and repairing failed or abandoned work:
  changes.acknowledge(failed.generation)
  equal(control.ready(), failed.generation)
  let applied = await changes.run('add-summary', (db) =>
    db.query({
      t: 'alter table',
      table: 'note',
      add: { name: 'summary', type: 'text' },
    }), { intervalMs: 1, marginMs: 0 })
  equal(applied.state, 'applied')
  equal(columns(app, 'note'), ['title', 'summary'])
} finally {
  watch.stop()
  app.close()
  migrator.close()
  await Deno.remove(path)
}
```

The single row retains a generation, migration name, pending/applied/failed
state, announcement/deadline timestamps, and completion/error information. It is
not a migration history or a replacement for application migration markers.
Concurrent announcements serialize through `BEGIN IMMEDIATE`; a pending or
failed migration cannot be silently replaced. A failed callback rolls back its
DDL/data changes, then records failure separately. A crash may leave `pending`;
it requires operator investigation. `acknowledge(generation)` explicitly
releases a failed or abandoned announcement **after** repair/inspection; it does
not undo changes or determine whether replay is safe. All migration callbacks
must be synchronous and must not start external side effects or manage their own
transactions.

This is best-effort cooperation, not a corruption-prevention guarantee. A
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

## Limits

Graph admission, preconditions, plugins, and deletion decisions belong to
[@yaks/graph](../graph/README.md). Query parsing and SQL compilation belong to
[@yaks/query](../query/README.md) and [@yaks/sql](../sql/README.md). Full-text
indexes belong to [@yaks/fts](../fts/README.md); pass its extension in
`base.extend`. The root adapter accepts synchronous drivers; only `./db` uses
Deno environment and FFI APIs. Whole-entity reads require SQLite JSON support.

## License

Apache-2.0

## Statement capability

`storage(driver, vocab).statements` is the adapter's stable
[statement capability](../sql/README.md#statement-capability).
`statements(driver)` binds the same capability for an index without a graph
store. Both participate in the driver's current transaction; `atomic` uses the
same nested units as graph writes. Transaction-control statements are refused at
this door. The adapter loads its named vector facility, never a path supplied by
a plugin.

```ts
import { open } from '@yaks/sqlite/db'
import { statements } from '@yaks/sqlite'
import { equal, throws } from '@yaks/testing'

let driver = open(':memory:')
try {
  let sql = statements(driver)
  equal(statements(driver), sql)
  equal(sql.ownership, 'exclusive')
  await throws(() => sql.query({ t: 'begin' }), 'storage owns transactions')
} finally {
  driver.close()
}
```

The store also offers `checks`, bound diagnostics used by `@yaks/sqlite/tools`,
and `migrations`, its cooperative migration control. Hosts lend only the
migration monitor to portable plugins; operators use the adapter's migration
control with a dedicated connection.
