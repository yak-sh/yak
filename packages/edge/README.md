# @yaks/edge

Stores typed, directed links between graph entities. Each link is a separate
entity with an `edge` component containing its endpoints and optional sort
order, plus a component naming the relation, such as `cites`. Link entities can
also carry application metadata and use the ordinary graph write and sync APIs.

A **bundle** is one entity's components as a JSON object. A **batch** is a list
of changes applied in one transaction. See the
[graph architecture](../graph/ARCHITECTURE.md) for the write phases and storage
interface.

## Install

```sh
deno add jsr:@yaks/edge
# or: npx jsr add @yaks/edge
```

## A link is an entity

This bundle records that `p1` cites `p2`:

```json
{
  "entity": { "eid": "link-1" },
  "edge": { "from": "p1", "to": "p2" },
  "cites": {}
}
```

The package uses the graph's existing storage adapter. With SQLite, `edge` and
`cites` have ordinary component tables; there is no separate relationship store.
The `edge.ord` number can record a position, but the traversal helpers do not
sort by it.

## The `edge` keyword

Declare each relation in your application's vocabulary and register
`edgeKeywords` when loading it:

```ts
let blog = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      properties: { num: { type: 'number', stamped: true } },
    },
    post: {
      component: true,
      type: 'object',
      kind: true,
      properties: { title: { type: 'string' } },
    },
    cites: {
      component: true,
      type: 'object',
      edge: true,
      reversed: 'cited by',
    },
    links: { component: true, type: 'object', edge: 'linked' },
  },
}
```

`edge: true` uses the component name in queries. A string gives it a different
query name: `links` is stored as a component but queried as `linked`. `link()`
and `unlink()` take the **component name**; `walk()` takes the **query name**.
`reversed` says how a relation reads from its far end, so a page drawing the
posts that cite this one can say `cited by`. The package declares no application
relations of its own.

## Creating a link

With the `post` component and `cites` relation that `blog` above declares:

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { edgeDoc, edgeKeywords, edges, link, unlink } from '@yaks/edge'

let blog = {
  $defs: {
    post: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
    cites: { component: true, type: 'object', edge: true },
  },
}
let vocab = loadVocab([edgeDoc, blog], [edgeKeywords])
let store = ram(vocab)
let g = graph({ storage: store, vocab, plugins: [edges(vocab)] })

g.apply([
  { entity: { eid: 'p1' }, post: { title: 'First post' } },
  { entity: { eid: 'p2' }, post: { title: 'Second post' } },
  link('p1', 'cites', 'p2'),
])

// Removed, and made again:
g.apply([unlink('p1', 'cites', 'p2')])
g.apply([link('p1', 'cites', 'p2')])
```

`edgeEid(from, relation, to)` hashes `from|relation|to` with SHA-256 and formats
it as the graph's derived UUID. Repeated calls identify the same link. Direction
matters: `p1 cites p2` and `p2 cites p1` have different IDs. `link()` computes
this ID; the plugin also derives it for writes using `$alias`. An explicit
entity ID is not rewritten into a derived ID.

`link(from, relation, to, ord?)` sets `ord` when supplied and leaves an existing
order unchanged when omitted. `unlink()` removes the `edge` and relation
components, leaving the entity and any other components in place; `link()` fills
it in again.

Both endpoints declare `death: cascade`: deleting either endpoint through the
graph deletes the link entity. The plugin rejects an edge without endpoints or a
declared relation component. The graph enforces reference validity.

## Following links

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { edgeDoc, edgeKeywords, edges, link, walk } from '@yaks/edge'

let blog = {
  $defs: {
    post: { component: true, type: 'object' },
    cites: { component: true, type: 'object', edge: true },
  },
}
let vocab = loadVocab([edgeDoc, blog], [edgeKeywords])
let store = ram(vocab)
let g = graph({ storage: store, vocab, plugins: [edges(vocab)] })
g.apply([
  { entity: { eid: 'p1' }, post: {} },
  { entity: { eid: 'p2' }, post: {} },
  link('p1', 'cites', 'p2'),
])

let w = walk(store, vocab)
await w.out('p1', 'cites') // ['p2']
await w.in('p2', 'cites') // ['p1']
await w.reach('p2', 'cites', 3, 'in') // ['p1']
```

These helpers issue ordinary storage reads and return endpoint IDs. Synchronous
storage produces synchronous results; asynchronous storage produces promises.
`reach()` requires a depth limit, defaults to outgoing traversal, and
deduplicates visited IDs. It includes the start only if a path of at least one
hop returns to it. Unknown relation names throw.

## In a query

For SQL storage, register `traverse(vocab)` as a compiler extension:

```ts
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { compile } from '@yaks/sql'
import { edgeDoc, edgeKeywords, traverse } from '@yaks/edge'

let blog = {
  $defs: { cites: { component: true, type: 'object', edge: true } },
}
let vocab = loadVocab([edgeDoc, blog], [edgeKeywords])
let statement = compile(parse('.cites[<=3]->p2'), vocab, {
  extend: [traverse(vocab)],
})
```

- `.cites[<=3]->p2` selects entities that reach `p2` through at most three
  `cites` links. `.cites<-p1` selects entities reachable from `p1`. Without a
  bracketed depth, traversal has no hop limit: the recursive CTE deduplicates
  entity IDs, excludes the starting entity, and limits the result to 10,000 IDs
  (`WALK_LIMIT`). An explicit depth bounds recursion by hops and can include the
  start when a cycle returns to it.
- `.edges[cites]` requests links alongside selected entities. The extension
  accepts this clause without filtering the selection; fetching those links is
  the caller's responsibility. It does not itself add links to returned rows.
- A reference-property traversal such as `.fork.from->S-7` remains the SQL
  compiler's responsibility. An undeclared relation is rejected.

Pass the same extension to the SQLite adapter's `extend` option to enable these
clauses on its reads.

## Exports

| Export                             | Purpose                                                       |
| ---------------------------------- | ------------------------------------------------------------- |
| `edgeKeywords`, `EDGE_URI`         | Register the `edge` and `reversed` keywords                   |
| `edgeDoc`, `EDGE`                  | Component declaration and component name                      |
| `relations(vocab)`, `names(vocab)` | Relation-to-component and component-to-relation maps          |
| `reversed(vocab)`                  | Relation-to-phrase map: how each reads from its far end       |
| `link`, `unlink`, `edgeEid`        | Create/remove link bundles and compute their IDs              |
| `tagOf`, `derive`                  | Find a bundle's relation component and build an ID derivation |
| `edges(vocab)`, `stated(vocab)`    | Graph plugin and its validation hook                          |
| `walk`, `traverse`                 | Storage traversal and SQL extension                           |

`@yaks/edge/vocab` exports `docs` and `keywords` for plugin loading, plus
`edgeDoc`, `edgeKeywords`, `relations`, `names` and `reversed`, for a browser
that reads the vocabulary without loading storage. `@yaks/edge/rules` exports
`rules(host)` and `extend(host)`, where the **host** is the process that opened
the graph; its vocabulary is used to create `edges(vocab)` and
`traverse(vocab)`, so a host that composes this package compiles both clauses
above.

## Composition

The package uses `@yaks/vocab` keyword extensions, `@yaks/graph` plugins and
`@yaks/sql` compiler extensions. Applications declare their relations and choose
the storage adapter.

## Compatibility

The core has no platform-specific APIs and can run in Deno, Node and browsers.
SQL traversal requires a compatible SQL storage adapter.
