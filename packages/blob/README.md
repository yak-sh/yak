# @yaks/blob

Content-addressed storage for long text columns, and for binary files. Mark a
string column in the schema and its value moves out of the row: the row keeps
the SHA-256 of the text, the bytes go to a byte store — a database table, a
directory, or an object bucket — and writes and reads still deal in text. Two
rows holding the same value share one stored copy.

For bundle structure, write phases, and what a storage adapter is responsible
for, see the [graph architecture](../graph/ARCHITECTURE.md).

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

That is the entire declaration. To validation, to query compilation, and to the
JSON a client sends and receives, `body` is a plain string column and stays one.

## What the address is

An object's key is the lowercase-hex SHA-256 of its bytes, and a caller never
chooses it:

- For a text column, the address is the SHA-256 of the text's UTF-8 encoding.
  `address(text)` computes it with @yaks/graph's synchronous digest rather than
  `crypto.subtle`, whose promise would make every write to a body column
  asynchronous — including one over an embedded database that is otherwise
  synchronous end to end.
- For binary bytes, the address is `addressOf(bytes)`, which uses
  `crypto.subtle.digest('SHA-256', …)` and therefore returns a promise.

Two things follow, and the rest of the package relies on both: writing the same
value twice produces one stored object, and an object fetched under an address
is always the one that hashes to it.

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
`sqliteBlobs` stores the text in a separate table, deduplicated by address. A
vocabulary loaded without `blobKeywords` declares no body columns at all, so the
plugin is a no-op on it rather than a surprise.

## When the swap happens

The plugin replaces text with addresses in the `precondition` phase, and puts
the text back into the bundles `apply()` returns at `commit`.

It cannot run earlier: `normalize`, `admit` and `mint` are all outside the
transaction, and a committed row must never point at bytes that were never
written. It cannot run later: by the time a `mutate` hook is called, the core
has already handed the rows to storage. `precondition` is also the correct side
of the `$was` precondition guard — the guard hashes the value the caller read,
and what a caller reads is the text, so it must run against text, and the core's
guard runs before this hook.

With `sqliteBlobs` on the same driver, the blob inserts and the component writes
are in one transaction. The file and object stores are not, so a graph write
that fails afterwards can leave bytes that no row references.

## The byte stores

`Blobs` is the interface a byte store implements: three methods keyed by
address, over `Uint8Array`.

```ts
type Blobs = {
  has: (sha: string) => boolean | Promise<boolean>
  get: (sha: string) => Uint8Array | undefined | Promise<Uint8Array | undefined>
  put: (sha: string, bytes: Uint8Array) => void | Promise<void>
}
```

Each method may return a value or a promise, the same rule @yaks/graph's
`Storage` follows: a table in the database you are already writing answers
immediately and keeps `apply()` synchronous, while a bucket across the network
answers with a promise and makes it asynchronous. Three implementations ship:

| function                       | where the bytes go                      | synchronous |
| ------------------------------ | --------------------------------------- | ----------- |
| `sqliteBlobs(driver, layout?)` | a `(sha, value)` table beside your rows | yes         |
| `fileBlobs(dir)`               | one file per address, `<dir>/<sha>`     | no          |
| `objectBlobs(bucket, prefix?)` | an S3-shaped bucket (R2, …)             | no          |

`sqliteBlobs` is the one to reach for first: the bytes commit in the same
transaction as the row that addresses them, there is no second thing to back up,
and it is the only store SQL can read **through**, which is what `blobRead`
needs. Its value column is TEXT, so it is for prose — it refuses bytes that are
not valid UTF-8, because a text column has no representation for them and an
address that answered mangled bytes would break the one promise content
addressing makes. `blobSchema(layout?)` returns the `create table` statement.

`fileBlobs` looks its runtime's filesystem up on `globalThis.Deno` rather than
importing one, so the module type-checks with only the web platform in scope and
throws when called where there is no filesystem. The file is named by the
address this package computed, never by anything a caller sent, so no path can
escape the directory.

`objectBlobs` accepts any object with `head`, `get` and `put`. Cloudflare's
`R2Bucket` satisfies that as it stands — `conform.ts` type-checks the
hand-written `Bucket` against the R2 types under `deno task check:workers` — so
this package depends on no cloud SDK and still runs inside one.

Writing another store is those three functions.

`Driver` (`./driver.ts`) is the SQLite handle `sqliteBlobs` runs statements
through: `{ query(sql, params) => rows, exec(sql) }`. It is deliberately the
smallest shape a SQLite binding can satisfy, so nothing here names a concrete
library and an application that already has a database hands over the two
methods it has. A @yaks/sqlite storage adapter's driver is one of these.

## Reading it back

Two ways, because a store the database can read into and one it cannot are
different problems:

- **`blobRead(vocab, layout?)`** returns @yaks/sql read overrides, one per body
  column, each resolving the address inside the SQL statement. Pass them to
  `storage()` as `derived` and both a query predicate (`.body~=spain`) and a
  whole-entity read come back as text, in one round trip. This works only for
  `sqliteBlobs`, or for an existing table of the same shape.
