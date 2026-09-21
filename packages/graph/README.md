# @yaks/graph

A component-based data model with transactional writes, queries, and plugins.
Use it to build an application whose database, local UI state, and API share the
same representation. The core has no database, network server, or UI dependency.

For an overview of the related packages and how to compose them, read
[Architecture](ARCHITECTURE.md). Each package can also be used independently
where its public interfaces allow it.

## Data model

These five terms are used throughout this package and the rest of the family.

- An **entity** is a thing with a stable id, `entity.eid`. It has no type of its
  own.
- A **component** is a named object of columns attached to an entity, such as
  `book: { title: 'Dune' }`. An entity may carry several components; adding one
  does not create a new entity or change its identity. What an entity _is_ is
  decided by which components it carries.
- A **bundle** is one entity's identity together with its components:
  `{ entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } }`.
  Bundles are what reads return and what writes are expressed in.
- A **change** is a flat array of bundles, each acting as a patch: an omitted
  column is left alone, a `null` column is cleared, a `null` component is
  removed.
- A **transaction** is what `apply(change)` runs the whole array in. Either all
  of it is written or none of it is.

A vocabulary declares the component names, column types, references, and other
constraints. Graph edges are entities too: an application can declare an `edge`
component with `from` and `to` references and add further components describing
the relationship. The core does not require an application-specific class
hierarchy for entities.

`entity.num`, when storage assigns one, is a short human-facing number, not an
identity. Do not use it in place of an eid. The fleet turns off implicit
numbering with `number: false` and registers `numbers(allocate)` instead. Code
that creates an entity asks for a number per entity, by writing
`{ entity: { eid }, $num: true, task: {} }`; the same request later assigns a
number to an entity that does not have one yet. The allocator runs inside the
graph's write transaction and must return the existing number when asked again
for the same entity. Components and display prefixes never request a number.
`$num` is request-only metadata: it is never part of what `apply()` returns.

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
  state before any write is accepted.
- Reference handling, writing, and journaling all run inside the storage
  transaction.
- `effect` observers run after the commit. One failing cannot undo a committed
  write.
- `audit` handles refused transactions.

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

This package exports the `Bundle`/`Change`, `Storage`/`Tx`, plugin, rule, and
tool interfaces plus the graph implementation. It does not choose a database or
install domain components for you.

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

### The generic tier's own tool declarations

`@yaks/graph/vocab` carries this package's `vocab.json`: the five tools every
graph provides — `graph apply`, `graph query`, `graph show`, `graph schema` and
`search` — declared the same way any other package declares its own, so one file
states what they are called, what arguments they take and what they do. The
implementations behind them are [@yaks/mcp](https://jsr.io/@yaks/mcp)'s `core`,
which joins the two and shapes the tier for one server. No component is declared
there: the tier describes a store, it does not add anything to one.

## Rules over more than one entity

A rule about more than one entity is written as several ordinary query patterns
separated by `;`, one per entity, joined by the variables they share:

```text
$call .call; .result, result.call=$call
```

`match(source)` parses that into a PLAN — the patterns, their conditions, and
where each variable's value comes from — and a storage adapter compiles the plan
into ONE statement using its own compiler (`@yaks/sqlite`'s `statement()`,
through `@yaks/sql`'s path-to-join lowering, where a `+!comp` condition becomes
a `left join … is null`). Nothing was added to the query grammar for any of
this: `$name` on its own is a clause the existing sigils already cover, and a
value whose raw text begins with `$` is read as that same variable by the
compiler, which is where `parse()` has always left the interpretation of raw
tokens.

`reads(match, vocab)` returns the components the plan touches — what storage's
overlay of the pending change has to cover for the compiled statement to see a
change that has not been written yet (`@yaks/sqlite`'s `overlay()`). That is all
"rules run before anything is persisted" means: the same statement, reading a
different source underneath.

### A rule with no code at all

A plugin can declare rules as data in its `declared` list — a name, the query,
and the names of the rules it runs `before`:

```ts
graph.use({
  name: 'shop',
  declared: [{
    name: 'unshelved',
    match: '.product, +!shelf, +shelf.aisle=Z',
  }],
})
```

The `rules` phase runs them. A `+` or `*` clause may name a column and a value
(`+result.call=$call`) — the sigil already means "this is written", so naming
the column it writes is not a second concept — and the value is parsed as that
column's own type, a `$name` as whatever the match bound it to, and a `#Name` as
the resource it refers to. A pattern in which every clause writes MATCHES
nothing: it CREATES its entity, and that entity's id is derived from the rule's
name and the entities the rule matched, so the same rule on the same match
produces the same entity, in this change or in a later one.

Whatever a rule produces joins the change, the overlay is rebuilt, and every
rule is evaluated again — so a rule can fire on what another rule just wrote.
This terminates because a rule fires AT MOST ONCE per
`(rule name, the entities it matched)`: a second firing with the same key is not
slow convergence, it is a rule whose match does not exclude its own output, and
it is refused by name and by match. That refusal is the entire termination
argument.

### A template is a rule with its variables supplied

There is no separate template type and no `{{placeholder}}` syntax — the graph
already had variables. `filled(match, args)` merges a rule's match with the
arguments, read as a query containing only bindings, and where a bound variable
sits decides what it does:

```ts
filled('+foo.bar=$x', { x: 5 }) // creates an entity with foo.bar = 5
filled('$p .product, +!sale', { p: 'p1' }) // constrains: that product, no other
```

In a match clause a bound variable CONSTRAINS (the column must equal it); in a
`+` clause it SUPPLIES (the column is written with it); in both, it does both.
That was already how variables worked — this function only does the merge.

`invoked(tx, vocab, template, args)` runs one: the same engine the `rules` phase
runs, called directly with an empty change instead of being asked about a
pending one. An empty change is also why an invocation has no entity to be about
— there is nothing for it to be about.

Nothing a rule writes is written by the rule itself. Its patches join the change
and `mutate` writes them, so a rule's output is admitted, stamped, journaled,
cascaded and returned exactly like anything a client sent.

The order rules run in is declared, not incidental: alphabetical by name, then
adjusted by `before`. Registration order never decides it, and two rules that
each claim to run before the other are refused as the cycle they are.
