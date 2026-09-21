# @yaks/sqlite

SQLite storage for [@yaks/graph](../graph/README.md). It derives tables from a
component vocabulary, compiles queries, gathers entity bundles, and implements
transactional patches and deletion cascades. The application supplies a `Driver`
for its SQLite runtime and initializes the schema.

For bundle structure, write phases, and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## The model

Each **entity** has a string id and **components**, with a row per component in
its own table. An entity _is_ what its components make it: a blog post is a
`doc` plus a `post`; a product is a `doc` plus a `price`. Each component covers
one aspect of an entity, and any component can be stored on any entity, so two
vocabularies compose by sharing ids.

The adapter reads and writes **bundles**: objects holding an entity's
components. Identity is in the `entity` component, not a root-level `eid`:

```ts
{ entity: { eid: 'cake-01' }, doc: { title: 'Lemon cake' }, recipe: { serves: 8 } }
```

A read returns bundles; a write takes bundles and patches them in
(`Change = Bundle[]`).

## Usage

Describe your vocabulary as JSON Schema plus the yaks keywords, load it with
`@yaks/vocab`, and bind a store to a driver and that vocabulary:

```ts
import { Database } from 'jsr:@db/sqlite'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'

let vocab = loadVocab({
  $defs: {
    entity: { type: 'object', wire: false, properties: {} },
    doc: {
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    post: {
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

// A driver is anything with `query(sql, params)` and `exec(sql)`.
let db = new Database(':memory:')
let driver = {
  query: (sql, params) => db.prepare(sql).all(...params),
  exec: (sql) => db.exec(sql),
}

let store = storage(driver, vocab)
store.install() // create the tables, the doc view, the declared indexes
```

A table's shape is what its component declares: `required` columns are NOT NULL,
a `default` fills the row that omits one (`{"now": true}` writes the current
time), an `enum` becomes a CHECK, `type: integer` keeps integer affinity, and a
partial `unique` covers only the rows that hold its `present` columns.
`install()` is additive on an existing database: a column added later keeps a
literal default and its CHECK, and gets the current time only on rows written
from then on.

### Write

A write is a batch of bundles, patched in inside a transaction. Clients mint the
ids; the store mints the identity rows and their numbers:

```ts
store.tx((tx) =>
  tx.patch([
    { entity: { eid: 'kate' }, doc: { title: 'Kate' } },
    {
      entity: { eid: 'p1' },
      doc: { title: 'Hello world', body: 'first post' },
      post: { published: true, author: 'kate' },
    },
  ])
)
```

Writes are **patches**:

- **omitted columns are untouched** — a patch names only what changes,
- **a column set to `null` is cleared**,
- **a component set to `null` is dropped** — the row goes, the entity stays,
- **a tombstoned entity takes no patch** — deletion is final; ids never recycle.

Usually you do not call `tx` yourself: point
[@yaks/graph](https://jsr.io/@yaks/graph) at the store and `apply()` a batch.
The graph owns the DECISIONS — admission, preconditions, which entities a delete
takes with it, provenance — and this package owns the BYTES:

```ts
import { graph } from '@yaks/graph'

let g = graph({ storage: store, vocab })
g.apply([
  { entity: { eid: 'p1' }, post: { published: false } }, // author untouched
  { entity: { eid: 'p2' }, post: null }, // drop the post component
  { entity: { eid: 'p3' }, $delete: true }, // delete the whole entity
])
```

Deleting an entity propagates along its references, and each reference's
declared death behavior decides how: a `cascade` reference deletes its owner
too, a `release` reference's row is dropped (its owner survives), a `detach`
reference is set to null, a `keep` reference is left as history. Which entities
that adds up to is @yaks/graph's decision, read off the vocabulary;
`tx.remove()` here removes exactly the entities it is given.

### Read

A read compiles a query (a string, or an AST built with `@yaks/query`) and
returns the matching entities as bundles, with references resolved back to the
ids they point at:

```ts
store.read('.published=true') // every published post, whole
store.read('.kind=post&.limit=10') // the ten newest posts
store.read('.post.author.doc.title~=kate') // filter through a reference

store.rows('.published=true&.count!') // raw aggregate rows: [{ value: '', n: 3 }]
```

The query grammar — operators, any-of lists (`a,b`), ranges (`x..y`), time
phrases, `.kind` scoping, `.order`/`.limit` windows, `.count`/`.tally`
aggregates — is `@yaks/query`'s; see that package for the full format.

## API

```ts
storage(driver, vocab, base?) // bind a store to a driver + vocabulary
```

returns a `Store` — @yaks/graph's `Storage`, implemented synchronously:

- `ddl(): string[]` — the schema statements the vocabulary implies.
- `install(): void` — run them (create-if-not-exists, so it is idempotent); it
  also mints the store's epoch (see the key/value section below) and, over a
  driver holding a FILE, keeps the statistics the query planner reads the schema
  with (`PRAGMA optimize`, bounded by `analysis_limit`). A component table
  carries no secondary index, so a store with no `sqlite_stat1` is one the
  planner sizes by its built-in million-row guess, and "the entities wearing
  `call`" is planned as a walk of the whole spine.
- `read(query, opts?): Bundle[]` — a query → matching entities as bundles.
- `rows(query, opts?): Row[]` — a query → the compiled statement's raw rows (for
  counts, tallies, and field projections).
