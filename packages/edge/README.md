# @yaks/edge

Relations represented as entities. Each link has an `edge` component containing
its endpoints and optional order, plus a relation component such as `cites`.
Links can have additional components and use the same write, deletion, and sync
APIs as other entities.

For bundle structure, write phases, and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/edge
# or: npx jsr add @yaks/edge
```

## A link is an entity

A link is a separate entity with an `edge` component and a relation tag:

```ts
{ entity: { eid: "link-1" }, edge: { from: "p1", to: "p2" }, cites: {} }
```

The endpoints are entity references. Add other components to record metadata
such as a date or note. Link entities are patched, deleted, and synchronized
through the graph API.

## The `relation` keyword

Applications declare relations as components with the `relation` keyword:

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

`true` names the relation after the component; a string names its reading, for a
vocabulary that writes `links` and reads `linked`. Register the keyword
vocabulary when you load the schema and the set is open — adding a relation is
one component, not a change here.

## Stating a link

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { edgeDoc, edgeKeywords, edges, link, unlink } from '@yaks/edge'

let vocab = loadVocab([edgeDoc, blog], [edgeKeywords])
let g = graph({ storage, vocab, plugins: [edges(vocab)] })

g.apply([link('p1', 'cites', 'p2')])
g.apply([unlink('p1', 'cites', 'p2')])
```

An edge is **named by the sentence it states**: its id is a hash of
`from | relation | to`. Two writers who state the same link land on one entity
rather than two, and taking a link back needs no lookup — `unlink` derives the
same id. Direction is part of the sentence, so `a cites b` and `b cites a` are
two links.

Both ends are references with `death: cascade`, which is the whole lifecycle: a
link exists only while both of its ends do. Delete a post and its links go with
it — there is no orphan sweep to run and no half-sentence for a reader to meet.

An edge without a relation tag is rejected:

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

Each is a query, not a new mechanism, and each answers synchronously over a
synchronous storage. The depth is required to bound traversal work.

## In a query line

Register the [@yaks/sql](https://jsr.io/@yaks/sql) extension and two clauses
that package cannot answer on its own start compiling:

```ts
import { traverse } from '@yaks/edge'

compile(parse('.cites[<=3]->p1'), vocab, { extend: [traverse(vocab)] })
```

- `.cites[<=3]->p1` — the entities that reach `p1` through at most three `cites`
  links; `.cites<-p1` is what `p1` reaches; with no bracket the cap is 16.
  @yaks/sql owns the recursive CTE (`walkSql`) — seeded at the target, one index
  seek per step, the cap the recursion's own guard so a cycle terminates by
  arithmetic — and this extension supplies the STEP: the edge table narrowed to
  the tag the relation name declares. A path that names no relation is left to
  @yaks/sql, which walks it as a reference column (`.fork.from->S-7`).
- `.edges[cites]!` — a **rider**: it does not change which entities the query
  selects, it asks for their links to be carried back beside them. It compiles
  to a condition that filters nothing, and `walk` is the delivery.

A relation the vocabulary does not declare is refused rather than answered — a
clause naming nothing is a typo, not a query that matches everything.

## Exports

| export                       | is                                                |
| ---------------------------- | ------------------------------------------------- |
| `edgeKeywords`, `EDGE_URI`   | the `relation` keyword vocabulary, to register    |
| `edgeDoc`, `EDGE`            | the `edge` component, to load beside your own     |
| `relations(v)`, `names(v)`   | the declared relations, each way round            |
| `link`, `unlink`             | the bundle that states a link, and takes it back  |
| `edgeEid`, `derive`, `tagOf` | the id a sentence names                           |
| `edges(v)`                   | the @yaks/graph plugin (component, id, refusal)   |
| `stated(v)`                  | the refusal on its own                            |
| `walk(storage, v)`           | `out`, `in`, and a bounded `reach`                |
| `traverse(v)`                | the @yaks/sql extension for the walk and `.edges` |

## Composition

A component domain over [@yaks/graph](https://jsr.io/@yaks/graph), the same
shape an application's own plugin has. It reads its declarations through
[@yaks/vocab](https://jsr.io/@yaks/vocab)'s keyword extension API, the way
[@yaks/id](https://jsr.io/@yaks/id) and
[@yaks/names](https://jsr.io/@yaks/names) do, and teaches
[@yaks/sql](https://jsr.io/@yaks/sql) two clauses through the same extension
extension API [@yaks/fts](https://jsr.io/@yaks/fts) uses for search.

## Compatibility

Pure TypeScript, no platform API — the traversal goes through @yaks/graph's
`Storage` interface and the SQL through @yaks/sql's IR. Runs on **Deno**,
**Node**, and in the **browser**.
