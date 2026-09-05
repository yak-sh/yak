# @yaks/sqlite

A **storage adapter** that turns the yaks query/vocabulary/SQL stack into a
working SQLite-backed store. It composes three sibling packages —

- [`@yaks/query`](https://jsr.io/@yaks/query) parses a query string into an AST,
- [`@yaks/vocab`](https://jsr.io/@yaks/vocab) describes a component vocabulary,
- [`@yaks/sql`](https://jsr.io/@yaks/sql) compiles an AST + a vocabulary into
  SQL,

— and adds the two halves those packages leave to a backend: the **schema** a
vocabulary implies, and the **writes** that patch data into it. Reads come for
free: it runs `@yaks/sql`'s compiled statement and gathers the rows into whole
entities.

## The model

Everything is an **entity** — a string id — that wears **components**, a row per
component in its own table. An entity _is_ what its components make it: a blog
post is a `doc` plus a `post`; a product is a `doc` plus a `price`. A component
adds one facet, and any component can be added to any entity, so two
vocabularies compose by sharing ids.

The adapter speaks **bundles**. A bundle gathers an entity's components under
one roof — the identity is the `entity` component, never a bare root `eid`:

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
        body: { type: 'string', store: 'blob' },
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
store.install() // create the tables, the doc view, the search index
```

### Write

A write is a batch of bundles, patched in atomically at the SQL level. Clients
mint the ids:

```ts
store.write([
  { entity: { eid: 'kate' }, doc: { title: 'Kate' } },
  {
    entity: { eid: 'p1' },
    doc: { title: 'Hello world', body: 'first post' },
    post: { published: true, author: 'kate' },
  },
])
```

Writes are **patches**:

- **omitted columns are untouched** — a patch names only what changes,
- **a column set to `null` is cleared**,
- **a component set to `null` is dropped** — the row goes, the entity stays,
- **`$delete: true` deletes the entity** — it is tombstoned, and death cascades.

```ts
store.write([{ entity: { eid: 'p1' }, post: { published: false } }]) // author untouched
store.write([{ entity: { eid: 'p1' }, post: null }]) // drop the post component
store.write([{ entity: { eid: 'p1' }, $delete: true }]) // delete the whole entity
```

Deleting an entity spreads along its references, and each reference's declared
death word says how: a `cascade` reference pulls its owner into the grave, a
`release` reference's row is dropped (its owner lives), a `detach` reference is
nulled, a `keep` reference stands as history. `write()` returns the ids of every
entity a delete tombstoned.

### Read

A read compiles a query (a string, or an AST built with `@yaks/query`) and hands
back the matching entities as bundles, with references resolved back to the ids
they point at:

```ts
store.read('.published=true') // every published post, whole
store.read('.kind=post&.limit=10') // the ten newest posts
store.read('hello') // a bare word is a full-text search over doc title + body
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

returns a `Storage`:

- `ddl(): string[]` — the schema statements the vocabulary implies.
- `install(): void` — run them (create-if-not-exists, so it is idempotent).
- `read(query, opts?): Bundle[]` — a query → matching entities as bundles.
- `rows(query, opts?): Row[]` — a query → the compiled statement's raw rows (for
  counts, tallies, and field projections).
- `write(bundles): string[]` — patch a batch in → the ids any delete tombstoned.

`base` and per-call `opts` are `@yaks/sql` bind options — a derived-column
registry, and a fixed `now` for resolving time phrases.

### The driver

The adapter never constructs a connection. It calls two methods:

```ts
type Driver = {
  query: (sql: string, params: Param[]) => Row[]
  exec: (sql: string) => void
}
```

Back it with an in-process SQLite for a test, a pooled handle for a server, or
any engine that can run parameterized SQL — the values always ride as bound
params, never concatenated into the statement.

## The storage layout

`@yaks/sql`'s SQLite dialect and this package agree on one layout, and
`install()` builds exactly what the compiled reads expect:

- an `entity` table — the identity: an integer `id`, a string `eid`, a `num`;
- a `tombstone` table — a deleted entity keeps its `entity` row (its integer id
  never recycles) and gains a tombstone the reads exclude on;
- one table per component, keyed by an integer `entity` owner; a reference
  stores the target's integer id (with a foreign key), a scalar its value, a
  column-less component is a bare tag whose row's existence is the fact;
- a `doc_value` view and a `doc_fts` full-text index over the `doc` component's
  text columns, when the vocabulary declares one.

## License

Apache-2.0