- `tx(body): R` — run `body` against a transaction, committing when it returns
  and rolling back if it throws. Transactions nest (they are SAVEPOINTs), so a
  store used inside a transaction the application already opened still gets its
  own all-or-nothing unit. The transaction provides:
  - `read(query, opts?): Bundle[]` — as above, through the transaction.
  - `get(eids): Bundle[]` — identity, not search: these entities, whole. A
    tombstoned one comes back with a `tombstone` component.
  - `patch(bundles): Entity[]` — patch a batch in → the entities it MINTED, each
    with the `num` it was given.
  - `remove(entities): void` — drop their component rows and tombstone their
    identities.

`base` and per-call `opts` are `@yaks/sql` bind options — a derived-column
registry, and a fixed `now` for resolving time phrases.

### The driver

The adapter never constructs a connection. It calls two methods:

```ts
type Driver = {
  query: (sql: string, params: Param[]) => Row[]
  exec: (sql: string) => void
  tx?: <R>(body: () => R) => R // only when the engine owns transactions
}
```

Back it with an in-process SQLite for a test, a pooled handle for a server, or
any engine that can run parameterized SQL — the values are always bound
parameters, never concatenated into the statement.

`tx` is for an engine that will not open a transaction from SQL: a Cloudflare
Durable Object rejects `savepoint` as a statement and provides `transactionSync`
instead ([@yaks/durable-object](https://jsr.io/@yaks/durable-object) passes it
here). Omit it and the store opens its own SAVEPOINTs, which is what every
ordinary SQLite connection wants.

## The storage layout

`@yaks/sql`'s SQLite dialect and this package agree on one layout, and
`install()` builds exactly what the compiled reads expect:

- an `entity` table — the identity: an integer `id`, a string `eid`, a `num`;
- a `tombstone` table — a deleted entity keeps its `entity` row (its integer id
  never recycles) and gains a tombstone the reads exclude on;
- one table per component, keyed by an integer `entity` owner; a reference
  stores the target's integer id (with a foreign key), a scalar its value, and a
  component with no columns is a bare tag whose row's existence is the fact;
- one index per `unique`/`index` a component declares, named after the columns
  it covers (`app_space_slug`) — a unique one is the constraint a race is
  decided by, and the losing insert is rejected by the engine;
- a `doc_value` read view when the vocabulary declares a `doc` component;
- a `server_meta` key/value table — the store's own, described below.

Full-text search is opt-in: the application runs `schema(fields)` from
`@yaks/fts` after installing storage, and passes `{ extend: [search(fields)] }`
to `storage()`. SQLite does not depend on FTS or create its indexes.

### The batch as a world: the overlay

A rule is a query, and a query reads tables — so a rule evaluated against a
batch that has not been written yet needs the batch to BE a table. `overlay()`
makes it one, as a `with` prefix the statement carries:

```ts
import { overlay } from '@yaks/sqlite'

let over = overlay(driver, vocab, batch, ['result', 'call'])
driver.query(over.with + sql, [...over.params, ...params])
```

Each covered component gets a common table expression — the committed rows the
batch did not touch, unioned with the batch's own — and the rule's dialect
points that component's name at it (`over.at`). Nothing is created, nothing is
dropped, and nothing outside the statement can see it. A patch is folded into
the committed row once, here; a dropped component and a deleted entity leave the
CTE; an entity the batch mints gets a NEGATIVE integer id (storage hands out
positive ones), so a rule can join two entities the same batch created.

What the batch REMOVED gets a list of its own (`over.gone`), because a dropped
row leaves the CTE and "it was removed" then reads exactly like "it was never
there". `-comp` (@yaks/query's deletion clause) is the query that tells them
apart, and `rules.ts` contributes its lowering as an @yaks/sql extension — so a
rule, or a pattern effect, can fire on what a batch removed. A statement with no
overlay under it evaluates that clause as `false`: run against the committed
rows alone, a match is about what is stored, never about what was removed.

This used to be temp tables shadowing the committed ones, until an
application-declared rule was run inside a deployed Worker: a Durable Object's
SQLite rejects a temp object outright (`not authorized: SQLITE_AUTH`). A CTE
runs wherever SQL does, and it removed the shadowing hazard along with it —
while a temp table stood, an unqualified INSERT would have landed in it.

It costs the BATCH, never the database: the CTE NAMES the committed table for
every row the batch never touched, so nothing is copied, and the fourth test in
`overlay_test.ts` measures it — three statements over a graph of 2 and a graph
of 2,002. Pass the components your rules name; a component nobody touched needs
no overlay at all.

What this requires of `@yaks/sql` is only that its dialect be used everywhere:
`table()`, `source()` for correlated subqueries, and `refEqAt()` for reference
equality all route through it, so a dialect that reads a component from
somewhere else is followed everywhere rather than only at the top-level joins.

A possible extension, named and not built: an overlay is a query, so a browser
that keeps its cache as tables could run the same compiled rule against the same
shape locally. Nothing here assumes a server; nothing here builds that either.

### The store's own key/value

Some facts belong to the STORE, not to anything in it: the epoch a returning
client checks its cursor against, a sweep's high-water mark, the marker
recording that a one-shot repair already ran. They live in `server_meta`, beside
the graph — a row there has no entity and no component, so no read, no bundle
and no client cache can ever carry it.

```ts
import { EPOCH, epoch, meta } from '@yaks/sqlite'

let m = meta(driver)
m.set('sweep', at) // text in, text out — the application formats its own values
m.get('sweep') // string | undefined
m.del('sweep')

epoch(driver) // the store's lineage id: minted once, read back forever
```

`install()` mints the epoch, and `epoch()` is idempotent, so a store that has
one keeps it. It WRITES; a read-only path calls `meta(driver).get(EPOCH)`
instead and treats an absent one as a store no cursor can be trusted against.

The table is named `server_meta` (exported as `META`) so it can never collide
with a `meta` COMPONENT, and `create table if not exists` means installing over
an application's existing one adopts it rather than creating a second.

Whole-entity gathers use `json_each(?)` to bind a bounded set of identities as
one array, rather than preparing a statement per entity or a new placeholder
shape per batch size. This requires SQLite's JSON functions (built in since
SQLite 3.38; JSON1 on older builds). Selected identities are fixed before the
component gathers, so a concurrent writer cannot change the membership of a
window halfway through reading its components.

