# @yaks/embedding

Maintains text vectors for graph entities and ranks entities by vector
similarity. An embedder converts text into a `Float32Array`; a background
reconciliation pass stores the vectors in SQLite. The SQL extension answers
`.near=<entity>` queries from those stored vectors without making network
requests during compilation.

A **bundle** is one entity's components as a JSON object. The **host** is the
process that opened the graph and loaded the plugin, such as `yak serve` or a
CLI command.

## Install

```sh
deno add jsr:@yaks/embedding
# or: npx jsr add @yaks/embedding
```

## Use

Here `db` is @yaks/sql's synchronous `Driver`, which runs a statement with
`query(statement)`, over an in-memory database holding two books.

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import {
  fields,
  hashEmbedder,
  meaning,
  schema,
  semantic,
  sweep,
} from '@yaks/embedding'

let title = { type: 'string', search: true }
let book = { component: true, properties: { title, price: { type: 'number' } } }
let vocab = loadVocab([{ $defs: { book } }])
let db = open(':memory:')
for (let statement of storage(db, vocab).ddl()) db.query(statement)
graph({ storage: storage(db, vocab), vocab }).apply([
  { entity: { eid: 'book-1' }, book: { title: 'The Hobbit', price: 12 } },
  { entity: { eid: 'book-2' }, book: { title: 'The Silmarillion', price: 18 } },
])

let text = fields(vocab)
for (let statement of schema()) db.query(statement)

let embedder = hashEmbedder()
await sweep(db, text, embedder)

let near = semantic(db, embedder)
let store = storage(db, vocab, { extend: [near] })
let rows = store.read('.near=book-1&.order=similar .book.price<20')
let ranked = near.rank(rows) // adds rank: { score } to matching bundles
let hits = await meaning(
  db,
  text,
  embedder,
  'a story about an unexpected journey',
)
// each hit has { entity, similarity, excerpt }
```

`hashEmbedder()` is deterministic and needs no network. It measures hashed word
counts, not semantic meaning; use a model-backed embedder for semantic search.
Call `sweep()` after text changes or schedule it through the plugin below.

`meaning()` embeds new search words and ranks the stored vectors. Each excerpt
comes from the configured text that made the vector, including resolved text for
a property stored by address. An excerpt has no match markers: a semantic hit
need not contain any search word. It returns at most 20 hits by default;
`limit`, `floor` and an optional candidate `screen` can narrow them.

## As a plugin

The plugin configuration selects a model, endpoint, credentials and text fields:

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
          "key": { "secret": "OLLAMA_API_KEY" },
          "dim": 384
        },
        "text": ["doc.title"],
        "neighbours": 8,
        "floor": 0.78,
        "after": 3000
      }
    }
  ]
}
```

`@yaks/embedding/rules` creates the vector tables through the host's SQL driver.
Its `extend()` export registers the `.near` compiler; its `meaning()` factory
resolves the current embedder on each search, so a key arriving later is used
without rebuilding the host. `@yaks/embedding/service` is the plugin's service,
held by one process per graph: it sweeps the queue, takes the next batch at once
while work is left, and looks again after `after` once the queue is empty. The
graph write does not await embedding. The service stops when its signal aborts,
and a pass the host ended leaves its work queued.

Options:

| Option       | Meaning                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| `embedder`   | `{ via: 'hash', dim? }`, `{ via: 'model2vec', model, dim? }`, or a remote embedder    |
| `text`       | Selected `component.property` names; defaults to the properties marked `search: true` |
| `neighbours` | Maximum `.near` results, default 8                                                    |
| `floor`      | Minimum similarity for `.near`, default 0                                             |
| `after`      | How long an empty queue waits before the next look, in milliseconds, default 3000     |
| `batch`      | Queued entities one sweep takes, default 64                                           |
| `stale`      | Age threshold in minutes used by `vector_check`, default 30                           |

The `batch` option bounds one sweep; it does not mean a graph transaction.

Missing embedder configuration or a missing configured key does not prevent
startup. `vector_check` reports the missing configuration, and the service keeps
looking until it arrives. An unknown provider is reported as unavailable;
invalid `text` names are also reported.

The CLI resolves `{ "secret": "NAME" }` through [@yaks/secrets](../secrets) each
time options are read, so a key written through the graph after the host started
is used on the next pass. A later export in a separate shell does not change an
already running process's environment. Field watches and the query extension are
created when the plugin is composed; changing their configuration may require
rebuilding them.

The package has a `vocab.json` declaring the `vector_check` tool, but no graph
component for stored vectors. Vectors are derived SQL data and are not included
in ordinary graph snapshots or client sync.

## Which text is embedded

