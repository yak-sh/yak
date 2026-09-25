# @yaks/blob

Stores text and binary content under SHA-256 addresses. A marked string property
keeps its content address in the component row while its UTF-8 text is stored in
a separate table, directory or object store. Configured graph writes and reads
still accept and return text, and identical values share stored content.

A **bundle** is one entity's components as a JSON object. A **batch** is a list
of changes applied in one transaction. The **host** is the process that opened
the graph, such as `yak serve` or a CLI command. See the
[graph architecture](../graph/ARCHITECTURE.md) for the write phases.

## Install

```sh
deno add jsr:@yaks/blob
# or: npx jsr add @yaks/blob
```

## Mark the property

Declare a string property with `store: 'blob'` and register `blobKeywords` when
loading the schema:

```ts
let blog = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      properties: { num: { type: 'number', stamped: true } },
    },
    post: {
      component: true,
      type: 'object',
      kind: true,
      properties: {
        title: { type: 'string', search: true },
        body: { type: 'string', store: 'blob', search: true },
      },
    },
  },
}
```

The property remains a string in validation and client JSON. `search: true` is
optional and selects the property for `@yaks/fts`. Without `blobKeywords`, the
schema's string properties still exist, but this package does not recognize them
as blob-backed properties.

## What the address is

`address(text)` computes the lowercase hexadecimal SHA-256 of UTF-8 text
synchronously using `@yaks/graph`'s digest. `addressOf(bytes)` computes the same
kind of address for arbitrary bytes using asynchronous `crypto.subtle.digest`.
`encode()` and `decode()` convert between strings and UTF-8 bytes.

The low-level store interface expects a valid address supplied by the caller; it
does not itself prove that bytes match that address. `artifactStore()` computes
addresses, and `keep()` verifies stored content. Use these helpers when storing
binary artifacts rather than assuming every backend validates keys and data.

## Configure storage and the plugin

This example continues with `blog` above. Supply a synchronous SQLite `driver`
with `query(sql, params)` and `exec(sql)` methods:

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
let store = storage(driver, vocab, { derived: blobRead(vocab) })
for (let statement of [...store.ddl(), ...blobSchema()]) driver.query(statement)
let g = graph({ storage: store, vocab, plugins: [blobs(vocab, bytes)] })

g.apply([{ entity: { eid: 'p1' }, post: { body: 'A long essay.' } }])
let [post] = store.read('.post')
console.log(post.post) // { body: 'A long essay.' }
```

The component table contains the address; `blob_text` contains the text. Both
use the same driver so their writes participate in the same transaction.

## When the swap happens

The plugin replaces marked strings with stored references during `precondition`,
inside the transaction and after the graph's `$was` guard checks the text the
caller read. It restores text in the bundles returned from `apply()` during
`commit`.

`normalize`, `admit` and `mint` run before the transaction, so they are too
early to make transactional blob inserts. `mutate` hooks run after the graph has
passed component rows to storage, so they are too late to replace the values.

SQLite blob inserts and component writes commit together only when they use the
same active connection. Files and object stores are outside that transaction; a
later graph failure can leave unreferenced content there.

## The byte stores

```ts
type Blobs = {
  has: (sha: string) => boolean | Promise<boolean>
  get: (sha: string) => Uint8Array | undefined | Promise<Uint8Array | undefined>
  put: (sha: string, bytes: Uint8Array) => void | Promise<void>
}
```

Methods can return values or promises. Synchronous storage preserves synchronous
graph writes; an asynchronous backend makes those writes asynchronous.

| Backend                        | Storage                                       | Return style |
| ------------------------------ | --------------------------------------------- | ------------ |
| `sqliteBlobs(driver, layout?)` | A SQL table, default `blob_text(sha, value)`  | Synchronous  |
| `fileBlobs(dir)`               | One file per address at `<dir>/<sha>`         | Asynchronous |
| `objectBlobs(bucket, prefix?)` | Objects accessed through `head`, `get`, `put` | Asynchronous |
| `memoryBlobs()`                | This process's memory, while it runs          | Synchronous  |

`sqliteBlobs` stores **text** and rejects bytes that are not valid UTF-8. Its
inserts use `insert or ignore`. `blobSchema(layout?)` returns its DDL
statements. `Layout` can rename `table`, `key` and `value`, whose defaults are
`blob_text`, `sha` and `value`. Existing tables must have the matching shape.

`fileBlobs` uses `globalThis.Deno` filesystem functions. It creates the
directory on the first write; writes fail without those functions, while reads
return `undefined` on filesystem errors. Pass only validated SHA-256 addresses
to this low-level adapter: it joins the supplied key directly to the directory
path.

`objectBlobs` accepts the exported `Bucket` interface. Cloudflare R2 bindings
satisfy that interface; other object storage clients may need a wrapper. The
package imports no cloud SDK.

`bucketObjects(bucket)` is the same bucket keyed by name rather than by content:
an `Objects` store whose caller chooses each key, as a host does for an app's
files. Besides `has`, `put` and `get` (which throws on a miss) it has `read`
(null on a miss), `delete`, `list(prefix)` and `uploaded(prefix)`, which maps
each key to the moment it landed so a sweep can spare what was written a moment
ago. `list` and `uploaded` read every page of the listing.

## Reading it back

`blobRead(vocab, layout?)` produces `@yaks/sql` derived read overrides. Pass
these to `storage(..., { derived })` so both predicates and returned properties
use the text. It requires a SQL-accessible text table such as `sqliteBlobs`; it
cannot read an external directory or bucket inside a query.

`hydrate(vocab, store, bundles)` fetches marked values after a read and returns
bundles containing text. It returns a promise only when the backend does. If an
address is missing, it leaves the stored reference in place. Hydration alone
does not make SQL predicates on externally stored text work.

## Indexing the text

An FTS index built directly from a blob-backed property would index addresses.
Supply text-resolution expressions when creating the index:

```ts
import { fields, schema } from '@yaks/fts'
import { blobRead } from '@yaks/blob'

