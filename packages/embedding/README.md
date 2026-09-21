# @yaks/embedding

Text embeddings and similarity ranking for a SQLite-backed graph. A background
job reads text columns, turns them into vectors with an embedder you supply, and
stores them so a query can rank by similarity.

Throughout this README, "the server" means whichever process opened the graph
and loaded this package — usually a long-running `yak serve`, sometimes just the
CLI.

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

// which text a vector is made from — every text property the vocabulary declares
let text = fields(shop)
for (let stmt of schema()) db.exec(stmt)

// keep the vectors in step with the text; run this on a schedule, not on writes
let embedder = hashEmbedder() // swap in a model when you have one
await sweep(db, text, embedder)

// the books most like this one, still under the rest of the query's filters
let near = semantic(db, embedder)
let { sql, params } = compile(
  parse('.near=book-1&.order=similar .price<20'),
  shop,
  { extend: [near] },
)
let hits = near.rank(readBundles(sql, params)) // each with a `rank.score`
```

## As a plugin

A server composes this package rather than wiring it up by hand.
`@yaks/embedding/rules` creates the vector table through the server's own
database connection and registers the `.near` compiler with the store, and
`@yaks/embedding/effects` exports the watches that schedule a sweep when
embedded text changes. Both are built from the options named beside the plugin
in the config — which is where the model, the endpoint and the key live, because
none of them is a fact about the graph:

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

`embedder` is `{"via": "hash"}` (offline and deterministic — for a development
machine and for every test), `{"via": "ollama"}` or `{"via": "openai"}`. `text`
narrows which columns a vector is made from (the default is every stored text
column the vocabulary declares); `neighbours` and `floor` bound what `.near`
selects; `after` is how long a burst of writes has to settle before one sweep
covers all of it. A `{"env": "NAME"}` anywhere in there is read from the
environment each time it is needed, so a config names a secret without holding
one — and a key exported after the server started is picked up on the next pass.

**Missing config never prevents startup.** A server that composes this plugin
with no embedder named, or with a key the environment does not have yet, starts
normally: it stores no vectors, the `vector_check` tool reports what it is
waiting for, and the first pass after the config appears is the one that embeds.
Nothing is restarted. A `via` this package does not implement is still an error
— waiting will never turn it into an embedder — but it is reported where it is
read rather than taking the server down with it.

**There is no `vocab.json` component here, and there should not be.** No client
ever writes a vector: it is derived from text another package's vocabulary
declares, it is never sent to a client, and no patch creates one. The table is
created in SQL by `@yaks/embedding/rules`, not by the store, for the same
reason.

**There is no timer in the effects.** The `effects` export is a list of watches
and owns no lifecycle, so nothing here runs on a clock: what keeps the vectors
in step is the write that changed the text. A sweep reconciles the whole corpus
rather than the one entity that triggered it, so changing the model repairs
itself on the next write — and a server that would rather reconcile on a
schedule calls `sweep()` from a wake ([@yaks/wake](https://jsr.io/@yaks/wake))
or from cron.

**The near-duplicate hint** — "you may already have written this", answered the
moment something is created — is deliberately not implemented here. As a QUERY
it already works once the vector exists
(`.near=<entity>&.order=similar&.limit=3` under a `floor`); what the hint needs
beyond that is the new text embedded _before_ there is anything to compare it
against, which is an asynchronous call and therefore a tool, not a query clause
— compiling a query never calls the network. It belongs to whichever package
creates the entity and knows what counts as a duplicate there, built from
`nearest()` and the embedder this plugin already names; nothing here can know
that a comment is not a duplicate of the task it is on.

## Which text is embedded

There is no single "document" component. A vocabulary declares components, some
of their columns hold prose, and `fields(vocab)` returns every stored text
column — a book's title, its blurb, a review's own paragraph. Pass a `Pick` to
narrow that.

An entity gets **one** vector, made from all of its text fields joined together,
because a vector is a point in a space of meanings and an entity is one thing.
(A search index is the other way around — [@yaks/fts](https://jsr.io/@yaks/fts)
keeps one index per component. The two packages read the vocabulary the same way
and then do different things with it, and neither depends on the other.)

## The embedder is yours

```ts
type Embedder = {
  model: string // names the vector space
  embed: (text: string) => Float32Array | Promise<Float32Array>
}
```

Any local model or hosted API satisfies it. The `model` name is stored on every
row, filters every search, and is part of the content hash — so changing models
invalidates the whole corpus, the sweep rebuilds it, and no query ever compares
vectors from two different spaces.

`hashEmbedder(dim)` is the offline embedder shipped here: every word is hashed
into a bucket and the counts are normalized. It is deterministic, instant and
needs no network, which is what tests and early development want. It measures
vocabulary overlap and nothing else — it has no sense of meaning, so swap in a
model before promising anyone semantic search. Nothing else in this package
changes when you do.

`remote({via, model, base, key?, dim?})` is the other: one POST per vector, to
Ollama's `/api/embed` or to an OpenAI-compatible `/v1/embeddings`. It holds no
credential and reads no environment variables — the endpoint, the model and the
token are arguments, which is what lets the same code run on a server, in a
Worker, and against a stubbed `fetch`. `dim` truncates a Matryoshka-trained
model to a fixed width and renormalizes, so one corpus keeps one dimension
without needing a second model. A failure throws: the sweep decides what an
unreachable embedder means (it stops, and the remaining vectors stay stale), and
a vector invented here to avoid the error would be worse than none.

## The sweep

`sweep(db, fields, embedder, limit?)` reconciles the stored vectors with the
text. It is the only asynchronous function in this package. It deletes the
vectors of entities that no longer have text (deleted, emptied, or no longer
carrying an embedded component) and re-embeds the ones whose text or model has
changed, deciding "changed" from the content hash stored beside each vector — so
an unchanged corpus costs one query and no calls to the embedder. It runs on a
schedule, never on the write path: embedding is slow and usually remote, and a
write is neither.

`stale()`, `prune()` and `sources()` are the pieces underneath it, each usable
and testable on its own.

## How `.near` compiles

`@yaks/sql` refuses `.near` on its own — the vectors are here, not there. This
package registers as an [extension](https://jsr.io/@yaks/sql/doc/~/Extension)
and answers it in three steps:

1. it reads the anchor entity's stored vector (never over the network —
   compiling a query is synchronous);
2. it ranks the nearest entities **among the ones the rest of the query
   selects**;
3. that list becomes `entity.id in (?, ?, ?)` for the `WHERE` and a
   `case … when … then` for the `ORDER BY`.

So the nearest-neighbor search runs where the vectors are, and what reaches SQL
is a handful of integer ids. That is why the ordering carries no bound parameter
(the IR's `ORDER BY` holds none) and why the rest of the query still filters,
counts and pages normally.

**Nearest among what.** The ranking is cut down to `neighbours`, so cutting it
before the other clauses filter would answer `.near=X&.memory` with "the
memories among the eight nearest entities of any kind" — almost always none.
@yaks/sql hands every extension the query's `Screen` when it begins — a
statement selecting the eids the rest of the query admits — and the scan reads
only those vectors. Filter, then rank, then cut. A replacement `rank` (an
approximate index) is handed the same screen and has to honour it, or every
filtered query gets the wrong neighbourhood.

**Paging a neighbourhood.** `.near=X&.order=similar&.limit=5` returns the five
nearest, and `&.after=<num>` continues from that entity's own place in the
ranking — @yaks/sql calls this extension's `order` hook a second time with the
anchor's owner id, so the cursor is a rank position without ever being written
as one. The cursor is the ordinary `.after=<num>`: a caller pages a
neighbourhood exactly as it pages a board, and never learns that the sort key is
a similarity. An `.after` naming an entity outside the neighbourhood sorts under
the `else` arm, past every neighbour, so the page comes back empty rather than
wrong.

The similarity comes back as a **query-only component**: `near.rank(bundles)`
returns the bundles nearest-first, each with `rank: { score }`. Nothing stores
it — a component is a shape for carrying data about an entity, and it does not
have to be a table.

One `semantic()` value answers one query at a time: it remembers the
neighbourhood the `.near` clause resolved, so the ordering can rank by it and
you can read the scores back afterwards, and it forgets that when the compiler
reports that a new query has begun (@yaks/sql's `Begin` hook). That is what lets
a server register one at compose time and serve every query through it.
`.order=similar` with no `.near` to rank by is refused as `Unsupported` — on the
hundredth query as on the first.

## The ranking

`nearest()` is an exact cosine scan: every stored vector in the model's space is
read, scored and sorted. Exact means there is no recall to tune and no index to
keep up to date, and at a few tens of thousands of vectors it costs a few
milliseconds. A larger corpus wants an approximate index, and `nearest()` is the
one function to replace — `Rank` is its type and
`semantic(db, embedder, { rank })` takes one, so an approximate index can be
swapped in without touching anything else.

Deleted entities are excluded at read time as well as by the sweep, so an entity
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

The entity's own integer id is the primary key, so a vector joins to the graph
the way every component table does; the blob holds the vector's raw bytes, so
its dimension is the byte length divided by four and no column has to record it.

Ranking runs in TypeScript rather than in a native SQLite vector extension.
There is no persisted approximate-nearest-neighbor index here. Supply a `Rank`
implementation if your application needs indexed vector search — and read the
next section to keep it up to date.

## The dirty flag

An approximate index is built from the vector table and goes out of date the
moment a row changes. Beside the table sits `embedding_index`, a single row
whose `dirty` flag three triggers set inside the same statement as any insert,
update or delete of a vector — so a crash between a write and a rebuild leaves
the flag set, and whoever owns the index next rebuilds it. `dirty(db)` reads it,
`clean(db)` clears it once a rebuild has finished, `mark(db)` sets it by hand
after rebuilding the vector table from somewhere else, and `state(db)` returns
the flag along with the row count and the newest write, for a health check. A
fresh install starts dirty: an index that has never been built is owed a build.
The exact scan in `nearest()` reads none of this.

`schema()` is idempotent and additive, so tables an application already created
in this shape are used as they are.

The whole table is **derived**. Drop it and the next sweep rebuilds it from the
text it was made from — which is why it has no history, no journal, and is never
sent to a client, and why a graph with no embedder is a graph that simply has no
vectors rather than a broken one.

It assumes the layout that `@yaks/sql`'s SQLite dialect reads and
[@yaks/sqlite](https://jsr.io/@yaks/sqlite) creates: an `entity` table of
integer ids, one table per component keyed by an `entity` owner, and a
`tombstone` table listing deleted entities.

## Compatibility

Deno and Node (and any runtime with a SQLite binding that can bind a blob). The
package names no SQLite library: it runs statements through a two-method
`Driver` you supply.