- **`hydrate(vocab, store, bundles)`** is for the file and object stores: it
  takes bundles, fetches each address, and returns bundles. It is asynchronous
  only when the store is. An address the store does not hold is left in place
  rather than blanked — an unresolvable address is a better answer than a lost
  row.

Every name in `Layout` is configurable — `table` (default `blob_text`), `key`
(`sha`), `value` (`value`) — because the table is often one an application
already has. Point `Layout` at it and the existing rows are readable as they
stand.

## Indexing the text

A swapped column stores its **address**, so a full-text index built straight
over it holds hashes and a search matches titles alone.
`blobText(vocab, layout?)` is the resolution — a `comp.prop` map from SQL that
names an address to SQL that names its text — and both `@yaks/fts` and
`@yaks/sqlite` accept one:

```ts
import { fields, schema } from '@yaks/fts'
import { blobText } from '@yaks/blob'

for (let stmt of schema(fields(vocab), blobText(vocab))) db.exec(stmt)
// or, for the `doc` index @yaks/sqlite ships:
// let store = storage(driver, vocab, { text: blobText(vocab) })
```

The words reach the index on every write path, because it is the table's own
triggers that resolve them — the plugin's write, a plain `insert`, a restore.
Resolving there is sound: a blob is immutable and content-addressed, so the
delete side of an external-content index reads exactly what the insert side did.

`blobRead(vocab, layout)` is also accepted by `@yaks/fts`'s
`schema(fields, reads)`: the same registry resolves query predicates, bundle
reads and the indexed words. Each override carries a `text(stored)` expression
as well as `expr(owner)`, because an FTS delete trigger has to resolve
`old.body` rather than look the owner up after its row has changed or
disappeared. `blobText()` is the address-only form, for callers that already
hold a stored value.

## Binary files

`artifactStore(blobs)` takes bytes and a media type and returns
`{ address, media_type, size }` once the store has been read back and confirmed
to hold them. Use `fileBlobs` or `objectBlobs` for images and other binary
content, not the SQLite text table. Identical bytes share one address.

`keep(store, address, bytes)` is that store-and-verify step on its own: writing
the same pair twice is a no-op, an existing corrupt or partial object is
rewritten, and a store that hands back anything else throws instead of letting a
row point at the wrong object.

`sizeOf(bytes)` reads a picture's `{ w, h }` out of its own header — png, jpeg,
gif and webp — without decoding it, and returns `undefined` for any other format
and for a header stating a zero. A page can reserve a photo's space before the
bytes arrive; a guess would be worse than nothing, because a page can ask the
bitmap itself but cannot un-believe a row.

`served(bytes, { mime, name })` wraps bytes in an HTTP `Response`:
`cache-control: public, max-age=31536000, immutable` (content-addressed bytes
can never change under their address), a `sandbox; script-src 'none'` content
security policy, `x-content-type-options: nosniff`, and an inline
`content-disposition` when a name is given. A stored HTML page or SVG opened in
a tab therefore renders and runs nothing.

`vocab.json` declares two components, exported as `artifactDoc`.
`artifact{address, media_type, size}` describes stored bytes; `attachment`
references one and can record the provider call id and revised prompt that
produced it. The server has to keep the configured binary store available
alongside its database: nothing garbage-collects it, and external objects cannot
be restored from a database backup alone.

## The HTTP endpoints

`@yaks/blob/routes` exports `routes(host, options)`. It is one of the six
subpaths a server imports from a plugin (`yak serve`, see
[@yaks/cli](../cli/README.md)), and it mounts one path, `/blob/<sha256>`, with
two methods:

- **`GET /blob/<sha>`** — returns the bytes through `served()`: fenced and
  cached immutably, typed by the `media_type` of the `artifact` entity whose eid
  is that address, and `application/octet-stream` where no row names them. A
  path that is not 64 lowercase hex digits, and an address the store does not
  hold, both answer 404.
- **`PUT /blob/<sha>`** — stores the bytes. The address in the path is the name,
  so the server only has to agree: bytes hashing to anything else are refused
  with 400, and the same file sent twice — or by two people, or by one client
  retrying — is one stored object and one row. The request body is counted as it
  arrives and a body over `limit` is refused with 413, on the bytes themselves
  rather than on what a `content-length` header claimed. The `content-type`
  header, with its parameters dropped, is recorded as the media type. The
  response is the `artifact` as JSON.

An upload writes that `artifact` row through the graph, and writes it twice:
first with `{ check: true }`, which runs the write without committing, so
whatever policy would refuse the write refuses the upload before any bytes are
kept; then, once the bytes are stored, for real. The row is signed as whoever
`host.who` reports is calling, the same attribution a write through `/apply`
gets. This package has no upload permission of its own — who may upload is the
graph's question, answered by a rule like any other. A PUT that dies in between
leaves an object no row names, which is what a content-addressed store has
instead of a mess, and repeating the PUT repairs it.

Configuration:

```json
{
  "use": "@yaks/blob",
  "with": {
    "store": { "via": "file", "dir": "/var/lib/blobs" },
    "limit": 26214400
  }
}
```

`limit` is the largest upload in bytes (default 25 MB, exported as `LIMIT`).
`store` is where the objects live, and the GET reads the same one:

