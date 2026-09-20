# @yaks/embedding

Derived text embeddings and similarity ranking for a SQLite-backed graph. A
scheduled sweep reads text columns, computes vectors with a caller-supplied
embedder, and stores them for query-time ranking.

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
let hits = near.rank(readBundles(sql, params)) // each with `rank.score`
```

## As a plugin

A host composes this package rather than wiring it: `./rules` raises the vector
table through the host's own connection and registers the `.near` compiler with
the store, and `./effects` watches the embedded columns and nudges the sweep
when they move. Both are built from the options the config names beside the
plugin — which is where the model, the endpoint and the key live, because none
of them is a fact about the graph:

```json
{
  "plugins": [
    "@yaks/doc",
    {
      "use": "@yaks/embedding",
      "with": {
        "embedder": {
          "via": "ollama",
          "model": "qwen3-embedding",
          "base": "https://ollama.example",
          "key": { "env": "OLLAMA_API_KEY" },
          "dim": 384
        },
        "text": ["doc.title", "doc.body"],
        "neighbours": 8,
        "floor": 0.78,
        "after": 3000
      }
    }
  ]
}
```

`embedder` is `{"via": "hash"}` (offline, deterministic — a development box and
every test), `{"via": "ollama"}` or `{"via": "openai"}`; a config that composes
this plugin and names none refuses at boot rather than answering every search
with nothing forever. `text` narrows which columns feed a vector (the default is
every stored text column the vocabulary declares); `neighbours` and `floor`
bound what `.near` selects; `after` is how long a burst of writes settles before
one sweep answers all of it. `{"env": "NAME"}` anywhere in there is read from
the environment when the config is read, so a config names a secret without
holding one.

**There is no `vocab.json` here, and there should not be.** A vector is not a
word anybody writes: it is derived from text another package's vocabulary
declares, it never rides the wire, and no patch mints one. The table is raised
in SQL by `./rules`, not by the store, for the same reason.

**A clock is not a facet.** An effects facet is a list of watches and owns no
lifecycle, so this one has no timer: what keeps the vectors true is the write
that moved the text. The sweep reconciles the whole corpus rather than the
entity that woke it, so a model change heals itself on the next write — and a
host that would rather reconcile on a schedule calls `sweep()` from a wake
([@yaks/wake](https://jsr.io/@yaks/wake)) or a cron.

**The near-duplicate hint** — "you may already have written this", answered the
moment something is created — is not a facet here. As a QUERY it already works
once the vector exists (`.near=<entity>&.order=similar&.limit=3` under a
`floor`); what the hint wants beyond that is the text embedded _before_ there is
anything to anchor on, which is an asynchronous call and so a TOOL, not a clause
— compiling a query never reaches the network. It belongs to whichever package
mints the entity and knows what a duplicate means there, built from `nearest()`
and the embedder this plugin already names; nothing here can know that a comment
is not a twin of the task it is on.

## Which text is embedded

Not one "document" component: a vocabulary declares components, some of their
columns hold prose, and `fields(vocab)` returns every text-shaped stored column
— a book's title, its blurb, a review's own paragraph. Pass a `Pick` to narrow
it.

An entity gets **one** vector, joined from every field it has, because a vector
is a point in meaning-space and an entity is one thing. (A search index is the
other way around — [@yaks/fts](https://jsr.io/@yaks/fts) keeps one index per
component. The two packages make the same choice by the same rule and then do
different things with it, and neither depends on the other.)

## The embedder is yours

```ts
type Embedder = {
  model: string // names the vector space
  embed: (text: string) => Float32Array | Promise<Float32Array>
}
```

Any local model or hosted API satisfies it. The `model` name is recorded on
every stored row, screens every search, and folds into the content hash — so
changing models invalidates the corpus, the sweep rebuilds it, and no query ever
compares two spaces.

`hashEmbedder(dim)` is the offline one shipped here: every word is hashed into a
bucket and the counts are normalized. It is deterministic, instant, and offline,
which is what tests and early development want. It captures vocabulary overlap
and nothing else — it has no sense of meaning, so swap in a model before
promising anyone semantic search. Nothing else in this package changes when you
do.

`remote({via, model, base, key?, dim?})` is the other: one POST per vector, to
Ollama's `/api/embed` or an OpenAI-compatible `/v1/embeddings`. It holds no
credential and reads no environment — the endpoint, the model and the token are
arguments, which is what lets the same code run on a server, in a Worker and
against a stubbed `fetch`. `dim` truncates a Matryoshka-trained model to a fixed
width and renormalizes, so a corpus keeps one shape without a second model. A
fault throws: the sweep decides what a dark embedder means (it stops, and the
rest stay stale), and a vector quietly invented here would be worse than none.

## The sweep

`sweep(db, fields, embedder, limit?)` reconciles; it is the only asynchronous
thing here. It drops the vectors of entities that no longer have text (deleted,
emptied, or no longer with an embedded component) and re-embeds the ones whose
text or model moved, deciding "moved" by the content hash stored beside each
vector — so an unchanged corpus costs one query and no embedder calls. It runs
on a schedule, never on the write path: embedding is slow and remote, a write is
neither.

`stale()`, `prune()` and `sources()` are the halves underneath, each usable and
testable on its own.

## How `.near` compiles

`@yaks/sql` declines `.near` on its own — the vectors are here, not there. This
package registers as an [extension](https://jsr.io/@yaks/sql/doc/~/Extension)
and answers it in three moves:

1. the anchor's stored vector is read (never the network — compiling a query is
   synchronous);
2. the ranking answers the nearest entities **among what the rest of the line
   selects**;
3. that list becomes `entity.id in (?, ?, ?)` for the `WHERE` and a
   `case … when … then` for the `ORDER BY`.

So the KNN runs where the vectors are, and what reaches SQL is a handful of
integer ids. That is why the ordering carries no bound parameter (the IR's
`ORDER BY` holds none) and why the rest of the query line still filters, counts
and pages normally.

**Nearest among what.** The ranking is cut to `neighbours`, so cutting it before
the other clauses filter answers `.near=X&.memory` as "the memories among the
eight nearest entities of any kind" — almost always none. @yaks/sql hands every
extension the question's `Screen` when it begins — a statement over the eids the
rest of the line admits — and the scan reads only those vectors. Filter, then
rank, then cut. A replacement `rank` (an ANN) is handed the same screen and has
to honour it, or every filtered line gets the wrong neighbourhood.

**Paging a neighbourhood.** `.near=X&.order=similar&.limit=5` answers the five
nearest, and `&.after=<num>` continues from that entity's own place in the
ranking — @yaks/sql asks this extension's `order` hook a second time with the
anchor's owner id, so the cursor is a rank position without ever being spelled
as one. The cursor is the ordinary `.after=<num>`: a caller pages a
neighbourhood exactly as it pages a board, and never learns that the sort key is
a similarity. An `.after` naming an entity outside the neighbourhood sorts with
the `else` arm, past every neighbour, so the page is empty rather than wrong.

The similarity comes back as a **query-only component**: `near.rank(bundles)`
returns them nearest-first, each with `rank: { score }`. Nothing stores it — a
component is a shape for carrying data about an entity, and it does not have to
be a table.

One `semantic()` value answers one question at a time: it remembers the
neighbourhood the `.near` clause resolved so the ordering can rank by it and you
can read the scores back, and it forgets when the compiler says a new question
has begun (@yaks/sql's `Begin` hook). That is what lets a host register one at
compose time and serve every query through it. `.order=similar` with no `.near`
to rank declines, loudly, as `Unsupported` — on the hundredth query as on the
first.

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

Ranking runs in TypeScript rather than a native SQLite vector extension. There
is no persisted approximate-nearest-neighbor index here. Supply a `Rank`
implementation if your application needs indexed vector search — and read the
mark to keep it true.

## The mark

An approximate index is built from the vector table and goes stale the moment a
row moves. Beside the table sits `embedding_index`, one row whose `dirty` flag
three triggers set inside the same statement as any insert, update or delete of
a vector — so a crash between a write and a rebuild leaves the mark set, and the
next owner rebuilds. `dirty(db)` reads it, `clean(db)` clears it once a rebuild
has landed, `mark(db)` sets it by hand after rebuilding the vector table from
elsewhere, and `state(db)` reports the mark beside the row count and the newest
write for a health check. A fresh install starts dirty: an index that has never
been built is owed one. The exact scan `nearest()` reads none of this.

`schema()` is idempotent and additive, so tables an application already built in
this shape are adopted as they are.

The whole table is **derived**. Drop it and the next sweep rebuilds it from the
text it was made from — which is why it has no history, no journal and no
presence on the wire, and why a graph with no embedder is a graph that simply
has no vectors rather than a broken one.

It assumes the layout `@yaks/sql`'s SQLite dialect reads and
[@yaks/sqlite](https://jsr.io/@yaks/sqlite) builds: an `entity` table of integer
ids, one table per component keyed by an `entity` owner, and a `tombstone` table
naming the dead.

## Compatibility

Deno and Node (and any runtime with a SQLite binding that can bind a blob). The
package names no SQLite library: it runs statements through a two-method
`Driver` you supply.
