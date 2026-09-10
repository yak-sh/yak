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
`doc` plus a `post`; a product is a `doc` plus a `price`. A component adds one
facet, and any component can be added to any entity, so two vocabularies compose
by sharing ids.

The adapter reads and writes **bundles**: objects containing an entity’s
components. Identity is in the `entity` component, not a root-level `eid`:

```ts
{ entity: { eid: 'cake-01' }, doc: { title: 'Lemon cake' }, recipe: { serves: 8 } }
```

A read hands bundles back; a write takes bundles and patches them in
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
- **a tombstoned entity takes no patch** — death is final; ids never recycle.

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

Deleting an entity spreads along its references, and each reference's declared
death word says how: a `cascade` reference pulls its owner into the grave, a
`release` reference's row is dropped (its owner lives), a `detach` reference is
nulled, a `keep` reference stands as history. Which entities that adds up to is
@yaks/graph's decision, read off the vocabulary; `tx.remove()` here removes
exactly the entities it is handed.

### Read

A read compiles a query (a string, or an AST built with `@yaks/query`) and hands
back the matching entities as bundles, with references resolved back to the ids
they point at:

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

returns a `Store` — @yaks/graph's `Storage`, answered synchronously:

- `ddl(): string[]` — the schema statements the vocabulary implies.
- `install(): void` — run them (create-if-not-exists, so it is idempotent).
- `read(query, opts?): Bundle[]` — a query → matching entities as bundles.
- `rows(query, opts?): Row[]` — a query → the compiled statement's raw rows (for
  counts, tallies, and field projections).
- `tx(body): R` — run `body` against a transaction, committing when it returns
  and rolling back if it throws. Transactions nest (they are SAVEPOINTs), so a
  store used inside a transaction the host already opened still gets its own
  all-or-nothing unit. The transaction offers:
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
any engine that can run parameterized SQL — the values always ride as bound
params, never concatenated into the statement.

`tx` is for an engine that will not open a transaction from SQL: a Cloudflare
Durable Object refuses `savepoint` as a statement and hands out
`transactionSync` instead
([@yaks/durable-object](https://jsr.io/@yaks/durable-object) passes it here).
Omit it and the store opens its own SAVEPOINTs, which is what every ordinary
SQLite connection wants.

## The storage layout

`@yaks/sql`'s SQLite dialect and this package agree on one layout, and
`install()` builds exactly what the compiled reads expect:

- an `entity` table — the identity: an integer `id`, a string `eid`, a `num`;
- a `tombstone` table — a deleted entity keeps its `entity` row (its integer id
  never recycles) and gains a tombstone the reads exclude on;
- one table per component, keyed by an integer `entity` owner; a reference
  stores the target's integer id (with a foreign key), a scalar its value, a
  column-less component is a bare tag whose row's existence is the fact;
- one index per `unique`/`index` a component declares, named after the columns
  it covers (`app_space_slug`) — a unique one is the constraint a race is
  decided by, and the losing insert is refused by the engine;
- a `doc_value` read view when the vocabulary declares a `doc` component.

Full-text search is opt-in: the application runs `schema(fields)` from
`@yaks/fts` after installing storage, and passes `{ extend: [search(fields)] }`
to `storage()`. SQLite does not depend on FTS or create its indexes.

## License

Apache-2.0

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
exposes the same per-plan resolver to hosts compiling SQL themselves; those
hosts must compile and execute in one read transaction. The built-in query door
does this automatically.

Whole gathers group owners by their descriptor's physical table set and select
each known present component once, binding only owners wearing it. Singleton
`get`/`pick` use that set too: even a requested-but-absent facet needs no probe.
Readers with a smaller vocabulary ignore unknown tables without changing the
descriptor. Table-set content is cached, never component values or database id
assignments, so rollback, another writer, and boot retirement remain visible.

Stores without the archetype vocabulary, and unclassified rows written through
the low-level `patch()` API before backfill, retain the existing census
fallback. A partial catalog declines presence optimization rather than hide such
rows. The classified path never runs that census. Golden tests compare it to the
frozen old gather; `deno bench -A packages/sqlite/fixtures/read-bench.ts` runs a
same-driver A/B snapshot, singleton, and graph single-cell/no-op comparison.

### Selective human numbering

`storage(driver, vocab, { number: { except: ['entry'] } })` omits human numbers
for entities carrying any listed facet. The policy sees all bundles in an
admitted patch, even when a reference precedes the target's bundle. Exclusion
wins over other facets (an entry that also carries `task` remains unnumbered).
The engine does not know what `entry` means; applications choose the facets.
`@yaks/ram` accepts the same option. Default numbering and `number: false`
remain available.

Attaching an excluded facet to an already numbered entity clears its number.
Removing that facet does not allocate a replacement number: identity is minted
once. Applications enabling this policy on existing data must clear historical
numbers for their excluded facets; the harness does this for `entry` on open.

SQLite maintains a transactional `entity_sequence` high-water mark, initialized
from existing numbers on install and advanced by insert/update triggers.
Clearing numbers never recycles an old human identifier, even after reopening
the store. RAM retains its existing transactional high-water counter. An
identity minted as a bare reference in an _earlier_ transaction may already have
consumed a number; classification cannot anticipate future facets.
