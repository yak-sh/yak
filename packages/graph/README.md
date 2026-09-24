# @yaks/graph

A component-based data model with transactional writes, queries, and plugins.
Use it to build an application whose database, local UI state, and API share the
same representation. The core has no database, network server, or UI dependency.

For an overview of the related packages and how to compose them, read
[Architecture](ARCHITECTURE.md). Each package can also be used independently
where its public interfaces allow it.

## Data model

These terms describe the data passed between the packages.

- An **entity** is a thing with a stable id, `entity.eid`. It has no type of its
  own.
- A **component** is a named object of properties attached to an entity, such as
  `book: { title: 'Dune' }`. An entity may carry several components; adding one
  does not create a new entity or change its identity. What an entity _is_ is
  decided by which components it carries.
- A **bundle** is one entity's components as a JSON object, including its
  identity:
  `{ entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } }`.
  Bundles are what reads return and what writes are expressed in.
- A **batch** is an array of bundles applied in one transaction. Each bundle is
  a patch: an omitted property is left alone, a `null` property is cleared, and
  a `null` component is removed.
- A **transaction** is what `apply(bundles)` runs the whole array in. Either all
  of it is written or none of it is.

A vocabulary declares the component names, property types, references, and other
constraints. Graph edges are entities too: an application can declare an `edge`
component with `from` and `to` references and add further components describing
the relationship. The core does not require an application-specific class
hierarchy for entities.

`entity.num`, when a store keeps one, is a short human-facing number, not an
identity. Do not use it in place of an eid. Numbering is [@yaks/id](../id)'s:
that package declares the property and ships the allocator behind `$num: true`,
and a graph that registers neither has no numbers at all.

`mint()` generates an eid — a v4 UUID from `crypto.getRandomValues`, so a page
served over plain HTTP generates ids too — and `minted(id)` says whether an id
was generated rather than chosen by a person.

A `$` key on a bundle is a request to the pipeline rather than a component.
`$delete`, `$was` and `$actor` are the core's own; a plugin declares its own in
`requests`, and a request no plugin answers is refused at admission rather than
ignored, so asking a graph for something it cannot do is an error you can read.

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
      component: true,
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

`apply(change)` accepts an array of bundle patches and applies it in one
transaction:

- An omitted property is unchanged.
- A property set to `null` is cleared.
- A component set to `null` is removed.
- `$delete: true` deletes the entity, subject to reference-deletion rules.
- `$was` supplies per-property hashes of the values the caller read. A mismatch
  refuses the entire change rather than overwriting a concurrent edit.

The return value is the change as applied, including whatever plugins and
reference handling added to it. It contains one composed patch per affected
entity; it is not a full snapshot of every affected entity. A deleted entity is
represented by its identity plus `tombstone: {}`.

`read(query)` returns the bundles matching the query. For example, `.book`
selects entities that have that component, and `.book.pages>400` filters on a
property. See [@yaks/query](../query/README.md) for the syntax and which parts
each adapter supports. An empty query does not mean "dump the database".

`apply(change, { check: true })` runs the write phases and rolls back instead of
committing; it returns the proposed patches, runs audit hooks, and skips
effects. `g.rows(query)` returns adapter-specific rows for aggregates and other
raw query results. `g.ddl()` returns schema statements and `g.install()`
installs the adapter schema.

Both methods work with synchronous and asynchronous adapters. Using `await` is
safe either way; a synchronous adapter can also return values directly.

## IDs and names

Use an explicit eid when the application already has an identity for the thing.
An id starting with `$` is instead a temporary alias, local to one change:

```ts
const applied = await g.apply([
  { entity: { eid: '$newBook' }, book: { title: 'A new book', pages: 100 } },
])
```

The graph assigns an eid and resolves every reference to the same alias within
that change. Reusing `$newBook` in a later change does not refer to the previous
entity. For persistent, idempotent names, compose
[@yaks/alias](../alias/README.md), which builds on
[@yaks/key](../key/README.md). `g.address(ids)` asks the installed plugins to
resolve names to eids; it does not replace ordinary reference validation.

## Plugins and transactions

A plugin registers hooks at named phases, or declarative rules that match
bundles. A hook can transform a change or refuse it by throwing. Plugins are
registered per graph instance. See `Plugin`, `Hook`, and `Rule` in the exported
API for their context and return types.

The write pipeline separates the work done before anything is written, the
writes themselves, and the observers that run after the commit. In particular:

- `normalize` can rewrite incoming data.
- Admission and preconditions validate it against the vocabulary and the current
  state before any write is accepted. Admission first casts a string property's
  value to a string, so a number written to one is stored and returned as its
  text.
- Reference handling, writing, and journaling all run inside the storage
  transaction.
- `effect` observers run after the commit. One failing cannot undo a committed
  write.
- `audit` handles refusals and dry-run rollbacks.

Use [@yaks/effects](../effects/README.md) when a committed state change should
trigger further work. Do not perform irreversible external operations in a hook
whose transaction could still roll back. An effect is not automatically
exactly-once: any operation that may be retried needs an idempotency strategy of
its own.

Declarative rules use queries to match and declare which phase they run in and
what they produce. They are useful for state transitions and derived writes;
they do not replace query-time derived properties. The vocabulary, the storage
adapter, and the registered plugins determine which features are available.

## Ownership and composition

The graph owns no persistent storage: all entity data is held by the adapter
passed to `graph({ storage, vocab })`. The root export provides `graph`, the
interfaces below, and helpers for identity, validation, rules, provenance,
tools, and transient text. `@yaks/graph/vocab` exports tool declarations as
`graphDoc` and `docs`; `@yaks/graph/tools` exports `loadTools`, `runs`, and
`tier` to attach implementations to tool declarations. These are sub-module
exports.

