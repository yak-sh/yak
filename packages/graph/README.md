# @yaks/graph

The core of the yaks family: the **entity/component** data model, the **Bundle**
wire that carries writes, and a **phased, pluggable `apply()`** that commits
them. Every other `@yaks/*` package is built on the shapes this one defines.

## Install

```sh
deno add jsr:@yaks/graph
# or: npx jsr add @yaks/graph
```

## The model

Everything is an **entity**, identified by an `eid` (client-minted) plus the
`num` storage mints on first touch. An entity carries **components**: a named
bag of columns, one per component it wears. An entity has no type of its own; it
_is_ whatever components it carries. The identity rides _inside_ the bundle,
under the `entity` key.

```ts
// a book is a `doc` plus a `book`
{ entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } }
```

## The wire

A `Bundle` is one entity plus the components to write to it — a **patch**: an
omitted column is untouched, a `null` column is cleared, and a `null` component
is dropped. A `Change` is a flat array of bundles, applied atomically.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'

let vocab = loadVocab(bookstore) // your components, as JSON Schema
let g = graph({ storage: storage(driver, vocab), vocab })
g.install()

let out = g.apply([
  { entity: { eid: 'b1' }, doc: { title: 'Dune' }, book: { pages: 412 } },
  { entity: { eid: 'b2' }, book: { pages: 500 } }, // patch one column
  { entity: { eid: 'b3' }, $delete: true }, // delete an entity
])
```

`apply()` returns the batch **as applied**, plus everything it synthesized — the
entities a delete took with it, the identities storage minted, the provenance
stamps — so a client that applies the return to its cache lands exactly where
the graph is.

Reserved keys ride beside the components. They are components in every sense
that matters (data about an entity); they just live on the wire and inside
`apply()` rather than in a table:

- `$delete: true` — delete the whole entity (it is tombstoned, and death
  spreads; a delete may also be spelled as a `tombstone` component);
- `$was` — a per-column precondition: the SHA-256 of the value you read, per
  column. If it has moved since, the whole batch is refused and the committed
  value is reported back. It is the graph's `--ff-only`.
- `$actor` — who is writing. The door that received the batch decides whether to
  trust what a client sent; `apply()` stamps what reached it.

## Aliases: let the graph name it

A bundle's `entity.eid` may be an **alias** — any id starting with `$`. Every
reference to it in the same batch means the same entity, and the graph picks the
id:

```ts
let out = g.apply([
  { entity: { eid: '$dune' }, doc: { title: 'Dune' } },
  { entity: { eid: 'r1' }, review: { stars: 5, book: '$dune' } },
])
out.find((b) => b.$alias == '$dune').entity.eid // the id it was given
```

An ordinary entity gets a fresh id. A **content-addressed** one names itself: a
plugin brings a `derive` for the component it owns — a blob by the hash of its
bytes, an edge by the sentence it states — so two writers stating the same fact
land on one entity instead of two, and no caller has to compute an id whose rule
belongs to the graph.

```ts
let blobs = {
  name: 'blobs',
  derive: { blob: (comp) => sha256(String(comp.bytes)) },
}
```

## Apply is pluggable, in fixed phases

A change flows through an ordered list of phases. The order is load-bearing — a
precondition must read before the batch writes, an effect must not fire until
the transaction commits — so a plugin registers a hook against a **named**
phase, never an arbitrary point.

| phase          | the core's own work                                  |
| -------------- | ---------------------------------------------------- |
| `normalize`    | (hooks only) — pure, before the transaction          |
| `admit`        | drop the unknown, refuse the wrong, check the values |
| `mint`         | name every `$alias`, and rewrite what points at it   |
| `precondition` | the `$was` guard — a lease check is a hook here      |
| `mutate`       | the patches go in                                    |
| `cascade`      | death spreads; casualties join the batch             |
| `stamp`        | `created` at birth, `updated` on a touch             |
| `journal`      | (hooks only) — the journal is a plugin               |
| `commit`       | the transaction returns and commits                  |
| `effect`       | (hooks only) post-commit observers, each isolated    |
| `audit`        | (hooks only) after a rollback, with the refusal      |

A hook takes the batch and returns the batch the next phase sees, which is how
one signature covers rewriting a bundle, adding one, and refusing the whole
batch (by throwing):

```ts
let shelver = {
  name: 'shelver',
  hooks: {
    normalize: (bundles) =>
      bundles.map((b) =>
        b.book ? { ...b, book: { ...b.book, shelved: true } } : b
      ),
  },
}
g.use(shelver)
```

Every registry — plugins, hooks, effects — is per graph instance, so two graphs
in one process (a page's local one and its mirror of the server's) share
nothing.

## What this package owns

- **`Bundle` / `Change`** — the universal comp-carrying wire shape.
- **`Storage` / `Tx`** — the adapter seam that owns the bytes: schema, queries
  answered as bundles, and a transaction whose `read`, `get`, `patch` and
  `remove` the phases run against. Implemented by
  [@yaks/sqlite](https://jsr.io/@yaks/sqlite), `@yaks/durable-object`, and
  `@yaks/d1`. Identity belongs to storage: `patch` mints spines and reports the
  entities it created, with their `num`.
- **`Phase` / `Plugin` / `Hook`** — the pluggable `apply()` above. A plugin also
  contributes a component vocabulary, the same way a downstream app adds its own
  domain.
- **`Tool` / `ToolCtx`** — what a plugin offers an agent, listed and called by a
  transport such as [@yaks/mcp](https://jsr.io/@yaks/mcp). The declaration lives
  here so a plugin brings its tools the way it brings its components; nothing in
  this package lists or calls one.

There is deliberately **no `snapshot()`**: reads are queries answered by a
`Storage` adapter, never a whole-graph dump.

Every seam is **async-or-sync**. A step that answers immediately is not awaited,
so `apply()` over an embedded database returns a value, and the same code over a
network-backed one returns a promise. Nothing in between has to know which.

## Compatibility

**Deno, Node, Bun, Cloudflare Workers, and the Browser.** This package imports
no platform API — no `Deno`, no `node:`, no DOM — and its only dependencies are
`@yaks/query` and `@yaks/vocab`. It type-checks against the browser libraries
alone (`deno task check:browser` in the monorepo), which is what makes it usable
as a client-side state library: a graph in the page, over an in-memory or
IndexedDB storage, running the same `apply()` the server runs.

## The family

A query string is parsed by [@yaks/query](https://jsr.io/@yaks/query); a
component vocabulary is described with [@yaks/vocab](https://jsr.io/@yaks/vocab)
and compiled to SQL by [@yaks/sql](https://jsr.io/@yaks/sql). This package ties
them to writes and plugins; domains such as `@yaks/task`, `@yaks/session`, and
`@yaks/canvas` are plugins over it.
