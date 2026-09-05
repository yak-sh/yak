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

Everything is an **entity**, identified by an `eid` (client-minted) plus a
server-minted `num`. An entity carries **components**: a named bag of columns,
one per component it wears. An entity has no type of its own; it _is_ whatever
components it carries. The identity rides _inside_ the bundle, under the
`entity` key.

```ts
// a blog post is a `doc` plus a `post`
{ entity: { eid: 'p1' }, doc: { title: 'Hello' }, post: { published: true } }
```

## The wire

A `Bundle` is one entity plus the components to write to it — a **patch**: an
omitted column is untouched, a `null` column is cleared, and a `null` component
is dropped. A `Change` is a flat array of bundles, applied atomically.

```ts
import type { Bundle, Change } from '@yaks/graph'

let change: Change = [
  { entity: { eid: 'p1' }, post: { published: false } }, // patch one column
  { entity: { eid: 'p2' }, $delete: true }, // delete an entity
]
```

Deletes and preconditions ride as **sugar** on the bundle: `$delete: true`
removes the whole entity (it is tombstoned; a delete may also be spelled as a
`tombstone` component), and `$was` carries a per-column precondition that must
still hold for the change to apply.

## What this package owns

- **`Bundle` / `Change`** — the universal comp-carrying wire shape.
- **`Storage`** — the adapter seam that owns the bytes: turn a vocabulary into
  schema, answer a query as bundles, patch a change into rows. Implemented by
  [@yaks/sqlite](https://jsr.io/@yaks/sqlite), `@yaks/durable-object`, and
  `@yaks/d1`. It is async-or-sync, so one seam serves an embedded database and a
  remote one alike.
- **`Phase` / `Plugin`** — the pluggable `apply()`: a change flows through
  fixed, ordered phases (normalize → admit → precondition → mutate → cascade →
  journal → commit → effect → audit), and a plugin registers hooks against a
  _named_ phase. A plugin also contributes a component vocabulary, the same way
  a downstream app adds its own domain.

There is deliberately **no `snapshot()`**: reads are queries answered by a
`Storage` adapter, never a whole-graph dump.

## The family

A query string is parsed by [@yaks/query](https://jsr.io/@yaks/query); a
component vocabulary is described with [@yaks/vocab](https://jsr.io/@yaks/vocab)
and compiled to SQL by [@yaks/sql](https://jsr.io/@yaks/sql). This package ties
them to writes and plugins; domains such as `@yaks/task`, `@yaks/session`, and
`@yaks/canvas` are plugins over it.
