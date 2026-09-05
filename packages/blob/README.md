# @yaks/blob

**Content-addressed storage for a text column**, applied without anybody
noticing. A blog post's body, a product description, a page of notes: values
that are long, often repeated, and awkward in a row.

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

## Then forget about it

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

Nothing between those two lines says `blob`. The write went in as text and came
back as text; in between, the row kept the SHA-256 of the essay and the essay
itself went to the store — **once**, however many posts quote it.

```sql
select body from post;              -- 'e3b0c442…'  the address
select value from blob_text …;      -- 'a long essay…'  the bytes
```

## Where the swap happens, and why there

Inside the batch's transaction, on the last phase before the rows go in
(`precondition`), and undone on the last phase before the commit (`commit`).

That is not a preference, it is the only place it works. The bytes and the row
that addresses them must land together, so the swap cannot happen before the
transaction opens. And `mutate` is already too late: within a phase the core
runs first, so by the time a `mutate` hook is called the text is in the row. It
also lands on the right side of the `$was` precondition — the guard hashes the
value a caller **read**, and what a caller reads is the text.

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
already have — point it at yours and the existing rows read where they lie.

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

## The surface

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

## Where it sits

A plugin over [@yaks/graph](https://jsr.io/@yaks/graph), reading its one
declaration through [@yaks/vocab](https://jsr.io/@yaks/vocab)'s keyword seam the
way [@yaks/id](https://jsr.io/@yaks/id) and
[@yaks/names](https://jsr.io/@yaks/names) do, and teaching
[@yaks/sql](https://jsr.io/@yaks/sql) how to read a body column through its
derived-column seam.

## Compatibility

The keyword, the plugin, the interface and the SQLite backend import no platform
API. `fileBlobs` looks its runtime's filesystem up rather than importing one,
and throws where there is none. Runs on **Deno**, **Node**, and in the
**browser**.