- `{"via": "sqlite"}` — the server's own table, the same one `@yaks/blob/rules`
  keeps body text in. The default, and TEXT: bytes that are not UTF-8 are
  refused, so a server accepting binary uploads names one of the others.
- `{"via": "file", "dir": "…"}` — a directory, one file per address.
- `{"via": "object", "bucket": …, "prefix": "…"}` — an S3-shaped bucket. The
  value is the binding object itself, so this one is configured by a server
  composing in code rather than from a JSON file.

A store whose configuration is incomplete — `file` with no `dir`, `object` with
no `bucket`, an unknown `via` — mounts no routes at all and logs why. A server
that believes it is keeping uploads somewhere and is not is worse than one that
does not come up, so it is reported; it is reported rather than thrown, because
missing configuration never stops a server starting. With no routes mounted, an
upload is refused where it is attempted rather than written into nothing.

## Bounded text inspection for tools

`valueTools(readEntity)` returns two provider-neutral tool declarations with
executable `run` functions: `graph_value_read` and `graph_value_search`. Supply
the same authorized entity reader the application's other graph tools use. The
tools never accept filesystem paths or raw blob addresses as read capabilities,
and they work for any string-valued graph property, not only blob-backed
columns.

Both take `entity`, `component` and `property`. An optional `revision` is
checked against the SHA-256 of the UTF-8 text and fails if it has changed. A
missing, denied or non-text value fails; the tools do not serialize arbitrary
objects.

- Read: `start` is a zero-based Unicode code-point offset; `count` defaults to
  2048 and cannot exceed 8192 (exported as `VALUE_LIMIT`). The response carries
  `start`, `end`, `total`, `revision`, `text` and `next` (null at the end).
  Escaped JSON text is bounded as well, so a response can contain fewer
  characters than were requested.
- Search: `query` is a non-empty, case-sensitive literal of at most 256 UTF-16
  code units — not a regular expression. `start` skips a range of characters and
  `limit` defaults to 10, at most 20. Each match carries its offset and a short
  excerpt. `next` is a continuation offset when the match limit was reached; a
  further search may find nothing more.

Offsets count code points, not grapheme clusters or terminal columns. Both tools
load the whole text through the reader before slicing or searching it: the
output is bounded, the storage read is not.

## What it does not do

Nothing collects unreferenced bytes. A content-addressed object is cheap, cannot
go stale under a reader, and is shared by every row that holds the same value,
so deciding when one is truly unreachable is an application's call, not a
default.

Removing the plugin does not strand your data either way: a body column is a
text column holding a hash, and the store is a table of hashes and text.

## Exports

| export                                | is                                          |
| ------------------------------------- | ------------------------------------------- |
| `blobKeywords`, `BLOB_URI`            | the `store` keyword vocabulary, to register |
| `bodies(v)`, `isBody(col)`            | which columns are content-addressed         |
| `blobs(v, store)`                     | the @yaks/graph plugin — the swap           |
| `Blobs`, `address`, `encode`/`decode` | the byte-store interface and its key        |
| `Driver`                              | the SQLite handle `sqliteBlobs` runs on     |
| `sqliteBlobs`, `blobSchema`           | the table store, and its DDL                |
| `fileBlobs(dir)`                      | the directory store                         |
| `objectBlobs(bucket, prefix?)`        | the bucket store                            |
| `blobRead(v, layout)`                 | the @yaks/sql read overrides                |
| `blobText(v, layout)`                 | an address resolved, for a search index     |
| `hydrate(v, store, bundles)`          | the read side for a non-SQL store           |
| `sizeOf(bytes)`                       | an image's `{w, h}`, read off its header    |
| `served(bytes, {mime, name})`         | stored bytes as a fenced HTTP response      |
| `addressOf(bytes)`, `keep(store, …)`  | an object's address, and storing it once    |
| `artifactStore(blobs)`, `artifactDoc` | binary files, stored and declared           |
| `valueTools(read)`, `VALUE_LIMIT`     | the two bounded text-inspection tools       |

Three more subpaths are what a server imports, one module each:
`@yaks/blob/vocab` (`docs`, `keywords`, `derived` — no storage and no runtime,
so a browser tab can load it), `@yaks/blob/rules` (`rules(host)` — creates the
blob tables on the server's own connection and returns the plugin), and
`@yaks/blob/routes` (`routes(host, options)` — the two endpoints above).

## Composition

A plugin over [@yaks/graph](https://jsr.io/@yaks/graph), reading its one
declaration through [@yaks/vocab](https://jsr.io/@yaks/vocab)'s keyword
extension API the way [@yaks/id](https://jsr.io/@yaks/id) and
[@yaks/names](https://jsr.io/@yaks/names) do, and teaching
[@yaks/sql](https://jsr.io/@yaks/sql) how to read a body column through its
derived-column API.

## Compatibility

The keyword, the plugin, the `Blobs` interface and the SQLite store import no
platform API. `fileBlobs` looks its runtime's filesystem up rather than
importing one, and throws where there is none. Runs on **Deno**, **Node**, and
in the **browser**.
