# @yaks/edge

A **link** is a directed connection represented by a graph
[entity](../graph/README.md#data-model), carrying `edge: { from, to, ord? }` and
a second component naming its **relation**, the kind of connection, such as
`cites`. @yaks/edge creates links with content-derived eids, validates writes,
and follows links through storage reads and SQL queries.

The relation's **component name** is the name stored beside `edge`; its **query
name** is the name used to follow that relation in a
[query](../query/README.md#query-model). Declaring `edge: true` makes the names
identical. Declaring `edge: 'linked'` on a `links` component makes `links` the
component name and `linked` the query name. Applications declare their own
relations in their [vocabulary](../vocab/README.md#vocabulary).

A link is an ordinary [bundle](../graph/README.md#data-model). It can carry
application metadata and use the graph's write and sync interfaces. The optional
`edge.ord` property records a position; the traversal helpers do not sort by it.

## Create and remove links

Load the component declaration and keywords, then register `edges(vocab)` on the
graph. `link()` and `unlink()` take a component name.

```ts
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { edgeDoc, edgeEid, edgeKeywords, edges, link, unlink } from '@yaks/edge'

let blog = {
  $defs: {
    post: { component: true, type: 'object' },
    cites: { component: true, type: 'object', edge: true },
  },
}
let vocab = loadVocab([edgeDoc, blog], [edgeKeywords])
let g = graph({ storage: ram(vocab), vocab, plugins: [edges(vocab)] })
await g.apply([
  { entity: { eid: 'p1' }, post: {} },
  { entity: { eid: 'p2' }, post: {} },
  link('p1', 'cites', 'p2', 1),
])
let eid = edgeEid('p1', 'cites', 'p2')
equal((await g.read('.cites')).map((b) => b.entity.eid), [eid])

// Omitting ord leaves the stored position alone.
await g.apply([link('p1', 'cites', 'p2')])
equal((await g.read('.cites&?edge'))[0].edge, { from: 'p1', to: 'p2', ord: 1 })
await g.apply([unlink('p1', 'cites', 'p2')])
equal(await g.read('.cites'), [])
await g.apply([link('p1', 'cites', 'p2')])
equal((await g.read('.cites')).map((b) => b.entity.eid), [eid])

// Deleting either endpoint deletes the link entity.
await g.apply([{ entity: { eid: 'p2' }, $delete: true }])
equal(await g.read('.edge'), [])
```

`edgeEid(from, relation, to)` hashes `from|relation|to` with SHA-256 and formats
it as the graph's derived UUID. The same endpoints and component name identify
one link. Direction matters. `link()` computes this eid; `unlink()` removes only
the `edge` and relation components, leaving the entity and any application
metadata in place. Its eid can be used to create the link again.

Both endpoints are [references](../vocab/README.md#routing-and-references) with
`death: cascade`. The graph enforces reference validity and deletion;
`edges(vocab)` supplies eid derivation and validation.

## Exports

| Import             | Exports and purpose                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `@yaks/edge`       | `edgeDoc`, `EDGE`: component declaration and name; `edgeKeywords`, `EDGE_URI`: keyword registration                      |
| `@yaks/edge`       | `relations`, `names`, `reversed`: interpret relation declarations                                                        |
| `@yaks/edge`       | `link`, `unlink`, `edgeEid`: create and remove links and compute eids                                                    |
| `@yaks/edge`       | `tagOf`, `derive`: find the relation component and supply eid derivation                                                 |
| `@yaks/edge`       | `edges`, `stated`: graph plugin and validation hook                                                                      |
| `@yaks/edge`       | `walk`, `Walk`, `Dir`: storage traversal; `traverse`: SQL compiler extension                                             |
| `@yaks/edge/vocab` | `docs`, `keywords`, `description`, `edgeDoc`, `edgeKeywords`, `relations`, `names`, `reversed`: vocabulary contributions |
| `@yaks/edge/graph` | `plugins`, `extend`: graph plugins and SQL compiler extensions for composition                                           |

## Relation declarations

Register `edgeKeywords` when loading the vocabulary. `relations()` maps query
names to component names; `names()` maps component names to query names.
`reversed()` maps query names to the phrases declared by `reversed`, for a
reader displaying links arriving at an entity. Relations without a `reversed`
phrase are absent from that map.

```ts
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { edgeDoc, edgeKeywords, names, relations, reversed } from '@yaks/edge'

let vocab = loadVocab([edgeDoc, {
  $defs: {
    cites: {
      component: true,
      type: 'object',
      edge: true,
      reversed: 'cited by',
    },
    links: { component: true, type: 'object', edge: 'linked' },
  },
}], [edgeKeywords])
equal(relations(vocab), { cites: 'cites', linked: 'links' })
equal(names(vocab), { cites: 'cites', links: 'linked' })
equal(reversed(vocab), { cites: 'cited by' })
```

## Eid derivation and validation

`edges(vocab)` derives an eid for a link written using a graph
[alias](../graph/README.md#ids-and-names). It leaves an explicit eid alone. In
the graph's `mint` [phase](../graph/README.md#data-model), its `stated(vocab)`
hook refuses writes that specify an endpoint without the other endpoint or a
declared relation component. A patch specifying neither endpoint can update
`ord` without restating the link. Bundles for the same entity in a batch are
checked together.

```ts
import { equal, throws } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import {
  derive,
  edgeDoc,
  edgeEid,
  edgeKeywords,
  edges,
  names,
  tagOf,
} from '@yaks/edge'

let vocab = loadVocab([edgeDoc, {
  $defs: { cites: { component: true, type: 'object', edge: true } },
}], [edgeKeywords])
let g = graph({ storage: ram(vocab), vocab, plugins: [edges(vocab)] })
let p1 = mint()
let p2 = mint()
let bundle = {
  entity: { eid: '$link' },
  edge: { from: p1, to: p2 },
  cites: {},
}
equal(tagOf(bundle, names(vocab)), 'cites')
equal(derive(names(vocab))(bundle.edge, bundle), edgeEid(p1, 'cites', p2))
await g.apply([bundle])
equal((await g.read('.cites')).map((b) => b.entity.eid), [
  edgeEid(p1, 'cites', p2),
])
throws(() =>
  g.apply([{ entity: { eid: 'bad' }, edge: { from: p1 }, cites: {} }])
)
throws(() => g.apply([{ entity: { eid: 'bad' }, edge: { from: p1, to: p2 } }]))
```

## Following links through storage

The `walk()` helpers follow links of one relation through
[storage](../graph/README.md#data-model). `walk(storage, vocab)` returns `out`
for outgoing links, `in` for incoming links, and `reach` for links within a
required depth limit. These methods take query names and return endpoint eids.

```ts
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { edgeDoc, edgeKeywords, edges, link, walk } from '@yaks/edge'

let vocab = loadVocab([edgeDoc, {
  $defs: { links: { component: true, type: 'object', edge: 'linked' } },
}], [edgeKeywords])
let store = ram(vocab)
let g = graph({ storage: store, vocab, plugins: [edges(vocab)] })
let p1 = mint()
let p2 = mint()
let p3 = mint()
await g.apply([
  link(p1, 'links', p2),
  link(p2, 'links', p3),
])
let w = walk(store, vocab)
equal(await w.out(p1, 'linked'), [p2])
equal(await w.in(p3, 'linked'), [p2])
equal(await w.reach(p1, 'linked', 2), [p2, p3])
equal(await w.reach(p3, 'linked', 2, 'in'), [p2, p1])
```

Synchronous storage produces synchronous results; asynchronous storage produces
promises. `reach()` defaults to outgoing links and deduplicates visited eids. It
includes the start only if a path of at least one hop returns to it. Unknown
query names throw. To read link bundles instead of endpoint eids, use storage
reads such as `.edge.from=p1 .links`.

## Following links in SQL queries

Register `traverse(vocab)` as an [SQL compiler extension](../sql/README.md), or
pass it to the SQLite adapter's `extend` option. The extension compiles relation
walks and accepts the query's [edges clause](../query/README.md).

```ts
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { edgeDoc, edgeKeywords, edges, link, traverse } from '@yaks/edge'

let vocab = loadVocab([edgeDoc, {
  $defs: {
    post: { component: true, type: 'object' },
    cites: { component: true, type: 'object', edge: true },
  },
}], [edgeKeywords])
let db = open(':memory:')
try {
  let store = storage(db, vocab, { extend: [traverse(vocab)] })
  store.install()
  let g = graph({ storage: store, vocab, plugins: [edges(vocab)] })
  await g.apply([
    { entity: { eid: 'p1' }, post: {} },
    { entity: { eid: 'p2' }, post: {} },
    { entity: { eid: 'p3' }, post: {} },
    link('p1', 'cites', 'p2'),
    link('p2', 'cites', 'p3'),
  ])
  let found = async (q: string) =>
    (await store.read(q)).map((b) => b.entity.eid).sort()
  equal(await found('.cites[<=1]->p3'), ['p2'])
  equal(await found('.cites[<=2]->p3'), ['p1', 'p2'])
  equal(await found('.cites<-p1'), ['p2', 'p3'])
  equal(await found('.post&.edges[cites]'), ['p1', 'p2', 'p3'])
} finally {
  db.close()
}
```

Without a bracketed depth, SQL walks exclude the start, deduplicate eids, and
limit results to 10,000 eids (`WALK_LIMIT` in @yaks/sql). An explicit depth
bounds recursion by hops and can include the start if a cycle returns to it.
Reference-property walks remain the SQL compiler's responsibility. Undeclared
relations are refused.

`.edges[cites]` does not filter the selection or fetch link bundles. The caller
must fetch the requested links separately.

## Composition

`@yaks/edge/vocab` provides vocabulary documents and keywords without importing
storage or SQL. `@yaks/edge/graph` accepts an object with the loaded vocabulary
and supplies both the graph plugin and SQL compiler extension.

```ts
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { docs, keywords } from '@yaks/edge/vocab'
import { extend, plugins } from '@yaks/edge/graph'
import { graph, mint } from '@yaks/graph'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'

let vocab = loadVocab([...docs, {
  $defs: { cites: { component: true, type: 'object', edge: true } },
}], keywords)
let host = { vocab }
let db = open(':memory:')
try {
  let store = storage(db, vocab, { extend: extend(host) })
  store.install()
  let g = graph({ storage: store, vocab, plugins: plugins(host) })
  let p1 = mint()
  let p2 = mint()
  await g.apply([{
    entity: { eid: '$link' },
    edge: { from: p1, to: p2 },
    cites: {},
  }])
  equal((await g.read(`.cites[<=2]->${p2}`)).map((b) => b.entity.eid), [p1])
} finally {
  db.close()
}
```

The package supplies no application relations or storage adapter. SQL traversal
assumes the SQLite layout used by [@yaks/sqlite](../sqlite/README.md). The core
uses no platform-specific APIs and can run in Deno, Node and browsers.