This package exports the `Bundle`, `Storage`/`Tx`, plugin, rule, and tool
interfaces plus the graph implementation. It does not choose a database or
install domain components for you. A tool is `run(call, graph)`: the call
entity's bundle, whose arguments `argsOf(call)` reads and whose caller
`who(call)` reads, and the graph it runs on.

- [@yaks/vocab](../vocab/README.md) loads component schemas.
- [@yaks/ram](../ram/README.md), [@yaks/sqlite](../sqlite/README.md),
  [@yaks/d1](../d1/README.md), and
  [@yaks/durable-object](../durable-object/README.md) implement storage.
- [@yaks/client](../client/README.md) provides local state and live queries.
- [@yaks/api](../api/README.md) exposes graph operations over HTTP and
  WebSocket.
- [@yaks/render](../render/README.md) selects views using queries; it does not
  own state or persistence.

Authentication and authorization belong in the application that composes these
packages. Declaring a reference or a component does not by itself grant or
restrict access.

The core imports no platform-specific APIs and can be used in browsers, workers,
and server runtimes. A given storage adapter or plugin may have narrower runtime
requirements.

Experimental live text projections are described in
[TRANSIENT.md](TRANSIENT.md).

### Structured tool identity

A `Tool` can declare `noun: 'session'` and `verb: 'list'` instead of a flat
name. `toolName(tool)` derives `session_list` from them; `namedTool(tool)`
returns a copy with that name filled in, ready for a transport to list. Either
field may be declared alone — `noun: 'history'` is the tool `history`, one word
on a command line and the same word when a client lists it. Tools that declare
only `name` continue to work. The core stores this metadata but does not parse
CLI arguments or run a command framework of its own.

`inputSchema` is a JSON Schema for the complete arguments object. The older
per-argument `input` object is still accepted for existing adapters; do not
supply both. See [`@yaks/vocab` tool declarations](../vocab/README.md#tools) for
the shared validation and the optional positional and short-flag presentation. A
tool's noun is unrelated to any graph component name.

<a id="the-generic-tiers-own-tool-declarations"></a>

### Built-in tool declarations

`@yaks/graph/vocab` contains the declarations for `graph apply`, `graph query`,
`graph show`, `graph schema`, and `search`. Their implementations live in
`@yaks/graph/tools`; [@yaks/mcp](../mcp/README.md) exposes them through its
`core` helper. `search` is included only when a ranked search function is
supplied. These declarations add no components to the graph.

## Rules over more than one entity

A rule can match several entities using ordinary query patterns separated by
`;`. Shared variables join the patterns:

```text
$call .call; .result, result.call=$call
```

`match(source)` parses the rule into a `Match` plan containing patterns,
conditions, and variable bindings. An adapter's optional `Tx.bindings` method
then evaluates the plan against stored data together with the pending patches.
For example, SQLite compiles each plan into a SQL statement and uses temporary
query sources to include the uncommitted patches; `+!comp` tests for an absent
component through a left join. `reads(plan, vocab)` lists the components that
must be included in those sources.

**These rules require `Tx.bindings`.** An adapter without it, including RAM,
skips declared rules. Use a supporting adapter such as
[@yaks/sqlite](../sqlite/README.md) when the application depends on them.

### A rule with no code at all

A plugin's `declared` list supplies rule names, match queries, and optional
`before` dependencies. Given a graph `g` whose vocabulary declares `product` and
`shelf.aisle`, register:

```ts
g.use({
  name: 'shop',
  declared: [{
    name: 'unshelved',
    match: '.product, +!shelf, +shelf.aisle=Z',
  }],
})
```

This matches a product without a shelf, then adds `shelf: { aisle: 'Z' }`. Rules
are evaluated during the `rules` phase. A `+` or `*` clause can specify a
property and value, such as `+result.call=$call`. Literal values are parsed
using the declared property type, `$name` reads a bound variable, and `#Name`
reads a registered resource.

A pattern containing only write clauses creates an entity. Its id is derived
from the rule name and matched entity ids, so repeated evaluation of the same
match identifies the same created entity.

Generated patches join the pending change and every rule is evaluated again,
allowing one rule to react to another's output. A rule may fire only once per
`(rule name, matched entities)` in one application. If it matches again, the
transaction is refused with the rule name and binding. Write the match so its
own output makes it stop matching, as `+!shelf` does above.

Declared rules run alphabetically by name, adjusted for `before` dependencies.
Registration order does not determine their order; cyclic dependencies are
rejected. Rules can also come from vocabulary documents. Declarations without a
phase, or with `phase: 'rules'`, run here; other phases need their corresponding
runner.

### A template is a rule with its variables supplied

`filled(match, args)` binds arguments into a rule query, with no separate
placeholder syntax:

```ts
import { filled } from '@yaks/graph'

filled('+foo.bar=$x', { x: 5 }) // a plan that creates foo.bar = 5
filled('$p .product, +!sale', { p: 'p1' }) // a plan restricted to product p1
```

A bound variable in a match clause constrains that property. In a write clause
it supplies the value to write. Arguments can also be a query string containing
bindings.

`invoked(tx, vocab, template, args)` evaluates the bound plan once, with no
pending patches, and returns generated bundle patches for the caller to apply.
It does not write them itself and returns an empty array if `tx.bindings` is
unavailable. Rules running in the graph's pipeline instead add their patches to
the current change: those patches receive admission checks, mutation, cascading
reference handling, stamps, and journaling alongside the caller's changes.