`fields(vocab)` selects stored scalar text properties in vocabulary order,
excluding computed properties and references. A `pick(prop)` argument replaces
that default predicate; combine it with `textual(prop)` to narrow the default
safely. After them come the fields a component's `search` list names
(@yaks/vocab): `entry` says `"search": ["content.body"]`, so a transcript entry
is embedded by its content and no other entity carrying `content` is. The same
list makes @yaks/fts index that text, so what a bare word finds, `.near` finds
too.

Each entity gets one vector from its nonblank selected fields joined with
newlines. The source query reads component columns directly, except a column the
host reads through an expression: `resolved(fields, host.derived)` gives such a
field its `text` expression, so a `@yaks/blob` body is embedded as its prose
rather than its stored hash. The plugin's sweep does this; a caller running
`sweep()` itself passes resolved fields.

## The embedder is yours

```ts
type Embedder = {
  model: string
  embed: (text: string) => Float32Array | Promise<Float32Array>
}
```

The model name is stored beside each vector and included in the source hash.
Queries compare only vectors under the selected model name. Changing that name
makes existing text stale and causes the next sweep to recompute it.

`hashEmbedder(dim?)` defaults to 64 dimensions. It hashes words into counts and
normalizes the resulting vector. `remote({ via, model, base, key?, dim? })`
posts to Ollama's `/api/embed` or an OpenAI-compatible `/v1/embeddings`
endpoint; the calls made in one turn of the event loop ride in one request, up
to `count` (64) inputs and `load` (128,000) characters each. Credentials are
arguments; `remote()` itself reads no environment variables. Optional `dim`
truncates and renormalizes vectors; use it with a model that supports that
operation. Two widths of one model are two spaces, so a `dim` is part of the
stored model name (`qwen3-embedding:0.6b#384`). `chars` (default 30,000) bounds
the text sent for one vector: a server refuses input past its model's context
rather than truncating it. A status saying the input was refused (400, 413, 422)
rejects with `Refused`; any other failure rejects with the error.

`{ via: 'model2vec', model: 'minishlab/potion-retrieval-32M@6fc8051', dim: 256 }`
runs a Model2Vec static model in this process ([@yaks/model2vec](../model2vec)):
about a millisecond for a 500-token text on one core, fast enough to embed every
prompt. The model is fetched from the Hugging Face hub on the first embed and
kept in the platform's cache. Its space is the pinned model and its width
(`minishlab/potion-retrieval-32M@6fc8051#256`).

## The sweep

Triggers on each component a field lives on queue the entity a write touched in
`embedding_owed`, in the same statement as the write, whichever process made it.
`watch(db, fields)` makes the triggers match the fields; when it changes any, it
queues every entity wearing a field or holding a vector, which is how a new
database or a new field is backfilled.

`sweep(db, fields, embedder, limit?)` calls `watch`, then takes the newest
`limit` (64) queued entities: it embeds those whose text changed, deletes the
vector of those with no text (emptied, deleted, or no longer wearing a field),
and settles each unless a write queued it again meanwhile. Source hashes avoid
model calls for unchanged text. Once the queue is empty, a vector made by
another model queues everything again. It returns `{ fresh, left, refused }`. A
text the embedder refuses loses its vector and is reported in `refused`; any
other embedder failure stops the pass, the caller receives the error, and the
work stays queued.

`sources()`, `put()`, `watch()`, `owe()`, `due()` and `paid()` expose the
individual operations. Embedding can run asynchronously; source reads, vector
writes and query ranking use the synchronous database driver. A sweep is not one
graph transaction.

A newly created entity cannot be compared until its vector exists. The plugin's
reply (below) makes that vector at once for an entity a tool call created; an
application of its own can embed the new text and call `nearest()`.

## A write answers what it is near

As a plugin, `@yaks/embedding/rules` exports `reply(host, options)`: what a
direct tool call's answer carries beside the tool's own
([@yaks/tools](../tools/README.md) `Reply`). For each entity the call's write
created, up to five, it answers the three existing entities of the same kind
nearest to it, so whoever wrote a task, a memory or a comment sees at once
whether the graph already holds it. A read, a rehearsal and a refusal created
nothing and get nothing.

The new entity's vector is made then, waiting at most a second for the model,
and stored as the sweep stores it, so the sweep finds it made and calls no
model. The neighbours are `.near=<entity>&.order=similar` among entities of that
kind. Where the model has not answered or no embedder is configured, the words
of the entity's first line (a document's title) are the query instead, ordered
by `.order=search`: a twin that says the same thing in the same words. A config
without this plugin answers no neighbours.

Each neighbour is a bundle carrying a query-only `hit`, the shape a search
answers with: its `kind`, its `title` (or an excerpt of its text as `snippet`),
its `status` where it has one, `source` (`meaning` or `text`), and `near`, the
eid of the new entity it was found near. The tool's own bundles come first,
unchanged. A model reads each neighbour as one line:

```text
near <new eid>: <eid> Fix the login page crash on submit · task open (meaning)
```

## How `.near` compiles