for (let statement of schema(fields(vocab), blobRead(vocab))) {
  driver.query(statement)
}
```

`blobRead()` maps `component.property` to two @yaks/sql expressions:
`expr(owner)` reads the text through the owner's row, for ordinary reads, and
`text(stored)` turns an address already in hand into its text, for the
delete/update triggers that must read the old value and for `@yaks/sqlite`'s
`doc_value` view. Triggers and the FTS content view resolve the same text, so
graph writes, direct SQL writes and index rebuilds use consistent content. Store
the content before inserting a referencing component row. For existing
rows/indexes, use `@yaks/fts`'s `heal()` or `adopt()` as appropriate.

## Binary files

`artifactStore(store)` returns a function accepting `(bytes, mediaType)` and
resolving to `{ address, media_type, size }` after storing and verifying the
bytes:

```ts
import { artifactStore, fileBlobs } from '@yaks/blob'

let save = artifactStore(fileBlobs('/var/lib/blobs'))
let artifact = await save(new Uint8Array([0, 255]), 'application/octet-stream')
```

`artifactBytes(store, artifact)` reads the bytes an artifact row names back:
`undefined` when the store holds nothing under its address, and an error when
the bytes it holds are another size or another SHA-256.

Use a file or object store for arbitrary binary content.
`keep(store, address,
bytes)` performs the store-and-read-back check directly. A
matching existing object needs no write; mismatched bytes cause another write
and a verification failure throws. A backend that cannot overwrite corrupt
content may still fail that repair.

`sizeOf(bytes)` reads `{ w, h }` from PNG, JPEG, GIF and WebP headers without
bitmap decoding. Unsupported or invalid headers, including zero dimensions,
return `undefined`. `mediaTypeOf(bytes)` names the same four formats from their
signatures (`image/png`, `image/jpeg`, `image/gif`, `image/webp`), and
`undefined` for anything else.

`served(bytes, { mime?, name? })` creates an HTTP response with immutable
one-year public caching, `content-security-policy: sandbox; script-src 'none'`,
`x-content-type-options: nosniff`, and optional inline filename disposition.
Scripts are blocked; the policy does not mean an HTML or SVG document cannot
render. Use this response for immutable content addressed by its bytes.

`artifactDoc` declares `artifact { address, media_type, size }` and an
`attachment` component referencing an artifact. An attachment can also record
the provider call ID and revised prompt associated with generation.

## The HTTP endpoints

`@yaks/blob/routes` exports `routes(host, options)` for plugin servers such as
[`yak serve`](../cli/README.md). It mounts `/blob/<sha256>`:

- `GET` returns bytes using `served()`. If an artifact entity with that address
  as its eid exists, its media type is used; otherwise it uses
  `application/octet-stream`. Invalid addresses and missing objects return 404.
  The route itself performs no authentication check.
- `PUT` requires 64 lowercase hex digits and bytes hashing to that address;
  either mismatch returns 400. It counts streamed body bytes and returns 413
  above the configured limit. It records a normalized media type from
  `content-type` and returns artifact metadata as JSON.

An upload first checks its proposed artifact write with
`graph.apply(...,
{ check: true })`, then stores/verifies bytes, then applies
the artifact write. The graph's write rules determine whether the artifact is
allowed. `host.who`, when configured, supplies actor attribution as it does for
`/apply`. This route adds no separate upload permission policy.

If the final graph write fails, stored content may remain without an artifact
entity. Repeating a successful upload uses the same address and entity ID.

```json
{
  "use": "@yaks/blob",
  "with": {
    "store": { "via": "file", "dir": "/var/lib/blobs" },
    "limit": 26214400
  }
}
```

`limit` defaults to 25 MiB (`LIMIT`). The routes use these backends:

- `{ "via": "sqlite" }`: the default text table; rejects invalid UTF-8 uploads.
- `{ "via": "file", "dir": "..." }`: a directory for binary or text uploads.
- `{ via: 'object', bucket, prefix? }`: an object-store binding supplied in
  code, not serializable JSON configuration.

These route options choose the upload/download backend. The `rules` sub-module
keeps marked graph text properties in the host's blob store (`host.blobs`, a
table in the server's database). Missing `dir`, missing `bucket` or an unknown
backend logs a reason and returns no routes.

## Bounded text inspection for tools

`valueTools(readEntity)` returns provider-neutral `graph_value_read` and
`graph_value_search` tool declarations with executable `run` functions. Supply
the authorized entity reader used by the application's other graph tools. These
tools accept entity/component/property names, not filesystem paths or raw blob
addresses, and work with any string property.

Both take `entity`, `component` and `property`. Optional `revision` must match
the SHA-256 of the current UTF-8 text. Missing, denied or non-text values fail.

- Read uses a zero-based Unicode code-point `start`. `count` defaults to 2048,
  with a maximum of 8192 (`VALUE_LIMIT`). Results contain `start`, `end`,
  `total`, `revision`, `text` and `next` (null at the end). An additional
  escaped-JSON bound can shorten the returned text.
- Search uses a nonempty, case-sensitive literal `query` of at most 256 UTF-16
  code units. `start` skips earlier characters; `limit` defaults to 10 and is at
  most 20. Matches contain offsets and excerpts. `next` is a continuation offset
  when the match limit was reached, even if no further match exists.

Offsets count code points, not grapheme clusters or terminal columns. Both tools
read the entire value before slicing/searching; only the output is bounded.

## What it does not do

There is no garbage collection for unreferenced content. Applications own
retention and backups, including separate file or object stores. A database
backup alone cannot restore external bytes.

Removing the plugin leaves stored addresses and content intact, but ordinary
reads need the configured resolver to return text. The underlying table/file
format remains accessible to application code.

## Exports

| Root export                                                          | Purpose                                                  |
| -------------------------------------------------------------------- | -------------------------------------------------------- |
| `blobKeywords`, `BLOB_URI`                                           | Register the `store` keyword                             |
| `bodies`, `isBody`                                                   | Select marked properties                                 |
| `blobs`, `BlobOpts`, `Reference`                                     | Graph write plugin and optional stored-reference mapping |
| `Blobs`, `address`, `encode`, `decode`                               | Store interface and text addressing                      |
| `sqliteBlobs`, `blobSchema`, `Layout`                                | SQLite text storage                                      |
| `fileBlobs`, `objectBlobs`, `Bucket`                                 | Filesystem and object storage                            |
| `Objects`, `bucketObjects`                                           | A bucket keyed by name: read, delete, list               |
| `blobRead`, `hydrate`                                                | SQL and post-read text resolution                        |
| `addressOf`, `keep`, `artifactStore`, `artifactBytes`, `artifactDoc` | Artifact storage, verified reads and declarations        |
| `sizeOf`, `mediaTypeOf`, `served`                                    | Image dimensions and formats, and HTTP responses         |
| `valueTools`, `VALUE_LIMIT`, `ValueTool`                             | Bounded text-inspection tools                            |

| Sub-module export   | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `@yaks/blob/vocab`  | `docs`, `keywords`, `derived` and declaration/read helpers  |
| `@yaks/blob/rules`  | `rules(host)`: the graph plugin over the host's blob store  |
| `@yaks/blob/routes` | `routes(host, options)`, backend helpers and route settings |

## Composition

The package extends `@yaks/vocab` with a keyword, `@yaks/graph` with write
hooks, and `@yaks/sql` with derived read expressions. Full-text indexing is
provided by `@yaks/fts` or the document index in `@yaks/sqlite`.

## Compatibility

The core keyword, plugin and SQLite store use no platform-specific storage API.
They work wherever the supplied driver and required standard web APIs work. The
bundled filesystem adapter specifically requires Deno filesystem functions; use
another `Blobs` implementation for Node, browsers or Workers without them.
