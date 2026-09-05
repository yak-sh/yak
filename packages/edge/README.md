# @yaks/edge

**Links between entities**, as a component: a post that cites a post, a book
that cites a book, a page that links to a page.

## Install

```sh
deno add jsr:@yaks/edge
# or: npx jsr add @yaks/edge
```

## A link is an entity

Not a column, not a join table: an **entity of its own**, carrying
`edge{from, to, ord}` and a **relation tag** saying what kind of link it is.

```
{ entity: { eid: '…' }, edge: { from: 'p1', to: 'p2' }, cites: {} }
                                                        ^^^^^ the relation
```

That buys three things a foreign key does not. A link can be stated about
_anything_, because neither end is a typed column on some particular table. A
link can carry its own facts — an order, a date, a note — by wearing another
component. And a link is patched, deleted and synced by exactly the machinery
every other entity already uses.

## The `relation` keyword

Which relations exist is **yours**, not this package's. A relation is an
ordinary component that declares itself one:

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

And half a sentence is refused at the door, by name:

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
synchronous storage. The depth is required: a walk with no cap is a graph scan
wearing a friendly name.

## In a query line

Register the [@yaks/sql](https://jsr.io/@yaks/sql) extension and two clauses
that package declines on its own start compiling:

```ts
import { traverse } from '@yaks/edge'

compile(parse('.reaches[cites,<=3]=p1'), vocab, { extend: [traverse(vocab)] })
```

- `.reaches[cites,<=3]=p1` — the entities that reach `p1` through at most three
  `cites` links. It compiles to a recursive CTE walked backward from the target,
  so every step is an index seek; the cap is the recursion's own guard, so a
  cycle terminates by arithmetic.
- `.edges[cites]!` — a **rider**: it does not change which entities the query
  selects, it asks for their links to be carried back beside them. It compiles
  to a condition that filters nothing, and `walk` is the delivery.

A relation the vocabulary does not declare is refused rather than answered — a
clause naming nothing is a typo, not a query that matches everything.

## The surface

| export                       | is                                               |
| ---------------------------- | ------------------------------------------------ |
| `edgeKeywords`, `EDGE_URI`   | the `relation` keyword vocabulary, to register   |
| `edgeDoc`, `EDGE`            | the `edge` component, to load beside your own    |
| `relations(v)`, `names(v)`   | the declared relations, each way round           |
| `link`, `unlink`             | the bundle that states a link, and takes it back |
| `edgeEid`, `derive`, `tagOf` | the id a sentence names                          |
| `edges(v)`                   | the @yaks/graph plugin (component, id, refusal)  |
| `stated(v)`                  | the refusal on its own                           |
| `walk(storage, v)`           | `out`, `in`, and a bounded `reach`               |
| `traverse(v)`                | the @yaks/sql extension for `.reaches`/`.edges`  |

## Where it sits

A component domain over [@yaks/graph](https://jsr.io/@yaks/graph), the same
shape an application's own plugin has. It reads its declarations through
[@yaks/vocab](https://jsr.io/@yaks/vocab)'s keyword seam, the way
[@yaks/id](https://jsr.io/@yaks/id) and
[@yaks/names](https://jsr.io/@yaks/names) do, and teaches
[@yaks/sql](https://jsr.io/@yaks/sql) two clauses through the same extension
seam [@yaks/fts](https://jsr.io/@yaks/fts) uses for search.

## Compatibility

Pure TypeScript, no platform API — the traversal goes through @yaks/graph's
`Storage` seam and the SQL through @yaks/sql's IR. Runs on **Deno**, **Node**,
and in the **browser**.
