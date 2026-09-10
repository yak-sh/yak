# @yaks/graph

A component-based data model with transactional writes, queries, and plugins.
Use it to build an application whose database, local UI state, and API share the
same representation. The core has no database, network server, or UI dependency.

For an overview of the related packages and how to compose them, read
[Architecture](ARCHITECTURE.md). Each package can also be used independently
where its public interfaces allow it.

## Data model

An **entity** has a stable `entity.eid`. A **component** is a named object
attached to it, such as `book: { title: 'Dune' }`. An entity can have several
components; adding a component does not create a new entity or change its
identity. A **bundle** contains that identity and its components.

A vocabulary declares component names, property types, references, and other
constraints. Graph edges are entities too: applications can declare `edge` with
`from` and `to` references and add components describing the relationship. The
core does not require an application-specific entity class hierarchy.

`entity.num`, when allocated by storage, is a human-facing number, not identity.
Do not use it as a substitute for an EID. Storage can exclude entities from
numbering; transcript entries, for example, can use their own sequence field.

## Install

```sh
deno add jsr:@yaks/graph jsr:@yaks/vocab jsr:@yaks/ram
# Node projects can use: npx jsr add @yaks/graph @yaks/vocab @yaks/ram
```

## A complete in-memory example

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab({
  $defs: {
    book: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        pages: { type: 'number' },
      },
    },
  },
})
const g = graph({ storage: ram(vocab), vocab })
await g.install()

await g.apply([
  { entity: { eid: 'book:dune' }, book: { title: 'Dune', pages: 412 } },
])
await g.apply([{ entity: { eid: 'book:dune' }, book: { pages: 420 } }])
const books = await g.read('.book.pages>400')
console.log(books[0].book) // { title: 'Dune', pages: 420 }
```

The same graph interface works with [SQLite](../sqlite/README.md) and other
storage adapters. RAM is useful for tests and local state; it does not persist
across processes and does not implement every SQL query feature.

## Writes and reads

`apply(change)` accepts an array of bundle patches and applies it atomically:

- An omitted property is unchanged.
- A property set to `null` is cleared.
- A component set to `null` is removed.
- `$delete: true` deletes the entity, subject to reference-deletion rules.
- `$was` supplies per-property hashes of previously read values. A mismatch
  refuses the entire batch rather than overwriting a concurrent edit.

The result is the applied change, including changes produced by plugins and
reference handling. It contains one composed patch per affected entity; it is
not a full snapshot of every affected entity. Deleted entities are represented
by their identity and `tombstone: {}`.

`read(query)` returns bundles matching the query. For example, `.book` selects
entities with that component and `.book.pages>400` filters a property. See
[@yaks/query](../query/README.md) for syntax and adapter-specific support. An
empty query does not request a database dump.

The methods support synchronous and asynchronous adapters. Using `await` is safe
for either; a synchronous adapter can return values directly.

## IDs and names

Use an explicit EID when the application already has an identity. A name
starting with `$` is instead a temporary, batch-local alias:

```ts
const applied = await g.apply([
  { entity: { eid: '$newBook' }, book: { title: 'A new book', pages: 100 } },
])
```

The graph assigns an EID and resolves references to the same alias within that
batch. Reusing `$newBook` in a later batch does not name the previous entity.
For persistent, idempotent names, compose [@yaks/alias](../alias/README.md),
which uses [@yaks/key](../key/README.md). `g.address(ids)` asks installed
plugins to resolve names; it does not replace ordinary reference validation.

## Plugins and transactions

A plugin registers hooks at named phases, or declarative rules matching bundles.
Hooks can transform a change or reject it by throwing. Plugins are local to a
graph instance. See `Plugin`, `Hook`, and `Rule` in the exported API for their
context and return types.

The write pipeline separates work before mutation, transactional mutation, and
post-commit effects. In particular:

- `normalize` can rewrite incoming data.
- Admission and preconditions validate it against the vocabulary and current
  state before mutations are accepted.
- Reference handling, mutation, and journal work run within the storage
  transaction.
- `effect` observers run after commit. Their failure cannot undo a committed
  write.
- `audit` handles refused transactions.

Use [@yaks/effects](../effects/README.md) when a committed state change should
trigger work. Do not perform irreversible external operations in a hook whose
transaction could still roll back. An effect is not automatically exactly-once:
operations that may be retried need an idempotency strategy.

Declarative rules use queries for matching and specify a phase and produced
changes. They are useful for state transitions and derived writes; they do not
replace query-time derived properties. The vocabulary, storage adapter, and
plugins determine which features are available.

## Ownership and composition

This package exports the `Bundle`/`Change`, `Storage`/`Tx`, plugin, rule, and
tool contracts plus the graph implementation. It does not choose a database or
install domain components for you.

- [@yaks/vocab](../vocab/README.md) loads component schemas.
- [@yaks/ram](../ram/README.md), [@yaks/sqlite](../sqlite/README.md),
  [@yaks/d1](../d1/README.md), and
  [@yaks/durable-object](../durable-object/README.md) implement storage.
- [@yaks/client](../client/README.md) provides local state and live queries.
- [@yaks/api](../api/README.md) exposes graph operations over HTTP/WebSocket.
- [@yaks/render](../render/README.md) selects views using queries; it does not
  own state or persistence.

Authentication and authorization belong in the host/API composition. Declaring a
reference or component does not by itself grant or restrict access.

The core imports no host-specific APIs and can be used in browsers, workers, and
server runtimes. A chosen storage adapter or plugin may have narrower runtime
requirements.
