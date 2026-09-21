# @yaks/edge

Relations stored as entities. Each link is its own entity carrying an `edge`
component with its two endpoints and an optional sort order, plus a second
component naming the relation — `cites`, `requires`, and so on. Because a link
is an entity, it can carry further components and is written, deleted and
synchronized through the same graph API as anything else.

For bundle structure, write phases, and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/edge
# or: npx jsr add @yaks/edge
```

## A link is an entity

A link is a separate entity with an `edge` component and a relation component:

```ts
{ entity: { eid: "link-1" }, edge: { from: "p1", to: "p2" }, cites: {} }
```

The endpoints are entity references. Add other components to record metadata
such as a date or a note. Link entities are patched, deleted, and synchronized
through the graph API.

## The `relation` keyword

Applications declare relations as components carrying the `relation` keyword:

```json
{
  "$vocabulary": {
    "https://yaks.sh/vocab/core": true,
    "https://yaks.sh/vocab/edge": true
  },
  "$defs": {
    "post": { "type": "object", "kind": true },
    "cites": { "type": "object", "relation": true },
    "links": { "type": "object", "relation": "linked" }
  }
}
```

`true` means the relation is named after the component itself; a string gives it
a different name in queries, for a vocabulary that stores `links` but is queried
as `linked`. Register this keyword vocabulary when you load your schema. The set
of relations is open: adding one is a new component in your own vocabulary, not
a change to this package.

## Creating a link

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { edgeDoc, edgeKeywords, edges, link, unlink } from '@yaks/edge'

let vocab = loadVocab([edgeDoc, blog], [edgeKeywords])
let g = graph({ storage, vocab, plugins: [edges(vocab)] })

g.apply([link('p1', 'cites', 'p2')])
g.apply([unlink('p1', 'cites', 'p2')])
```

A link's entity id is derived from the link itself: it is a hash of
`from | relation | to`. Two writers who create the same link therefore land on
one entity rather than two, and removing a link needs no lookup — `unlink`
derives the same id. Direction is part of that id, so `a cites b` and
`b cites a` are two different links.

Both endpoints are references declared `death: cascade`, which is the whole of a
link's lifecycle: the link exists only while both of its endpoints do. Delete a
post and its links are deleted with it — there is no orphan sweep to run, and a
reader never finds a link with one end missing.

An edge component with no relation component beside it is rejected:

```
Refused: edge d91e2b12-… states no relation — an edge wears a relation tag
         beside edge{from, to} (this vocabulary knows cites, linked)
```

## Following links

```ts
import { walk } from '@yaks/edge'

let w = walk(storage, vocab)
w.out('p2', 'cites') // ['p1'] — what p2 cites
w.in('p1', 'cites') // ['p2'] — who cites p1
w.reach('p1', 'cites', 3, 'in') // everything citing it within three hops
```

Each of these is a storage query rather than a separate mechanism, and each
returns synchronously when the storage is synchronous. The depth argument is
required, so that traversal is always bounded.

## In a query

Register the [@yaks/sql](https://jsr.io/@yaks/sql) extension this package
exports and two query clauses that @yaks/sql cannot compile on its own start
working:

```ts
import { traverse } from '@yaks/edge'

compile(parse('.cites[<=3]->p1'), vocab, { extend: [traverse(vocab)] })
```

- `.cites[<=3]->p1` — the entities that reach `p1` through at most three `cites`
  links; `.cites<-p1` is what `p1` reaches; with no bracket the limit is 16
  hops. @yaks/sql owns the recursive CTE (`walkSql`) — seeded at the target, one
  index seek per step, with the hop limit as the recursion's own guard so a
  cycle terminates arithmetically. This extension supplies only the step: the
  edge table narrowed to rows carrying the component the relation name refers
  to. A path that names no relation is left to @yaks/sql, which walks it as a
  reference column instead (`.fork.from->S-7`).
- `.edges[cites]!` — this does not change which entities the query selects; it
  asks for each selected entity's links to be returned alongside it. It compiles
  to a condition that filters nothing, and `walk` fetches the links.

A relation the vocabulary does not declare is rejected rather than answered — a
clause naming nothing is a typo, not a query that matches everything.

## Exports

| export                       | is                                                          |
| ---------------------------- | ----------------------------------------------------------- |
| `edgeKeywords`, `EDGE_URI`   | the `relation` keyword vocabulary, to register              |
| `edgeDoc`, `EDGE`            | the `edge` component, to load beside your own               |
| `relations(v)`, `names(v)`   | the declared relations, each way round                      |
| `link`, `unlink`             | the bundle that creates a link, and the one that removes it |
| `edgeEid`, `derive`, `tagOf` | the id derived from a link's endpoints and relation         |
| `edges(v)`                   | the @yaks/graph plugin (component, id, rejection)           |
| `stated(v)`                  | the rejection hook on its own                               |
| `walk(storage, v)`           | `out`, `in`, and a bounded `reach`                          |
| `traverse(v)`                | the @yaks/sql extension for the walk and `.edges`           |

## Composition

A component package over [@yaks/graph](https://jsr.io/@yaks/graph), built the
same way an application's own plugin is. It reads its declarations through
[@yaks/vocab](https://jsr.io/@yaks/vocab)'s keyword extension API, as
[@yaks/id](https://jsr.io/@yaks/id) and
[@yaks/names](https://jsr.io/@yaks/names) do, and adds two clauses to
[@yaks/sql](https://jsr.io/@yaks/sql) through the same extension API
[@yaks/fts](https://jsr.io/@yaks/fts) uses for search.

## Compatibility

Pure TypeScript, no platform API — traversal goes through @yaks/graph's
`Storage` interface and the SQL through @yaks/sql's IR. Runs on **Deno**,
**Node**, and in the **browser**.