### Archetype reads

Load `archetypeDoc` and use the `archetypes()` graph plugin from
`@yaks/archetype` to maintain the spine's archetype pointer. `install()`
backfills existing rows. Presence and kind predicates automatically use a lazy
plan-time catalog; ordinary value-only queries do not load it. `catalog(driver)`
exposes the same per-plan resolver to applications compiling SQL themselves;
those applications must compile and execute in one read transaction. This
package's own read path does that automatically.

Whole gathers group owners by their descriptor's physical table set and select
each known present component once, binding only owners that have it. Singleton
`get`/`pick` use that set too: even a requested-but-absent component needs no
probe. Readers with a smaller vocabulary ignore unknown tables without changing
the descriptor. Table-set content is cached, never component values or database
id assignments, so rollback, another writer, and boot retirement remain visible.

An application that writes a component row past the graph (raw SQL into a
component table, inside its own transaction) calls `reclassify(driver, eids)`
there: the same physical-presence rule as boot, scoped to those owners, no queue
and no triggers. It returns the pointers that moved and any descriptor it
minted, as bundles the application can broadcast; descriptors and unknown eids
are left alone.

Stores without the archetype vocabulary, and unclassified rows written through
the low-level `patch()` API before backfill, retain the existing census
fallback. A partial catalog declines presence optimization rather than hide such
rows. The classified path never runs that census. Golden tests compare it to the
frozen old gather; `deno bench -A packages/sqlite/fixtures/read-bench.ts` runs a
same-driver A/B snapshot, singleton, and graph single-cell/no-op comparison.

### Selective human numbering

`storage(driver, vocab, { number: { except: ['entry'] } })` omits human numbers
for entities carrying any listed component. The policy sees all bundles in an
admitted patch, even when a reference precedes the target's bundle. Exclusion
wins over other components (an entry that also carries `task` remains
unnumbered). The engine does not know what `entry` means; applications choose
the components. `@yaks/ram` accepts the same option. Default numbering and
`number: false` remain available.

Attaching an excluded component to an already numbered entity clears its number.
Removing that component does not allocate a replacement number: identity is
minted once. Applications enabling this policy on existing data must clear
historical numbers for their excluded components; the harness does this for
`entry` on open.

SQLite maintains a transactional `entity_sequence` high-water mark, initialized
from existing numbers on install and advanced by insert/update triggers.
Clearing numbers never recycles an old human identifier, even after reopening
the store. RAM retains its existing transactional high-water counter. An
identity minted as a bare reference in an _earlier_ transaction may already have
consumed a number; classification cannot anticipate future components.

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
