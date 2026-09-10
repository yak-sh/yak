# @yaks/blob

Content-addressed storage for text columns. The graph plugin replaces marked
column values with SHA-256 addresses before storage; read helpers resolve those
addresses back to text. Repeated values share one stored copy.

For bundle structure, write phases, and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/blob
# or: npx jsr add @yaks/blob
```

## Mark the column

```json
{
  "$vocabulary": {
    "https://json-schema.org/draft/2020-12/schema": true,
    "https://yaks.sh/vocab/core": true,
    "https://yaks.sh/vocab/blob": true
  },
  "$defs": {
    "post": {
      "type": "object",
      "kind": true,
      "properties": {
        "title": { "type": "string" },
        "body": { "type": "string", "store": "blob" }
      }
    }
  }
}
```

That is the entire declaration. To everything else — validation, routing,
queries, the wire — `body` is a plain string column and stays one.

## Configure storage and the plugin

```ts
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import {
  blobKeywords,
  blobRead,
  blobs,
  blobSchema,
  sqliteBlobs,
} from '@yaks/blob'

let vocab = loadVocab([blog], [blobKeywords])
let bytes = sqliteBlobs(driver)
let db = storage(driver, vocab, { derived: blobRead(vocab) })
for (let stmt of [...db.ddl(), ...blobSchema()]) driver.exec(stmt)

let g = graph({ storage: db, vocab, plugins: [blobs(vocab, bytes)] })

g.apply([{ entity: { eid: 'p1' }, post: { body: 'a long essay…' } }])
db.read('.post!')[0].post.body // 'a long essay…'
```

The caller writes and reads text. The component table stores an address, and
`sqliteBlobs` stores the text in a separate table, deduplicated by address.

## Write ordering and transactions

The plugin replaces text with addresses in `precondition`, after the `$was`
guard checks the caller-visible text, and restores text in returned bundles at
`commit`. A `mutate` hook would run after the core has already written rows.

With `sqliteBlobs` on the same driver, blob inserts and component writes share a
transaction. File and object stores do not participate in that transaction; a
failed graph write can leave an unreferenced blob.

## Backends

One interface, `has` / `get` / `put` over `Uint8Array`, keyed by the address:

| backend                  | where the bytes go                      | sync? |
| ------------------------ | --------------------------------------- | ----- |
| `sqliteBlobs(driver, …)` | a `(sha, value)` table beside your rows | yes   |
| `fileBlobs(dir)`         | one file per address                    | no    |
| `objectBlobs(bucket, …)` | an S3-shaped bucket (R2, …)             | no    |

`sqliteBlobs` is the one to reach for first: the bytes commit in the same
transaction as the row, there is no second thing to back up, and it is the only
backend SQL can read **through** — which is what `blobRead` uses. It holds text,
so it is for prose; binary content belongs in a file or a bucket.

`objectBlobs` takes any object with three methods; Cloudflare's `R2Bucket` is
one as it stands, so this package depends on no cloud SDK.

Writing your own is three functions.

## Reading it back

Two ways, because a backend the database can see into and one it cannot are
different problems:

- **`blobRead(vocab, layout)`** — @yaks/sql read overrides, one per body column,
  each resolving the address in the statement itself. Hand them to `storage()`
  and both a query predicate (`.body~=spain`) and a whole-entity gather come
  back as text, in one round trip.
- **`hydrate(vocab, store, bundles)`** — for the file and object backends: takes
  bundles, fetches each address, gives bundles back. Asynchronous only when the
  store is.

Every name in `Layout` is configurable, because the table is often one you
already have — configure it to read an existing table.

## Searching a body

A swapped column stores its **address**, so an index built straight over it
holds hashes and a search matches titles alone. `blobText(vocab, layout)` is the
resolution — a `comp.prop` map from the SQL that names an address to the SQL
that names its text — and both `@yaks/fts` and `@yaks/sqlite` take one:

```ts
import { fields, schema } from '@yaks/fts'
import { blobText } from '@yaks/blob'

