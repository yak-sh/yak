# @yaks/embedding

Semantic search for a [@yaks/graph](https://jsr.io/@yaks/graph): the entities
nearest in **meaning**, beside the literal matches full-text gives.

Search finds the word you typed. This finds the book you meant. A vector is
stored for every entity that has text, and `.near=<entity>` ranks the graph by
how close each one is to that entity's vector — which is how "more like this",
"related reading", and "you may already have written this" turn out to be one
query.

## Install

```sh
deno add jsr:@yaks/embedding
# or: npx jsr add @yaks/embedding
```

## Use

```ts
import { fields, hashEmbedder, schema, semantic, sweep } from '@yaks/embedding'
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'

// which text feeds a vector — every text property the vocabulary declares
let text = fields(shop)
for (let stmt of schema()) db.exec(stmt)

// keep the vectors true to the prose; run it on a schedule, not on writes
let embedder = hashEmbedder() // swap in a model when you have one
await sweep(db, text, embedder)

// the books most like this one, still under the rest of the line's filters
let near = semantic(db, embedder)
let { sql, params } = compile(
  parse('.near=book-1&.order=similar .price<20'),
  shop,
  { extend: [near] },
)
let hits = near.rank(readBundles(sql, params)) // each wearing `rank.score`
```

## Which text is embedded

Not one "document" component: a vocabulary declares components, some of their
columns hold prose, and `fields(vocab)` returns every text-shaped stored column
— a book's title, its blurb, a review's own paragraph. Pass a `Pick` to narrow
it.

An entity gets **one** vector, joined from every field it wears, because a
vector is a point in meaning-space and an entity is one thing. (A search index
is the other way around — [@yaks/fts](https://jsr.io/@yaks/fts) keeps one index
per component. The two packages make the same choice by the same rule and then
do different things with it, and neither depends on the other.)

## The embedder is yours

```ts
type Embedder = {
  model: string // names the vector space
  embed: (text: string) => Float32Array | Promise<Float32Array>
}
```

Any local model or hosted API satisfies it. The `model` name rides every stored
row, screens every search, and folds into the content hash — so changing models
invalidates the corpus, the sweep rebuilds it, and no query ever compares two
spaces.

`hashEmbedder(dim)` is the one embedder shipped here: every word is hashed into
a bucket and the counts are normalized. It is deterministic, instant, and
offline, which is what tests and early development want. It captures vocabulary
overlap and nothing else — it has no sense of meaning, so swap in a model before
promising anyone semantic search. Nothing else in this package changes when you
do.

## The sweep

`sweep(db, fields, embedder, limit?)` reconciles; it is the only asynchronous
thing here. It drops the vectors of entities that no longer have text (deleted,
emptied, or no longer wearing an embedded component) and re-embeds the ones
whose text or model moved, deciding "moved" by the content hash stored beside
each vector — so an unchanged corpus costs one query and no embedder calls. It
runs on a schedule, never on the write path: embedding is slow and remote, a
write is neither.

`stale()`, `prune()` and `sources()` are the halves underneath, each usable and
testable on its own.

## How `.near` compiles

`@yaks/sql` declines `.near` on its own — the vectors are here, not there. This
package registers as an [extension](https://jsr.io/@yaks/sql/doc/~/Extension)
and answers it in three moves:

1. the anchor's stored vector is read (never the network — compiling a query is
   synchronous);
2. the ranking answers the nearest entities;
3. that list becomes `entity.id in (?, ?, ?)` for the `WHERE` and a
   `case … when … then` for the `ORDER BY`.

So the KNN runs where the vectors are, and what reaches SQL is a handful of
integer ids. That is why the ordering carries no bound parameter (the IR's
`ORDER BY` holds none) and why the rest of the query line still filters, counts
and pages normally.

**Paging a neighbourhood.** `.near=X&.order=similar&.limit=5` answers the five
nearest, and `&.after=<num>` continues from that entity's own place in the
ranking — @yaks/sql asks this extension's `order` hook a second time with the
anchor's owner id, so the cursor is a rank position without ever being spelled
as one. The cursor is the ordinary `.after=<num>`: a caller pages a
neighbourhood exactly as it pages a board, and never learns that the sort key is
a similarity. An `.after` naming an entity outside the neighbourhood sorts with
the `else` arm, past every neighbour, so the page is empty rather than wrong.

The similarity comes back as a **query-only component**: `near.rank(bundles)`
returns them nearest-first, each wearing `rank: { score }`. Nothing stores it —
a component is a shape for carrying data about an entity, and it does not have
to be a table.

One `semantic()` value serves one query: it remembers the neighbourhood the
`.near` clause resolved so the ordering can rank by it and you can read the
scores back. Build a fresh one per query rather than sharing it.
`.order=similar` with no `.near` to rank declines, loudly, as `Unsupported`.

## The ranking

`nearest()` is an exact cosine scan: every stored vector in the model's space is
read, scored, and sorted. Exact means no recall to tune and no index to keep
true, and at a few tens of thousands of vectors it costs a few milliseconds. A
larger corpus wants an approximate index, and this is the one function to
replace — `Rank` is its shape and `semantic(db, embedder, { rank })` takes one,
so an ANN swaps in without touching anything else.

Graves are screened at read time as well as pruned by the sweep, so an entity
deleted between two sweeps stops being a neighbour immediately.

## Storage

One table, the plainest thing that works:

```sql
create table embedding (
  entity integer primary key references entity(id),
  model  text not null,
  hash   text not null,
  vec    blob not null,
  at     text not null
)
```

The entity's own integer id is the key, so a vector joins to the graph the way
every component table does; the blob is the vector's raw bytes, so its dimension
is the byte length over four and no column has to carry it.

This is the same layout the fleet's own application arrived at, and it serves
unchanged — with one thing deliberately absent. That deployment also carries a
persisted ANN index maintained by a native SQLite vector extension, which puts
the KNN in SQL and makes the write that maintains it a second writer to reason
about. This package holds the ranking in TypeScript instead: nothing native, no
shadow tables, no per-connection extension state, and a `Rank` seam for anyone
who needs the indexed version back.

The whole table is **derived**. Drop it and the next sweep rebuilds it from the
text it was made from — which is why it has no history, no journal and no
presence on the wire, and why a graph with no embedder is a graph that simply
has no vectors rather than a broken one.

It assumes the layout `@yaks/sql`'s SQLite dialect reads and
[@yaks/sqlite](https://jsr.io/@yaks/sqlite) builds: an `entity` spine of integer
ids, one table per component keyed by an `entity` owner, and a `tombstone` table
naming the dead.

## Compatibility

Deno and Node (and any runtime with a SQLite binding that can bind a blob). The
package names no SQLite library: it runs statements through a two-method
`Driver` you supply.