`semantic(db, { model }, options?)` supplies an `@yaks/sql` extension:

1. Read the target entity's stored vector.
2. Rank candidates admitted by the rest of the query's filters.
3. Compile the selected integer entity IDs into the SQL condition and a `CASE`
   expression for `.order=similar`.

The default limit is eight neighbors and the target itself is excluded. A target
without a vector selects nothing. A custom `rank` implementation receives the
same candidate filter and must honor it before limiting results.

`.near=book-1&.order=similar&.limit=5` returns the first five results. An
ordinary `.after=<num>` cursor continues after that entity's position in the
ranking; a cursor outside the selected neighbors returns an empty page.
`.order=similar` without `.near` throws `Unsupported`.

`near.rank(bundles)` adds a query-only `rank: { score }` component and sorts
matching bundles by similarity. It preserves unmatched bundles at the end and
stores nothing. The extension retains scores for the most recently compiled
query and resets them when another compilation begins. Read/decorate one query's
results before reusing the same extension for another query.

## The ranking

`nearest()` ranks by exact cosine similarity over the stored vectors, among the
entities a screen admits, and excludes tombstoned entities immediately. Where
the index below is built, it names the candidates and only those vectors are
read; everywhere else every vector the screen admits is read. A screen that
admits at most 5000 entities is always read whole: its vectors cost less to
score than to find among every code.

Supply `semantic(db, space, { rank })` with a `Rank` implementation to use
another ranking; it receives the same screen.

## The index

On a local SQLite connection, sqlite-vector keeps every vector as 2-bit
TurboQuant codes, held in memory per connection. A search scans the codes for
its nearest candidates (at least 128, 32 per neighbour asked for), among what
the screen admits, and scores those exactly beside every vector written or
deleted since the build. The answer is the exact ranking wherever the true
nearest are among the candidates. A screen is applied to each candidate before
the pool is cut, reading further into the codes until the pool is full.

`build(db)` quantizes the whole table in one transaction under the write lock,
clears the dirty set and numbers the build. It builds only when the index is
`behind(state(db))`: never built, built from another model, or 1024 vectors
changed since. The plugin's service calls it after every sweep pass, so the one
process holding the sweep is the one that builds; every other connection sees
the new build number and loads the codes again. While two models' vectors share
the table during a re-embed, no index is built and every vector is read.

The tables are `embedding_build` (one row: the build number, 0 before the first,
and the model, dimension and count it was built from) and `embedding_dirty` (one
row per entity whose vector changed since), kept by insert, update and delete
triggers on `embedding` in the same statement as the vector change.

To enable the index on an existing file, back it up first, then call
`installNative(db)` once on a writable `@yaks/sqlite` connection. Loading
sqlite-vector creates its `_sqliteai_vector` metadata table, so searches never
install it on a database that lacks that table. The platform binaries are in the
root import map; other SQL drivers read every vector.

## Storage

The vector table is:

```sql
create table embedding (
  entity integer primary key references entity(id),
  model text not null,
  hash text not null,
  vec blob not null,
  at text not null
)
```

The primary key allows one stored vector per entity, including only one model at
a time. `vec` contains packed Float32 bytes, with dimension equal to byte length
divided by four. `schema()` creates the table and its maintenance objects
idempotently; it does not migrate incompatible existing definitions.

The package assumes `@yaks/sqlite`'s integer `entity.id`, public `entity.eid`,
component owner columns, and `tombstone` table. The vector data can be rebuilt
from the selected text: after deleting its tables, recreate them with `schema()`
before running another sweep.

`vector_check` fails when the index has been behind for longer than the `stale`
threshold, which means no process is running the sweep. It warns where every
search reads every vector: sqlite-vector not installed, or two models sharing
the table.

## Exports

The root exports field selection, `Embedder`, `hashEmbedder`, `remote`, vector
math/packing helpers, the schema, sweep operations, the index (`installNative`,
`build`, `state`, `behind`), `vectorOf`, `nearest`, `meaning`, `semantic` and
supporting types such as `Rank`. The `Driver` it runs on is `@yaks/sql`'s.

| Sub-module export         | Purpose                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/embedding/vocab`   | `embeddingDoc` and `docs`, declaring `vector_check`                                                                                                                                          |
| `@yaks/embedding/rules`   | `rules(host)` creates SQL objects; `extend(host, options)` creates the compiler extension; `meaning(host, options)` searches words; `reply(host, options)` answers a new entity's neighbours |
| `@yaks/embedding/service` | `service(host, options, signal)` sweeps the queue until the signal aborts                                                                                                                    |
| `@yaks/embedding/tools`   | `runs(host, options)` implements `vector_check`; exports the options type                                                                                                                    |

## Compatibility

Requires a synchronous SQLite driver that supports blob values. The package
chooses no SQLite binding. Remote embedders also require `fetch`; the offline
embedder needs no network access.