for (let stmt of schema(fields(vocab), blobText(vocab))) db.exec(stmt)
// or, for the `doc` index @yaks/sqlite ships:
// let store = storage(driver, vocab, { text: blobText(vocab) })
```

The words go into the index on every write path, because it is the table's own
triggers that resolve them — the plugin's write, a plain `insert`, a restore.
Resolving there is sound: a blob is immutable and content-addressed, so the
delete side of an external-content index reads exactly what the insert side did.

## What it does not do

Nothing collects unreferenced bytes. A content-addressed object is cheap, immune
to a stale reader, and shared by every row that holds the same value, so
deciding when one is truly unreachable is an application's call, not a default.

Dropping the plugin does not strand your data either way: a body column is a
text column holding a hash, and the store is a table of hashes and text.

## Exports

| export                                | is                                          |
| ------------------------------------- | ------------------------------------------- |
| `blobKeywords`, `BLOB_URI`            | the `store` keyword vocabulary, to register |
| `bodies(v)`, `isBody(col)`            | which columns are content-addressed         |
| `blobs(v, store)`                     | the @yaks/graph plugin — the swap           |
| `Blobs`, `address`, `encode`/`decode` | the backend interface and its key           |
| `sqliteBlobs`, `blobSchema`           | the table backend, and its DDL              |
| `blobRead(v, layout)`                 | the @yaks/sql read overrides                |
| `blobText(v, layout)`                 | an address resolved, for a search index     |
| `hydrate(v, store, bundles)`          | the read side for a non-SQL backend         |
| `fileBlobs(dir)`                      | the directory backend                       |
| `objectBlobs(bucket, prefix?)`        | the bucket backend                          |

## Composition

A plugin over [@yaks/graph](https://jsr.io/@yaks/graph), reading its one
declaration through [@yaks/vocab](https://jsr.io/@yaks/vocab)'s keyword
extension API the way [@yaks/id](https://jsr.io/@yaks/id) and
[@yaks/names](https://jsr.io/@yaks/names) do, and teaching
[@yaks/sql](https://jsr.io/@yaks/sql) how to read a body column through its
derived-column API.

## Compatibility

The keyword, the plugin, the interface and the SQLite backend import no platform
API. `fileBlobs` looks its runtime's filesystem up rather than importing one,
and throws where there is none. Runs on **Deno**, **Node**, and in the
**browser**.

`blobRead(vocab, layout)` is also accepted by `@yaks/fts`'s
`schema(fields,
reads)`: the same registry resolves query predicates, bundle
reads, and the indexed words. Each override carries a `text(stored)` expression
as well as `expr(owner)`, because an FTS delete trigger must resolve `old.body`,
not look up the owner after its row has changed or disappeared. `blobText()`
remains the address-only form for callers that already hold a stored value.

## Bounded graph-value inspection

`valueTools(readEntity)` returns provider-neutral `graph_value_read` and
`graph_value_search` tool declarations with executable `run` functions. Supply
the same authorized entity reader used by your application's other graph tools.
The tools never accept filesystem paths or raw blob hashes as read capabilities.
They work for any string-valued graph property, not just blob-backed columns.

Both accept `entity`, `component`, and `property`. An optional `revision` checks
the SHA-256 of the UTF-8 text and fails if it changed. Missing, denied, or
non-text values fail; the tools do not serialize arbitrary objects.

- Read: `start` is a zero-based Unicode code-point offset; `count` defaults to
  2048 and cannot exceed 8192. The response includes `start`, `end`, `total`,
  `revision`, `text`, and `next` (null at EOF). Escaped JSON text is further
  bounded, so a response can contain fewer characters than requested.
- Search: `query` is a nonempty, case-sensitive literal (at most 256 UTF-16 code
  units), not a regular expression. `start` skips a character range and `limit`
  defaults to 10, at most 20. Matches include offsets and short excerpts. `next`
  is a continuation offset when the match limit was reached; a subsequent search
  may find no further matches.

Offsets count code points rather than grapheme clusters or terminal columns.
These APIs currently load the whole text through the reader before slicing or
searching it; bounded output is not a streaming storage API.

## Binary artifacts

`artifactStore(blobs)` accepts bytes and a media type, returning
`{address, media_type, size}` after storage verification. Use `fileBlobs` or
`objectBlobs` for image and other binary bytes, not the SQLite text backend.
Identical bytes share a SHA-256 address. Existing corrupt or partial objects are
rewritten before a descriptor is returned. Configure access permissions and
retention on the external store; it is not part of the SQLite transaction.

`artifactDoc` declares generic `artifact` and `attachment` components. Artifact
entities describe stored bytes; attachment entries refer to them and can record
a provider call ID and revised prompt. The host must keep the configured binary
store available alongside its database. There is no automatic garbage collection
or database-only restore of external objects.
