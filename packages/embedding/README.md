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

This example assumes a loaded `vocab` declaring a `book` component with text
properties and a numeric `price`, and a synchronous `@yaks/sqlite` `db` driver
with `query(sql, params)` and `exec(sql)`. The graph's tables and sample books
must already exist.

```ts
import { fields, hashEmbedder, schema, semantic, sweep } from '@yaks/embedding'
import { storage } from '@yaks/sqlite'

let text = fields(vocab)
for (let statement of schema()) db.exec(statement)

let embedder = hashEmbedder()
await sweep(db, text, embedder)

let near = semantic(db, embedder)
let store = storage(db, vocab, { extend: [near] })
let rows = store.read('.near=book-1&.order=similar .book.price<20')
let ranked = near.rank(rows) // adds rank: { score } to matching bundles
```

`hashEmbedder()` is deterministic and needs no network. It measures hashed word
counts, not semantic meaning; use a model-backed embedder for semantic search.
Call `sweep()` after text changes or schedule it through the plugin below.

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
Its `extend()` export registers the `.near` compiler. `@yaks/embedding/effects`
returns component watches: creation, changes to selected properties, and removal
schedule a sweep after a debounce timer. The graph write does not await
embedding. The host's `stopping` signal cancels pending timers.

Options:

| Option       | Meaning                                                                            |
| ------------ | ---------------------------------------------------------------------------------- |
| `embedder`   | `{ via: 'hash', dim? }`, or a remote embedder configuration                        |
| `text`       | Selected `component.property` names; defaults to all stored scalar text properties |
| `neighbours` | Maximum `.near` results, default 8                                                 |
| `floor`      | Minimum similarity for `.near`, default 0                                          |
| `after`      | Debounce delay in milliseconds, default 3000                                       |
| `batch`      | Maximum entities embedded per sweep; default all                                   |
| `stale`      | Age threshold in minutes used by `vector_check`, default 30                        |

The `batch` option limits embedding work; it does not mean a graph transaction.
If a pass leaves stale vectors because of this limit, another write or an
application-scheduled sweep is needed to continue.

Missing embedder configuration or a missing configured key does not prevent
startup. `vector_check` reports the missing configuration. After a watched write
schedules a pass, a pass waiting for configuration reschedules itself and checks
again. There is no unconditional startup sweep or recurring successful sweep. An
unknown provider is reported as unavailable; invalid `text` names are also
reported.

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
safely.

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
sends one POST per vector to Ollama's `/api/embed` or an OpenAI-compatible
`/v1/embeddings` endpoint. Credentials are arguments; `remote()` itself reads no
environment variables. Optional `dim` truncates and renormalizes vectors; use it
with a model that supports that operation. `chars` (default 30,000) bounds the
text sent for one vector: a server refuses input past its model's context rather
than truncating it, which would stop every sweep at the same document. Remote
errors reject the embedding request.

## The sweep

`sweep(db, fields, embedder, limit?)` prunes vectors for deleted entities or
entities whose selected text is now empty, then embeds changed text. It returns
`{ fresh, left }`. Source hashes avoid model calls for unchanged text. An
embedder failure stops the pass and leaves remaining work stale; the caller
receives the error. With an empty field list, the current prune implementation
leaves existing vectors in place.

`sources()`, `stale()`, `prune()` and `put()` expose the individual operations.
Embedding can run asynchronously; source reads, vector writes and query ranking
use the synchronous database driver. A sweep is not one graph transaction.

A newly created entity cannot be compared until its vector exists. Applications
that need immediate duplicate suggestions can embed the new text themselves and
call `nearest()`; no duplicate-detection write rule is provided.

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

`nearest()` computes exact cosine similarity in TypeScript, then sorts
candidates. It excludes deleted entities immediately, even before pruning. Its
work grows with the number and dimensions of candidate vectors; no approximate
index is included. Supply `semantic(db, space, { rank })` with a `Rank`
implementation to use an application-managed index.

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

## The dirty flag

`embedding_index` holds a single dirty flag. Insert, update and delete triggers
on `embedding` set it in the same SQL statement as the vector change. A new
schema starts dirty. An application maintaining an approximate index can use:

- `dirty(db)` to check whether a rebuild is needed;
- `clean(db)` after completing a rebuild;
- `mark(db)` to request a rebuild explicitly;
- `state(db)` for the dirty flag, vector count and newest vector timestamp.

The built-in exact scan does not use this flag, and `sweep()` does not rebuild
an approximate index or clear it. `vector_check` reports an old dirty index
using the newest vector timestamp; that finding needs interpretation when only
exact scans are configured.

## Exports

The root exports field selection, `Embedder`, `hashEmbedder`, `remote`, vector
math/packing helpers, schema and dirty-state helpers, sweep operations,
`vectorOf`, `nearest`, `semantic` and supporting types such as `Driver` and
`Rank`.

| Sub-module export         | Purpose                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `@yaks/embedding/vocab`   | `embeddingDoc` and `docs`, declaring `vector_check`                                       |
| `@yaks/embedding/rules`   | `rules(host)` creates SQL objects; `extend(host, options)` creates the compiler extension |
| `@yaks/embedding/effects` | `effects(host, options)` returns watches and schedules debounced sweeps                   |
| `@yaks/embedding/tools`   | `runs(host, options)` implements `vector_check`; exports the options type                 |

## Compatibility

Requires a synchronous SQLite driver that supports blob values. The package
chooses no SQLite binding. Remote embedders also require `fetch`; the offline
embedder needs no network access.
