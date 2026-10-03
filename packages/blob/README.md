# @yaks/blob

Stores text and binary content under SHA-256 addresses, with transparent graph
text reads and writes, verified artifacts and HTTP responses. Text lives in a
separate table, directory or object store, and identical values share content.

An **address** is the lowercase hexadecimal SHA-256 of content's bytes, such as
`address('hello')`. A **body** is a string
[property](../graph/README.md#data-model) marked `store: 'blob'` in the
[vocabulary](../vocab/README.md#vocabulary). A **Blobs** store holds bytes under
their addresses and exposes `has`, `get` and `put`; these methods may return
values or promises.

An **artifact** describes stored bytes with `{ address, media_type, size }`. A
**representation** fixes how an address is served: its scope, media type and
optional filename determine its immutable identity and URL. An **attachment** is
a [component](../graph/README.md#data-model) referencing an artifact, with
optional filename, audience and generation metadata.

Graph writes use [bundles and transactions](../graph/README.md#data-model); this
package supplies a [plugin](../graph/README.md#data-model) that stores bodies.

## Install

```sh
deno add jsr:@yaks/blob
# or: npx jsr add @yaks/blob
```

## Store a body

Register `blobKeywords` when loading the vocabulary, then configure the write
plugin and SQL read expressions on the same SQLite driver. Without that keyword
registration, `bodies()` returns no bodies and the plugin leaves text unchanged:

```ts
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { graph } from '@yaks/graph'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import {
  address,
  blobKeywords,
  blobRead,
  blobs,
  blobSchema,
  bodies,
  sqliteBlobs,
} from '@yaks/blob'

let post = {
  component: true,
  type: 'object',
  properties: { body: { type: 'string', store: 'blob' } },
}
let vocab = loadVocab([{ $defs: { post } }], [blobKeywords])
equal(bodies(vocab), [{ comp: 'post', prop: 'body' }])
let driver = open(':memory:')
let bytes = sqliteBlobs(driver)
let store = storage(driver, vocab, { derived: blobRead(vocab) })
for (let statement of [...store.ddl(), ...blobSchema()]) driver.query(statement)
let g = graph({ storage: store, vocab, plugins: [blobs(vocab, bytes)] })

g.apply([{ entity: { eid: 'p1' }, post: { body: 'A long essay.' } }])
equal(store.read('.post')[0].post, { body: 'A long essay.' })
equal(
  new TextDecoder().decode(bytes.get(address('A long essay.'))!),
  'A long essay.',
)
```

The component table contains the address; `blob_text` contains the text. Both
use the same driver so their writes participate in the same transaction.

## Exports

| Root export                                                                                       | Purpose                                                  |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `blobKeywords`, `BLOB_URI`                                                                        | Register the `store` keyword                             |
| `Body`, `bodies`, `isBody`                                                                        | Select marked properties                                 |
| `blobs`, `BlobOpts`, `Reference`                                                                  | Graph write plugin and optional stored-reference mapping |
| `Blobs`, `memoryBlobs`, `address`, `encode`, `decode`                                             | Store interface and text addressing                      |
| `sqliteBlobs`, `blobSchema`, `Layout`                                                             | SQLite text storage                                      |
| `fileBlobs`, `objectBlobs`, `Bucket`                                                              | Filesystem and object storage                            |
| `Objects`, `Opened`, `Loaded`, `bucketObjects`                                                    | A bucket keyed by name: read, delete, list               |
| `blobRead`, `hydrate`                                                                             | SQL and post-read text resolution                        |
| `Artifact`, `ArtifactStore`, `addressOf`, `keep`, `artifactStore`, `artifactBytes`, `artifactDoc` | Artifact storage, verified reads and declarations        |
| `Size`, `sizeOf`, `mediaTypeOf`, `contentType`, `mediaType`, `matchesMediaType`, `mimeOf`         | Image dimensions, signatures and media types             |
| `Served`, `served`, `servedOpen`, `servedVia`, `ranged`, `rangedOpen`, `validator`                | HTTP responses, streaming and validators                 |
| `Representation`, `representation`, `represents`, `addressed`, `representations`                  | Immutable representations and their graph plugin         |
| `Backend`, `backend`, `artifactsAt`                                                               | Configured and default artifact backends                 |
| `valueTools`, `VALUE_LIMIT`, `ValueTool`                                                          | Bounded text-inspection tools                            |

| Sub-module export   | Purpose                                                      |
| ------------------- | ------------------------------------------------------------ |
| `@yaks/blob/vocab`  | `docs`, `keywords`, `derived` and declaration/read helpers   |
| `@yaks/blob/graph`  | `plugins(host)`: the graph plugin over the host's blob store |
| `@yaks/blob/routes` | `routes(host, options)`, backend helpers and route settings  |

## Addresses

`address(text)` computes the lowercase hexadecimal SHA-256 of UTF-8 text
synchronously using `@yaks/graph`'s digest. `addressOf(bytes)` computes the same
kind of address for arbitrary bytes using asynchronous `crypto.subtle.digest`.
`encode()` and `decode()` convert between strings and UTF-8 bytes.

The low-level store interface expects a valid address supplied by the caller; it
does not itself prove that bytes match that address. `artifactStore()` computes
addresses, and `keep()` verifies stored content. Use these helpers when storing
binary artifacts rather than assuming every backend validates keys and data.

```ts
import { equal } from '@yaks/testing'
import { address, addressOf, decode, encode, memoryBlobs } from '@yaks/blob'

let bytes = encode('Hello')
let sha = address('Hello')
equal(await addressOf(bytes), sha)
let store = memoryBlobs()
store.put(sha, bytes)
equal(store.has(sha), true)
equal(decode(store.get(sha)!), 'Hello')
```

## When the swap happens

A **Reference** is a function that translates an address into the value a
component row holds, usually the address itself; `BlobOpts.reference` can
instead supply an integer key. `BlobOpts.props` narrows the bodies the plugin
handles.

The plugin replaces each body with the value its Reference returns during
`precondition`, inside the transaction and after the graph's `$was` guard checks
the text the caller read. It restores text in the bundles returned from
`apply()` during `commit`.

External stores keep their content during `prepare`, before the graph takes its
write lock. Preparation leaves text intact for the guard and carries the results
of Reference on the bundles. A later graph failure or dry run can leave
unreferenced content in these stores, as their writes cannot roll back with the
graph.

`sqliteBlobs` declares `transactional: true`: its inserts stay in `precondition`
and commit or roll back with the component rows on the same active connection.
`mutate` hooks run after storage has received component rows, too late to swap.

```ts
import { equal } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { blobKeywords, blobs, memoryBlobs } from '@yaks/blob'

let body = { type: 'string', store: 'blob' }
let post = {
  component: true,
  type: 'object',
  properties: { body, caption: body },
}
let vocab = loadVocab([{ $defs: { post } }], [blobKeywords])
let db = ram(vocab)
let plugin = blobs(vocab, memoryBlobs(), {
  props: [{ comp: 'post', prop: 'body' }],
  reference: () => 7,
})
let g = graph({ storage: db, vocab, plugins: [plugin] })
let [written] = await g.apply([
  { entity: { eid: 'p1' }, post: { body: 'Essay', caption: 'Caption' } },
])
equal(written.post, { body: 'Essay', caption: 'Caption' })
equal((await db.read('.post'))[0].post, { body: 7, caption: 'Caption' })
```

A custom Reference needs a matching read resolver; `hydrate()` resolves
addresses, while `blobRead()` resolves the keys in its Layout.

## Blobs stores

Methods can return values or promises. Synchronous storage preserves synchronous
graph writes; an asynchronous backend makes those writes asynchronous.

| Backend                        | Storage                                       | Return style |
| ------------------------------ | --------------------------------------------- | ------------ |
| `sqliteBlobs(driver, layout?)` | A SQL table, default `blob_text(sha, value)`  | Synchronous  |
| `fileBlobs(dir)`               | One file per address at `<dir>/<sha>`         | Asynchronous |
| `objectBlobs(bucket, prefix?)` | Objects accessed through `head`, `get`, `put` | Asynchronous |
| `memoryBlobs()`                | This process's memory, while it runs          | Synchronous  |

`sqliteBlobs` stores text and rejects bytes that are not valid UTF-8. Its
inserts use `insert or ignore`. `blobSchema(layout?)` returns its DDL
statements. A **Layout** names the SQL table and columns holding body text. It
can rename `table`, `key` and `value`, whose defaults are `blob_text`, `sha` and
`value`. Existing tables must have the matching shape.

`fileBlobs` uses `globalThis.Deno` filesystem functions. It creates the
directory on the first write; writes fail without those functions, while reads
return `undefined` on filesystem errors. Pass only validated SHA-256 addresses
to this low-level adapter: it joins the supplied key directly to the directory
path.

A **Bucket** supplies object storage operations (`head`, `get`, `put`, `delete`
and `list`). `objectBlobs` accepts its `head`, `get` and `put` methods.
Cloudflare R2 bindings satisfy that interface; other object storage clients may
need a wrapper. Its `open(sha)` reads object metadata first, then streams only a
requested byte span. The package imports no cloud SDK.

`bucketObjects(bucket)` is the same bucket keyed by name rather than by content:
an **Objects** store whose caller chooses each key, as a host does for an app's
files. Besides `has`, `put` and `get` (which throws on a miss) it has `read`
(null on a miss), `load` (bytes and a validator in one read), `open` (metadata
then a streamed span), `delete`, `list(prefix)` and `uploaded(prefix)`, which
maps each key to when it landed. `list` and `uploaded` read every page.

The following in-memory bucket shows both interfaces without a cloud account. An
**Opened** object is metadata (`size`, `version`) with a `read(range?)` function
that streams bytes on demand; **Loaded** is bytes and their version returned
together.

```ts
import { equal } from '@yaks/testing'
import {
  address,
  type Bucket,
  bucketObjects,
  encode,
  objectBlobs,
} from '@yaks/blob'

let held = new Map<string, Uint8Array<ArrayBuffer>>()
let bucket: Bucket = {
  head: async (key) =>
    held.has(key) ? { size: held.get(key)!.length, etag: 'v1' } : null,
  get: async (key, options) => {
    let bytes = held.get(key)
    if (!bytes) return null
    let start = options?.range.offset ?? 0
    let part = bytes.slice(
      start,
      options ? start + options.range.length : undefined,
    )
    return {
      etag: 'v1',
      body: new Response(part).body!,
      arrayBuffer: async () => part.buffer,
    }
  },
  put: async (key, value) => {
    held.set(key, new Uint8Array(value as Uint8Array))
  },
  delete: async (key) => {
    held.delete(key)
  },
  list: async ({ prefix }) => ({
    truncated: false,
    objects: [...held].filter(([key]) => key.startsWith(prefix))
      .map(([key, bytes]) => ({
        key,
        size: bytes.length,
        uploaded: new Date(0),
      })),
  }),
}
let blobs = objectBlobs(bucket, 'bodies/')
await blobs.put(address('Hi'), encode('Hi'))
equal(await blobs.get(address('Hi')), encode('Hi'))
let files = bucketObjects(bucket)
await files.put('page.txt', encode('Hello'))
equal(await files.list('page'), ['page.txt'])
equal(await files.uploaded('page'), { 'page.txt': 0 })
equal((await files.load('page.txt'))!.version, 'v1')
let opened = (await files.open('page.txt'))!
equal(await new Response(await opened.read({ from: 1, to: 3 })).text(), 'ell')
await files.delete('page.txt')
equal(await files.read('page.txt'), null)
```

## Reading it back

`blobRead(vocab, layout?)` produces `@yaks/sql` derived read overrides. Pass
these to `storage(..., { derived })` so both predicates and returned properties
use the text. It requires a SQL-accessible text table such as `sqliteBlobs`; it
cannot read an external directory or bucket inside a query.

`hydrate(vocab, store, bundles)` fetches marked values after a read and returns
bundles containing text. It returns a promise only when the backend does. If an
address is missing, it leaves the address in place. Hydration alone does not
make SQL predicates on externally stored text work.

```ts
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { address, blobKeywords, encode, hydrate, memoryBlobs } from '@yaks/blob'

let post = {
  component: true,
  type: 'object',
  properties: { body: { type: 'string', store: 'blob' } },
}
let vocab = loadVocab([{ $defs: { post } }], [blobKeywords])
let store = memoryBlobs()
store.put(address('Hello'), encode('Hello'))
let [bundle] = await hydrate(vocab, store, [
  { entity: { eid: 'p1' }, post: { body: address('Hello') } },
])
equal(bundle.post, { body: 'Hello' })
```

## Indexing the text

A [full-text index](../fts/README.md) built directly from a body would index
addresses. Supply text-resolution expressions when creating the index:

```ts
import { loadVocab } from '@yaks/vocab'
import { open } from '@yaks/sqlite/db'
import { storage } from '@yaks/sqlite'
import { fields, find, schema } from '@yaks/fts'
import { graph } from '@yaks/graph'
import { equal } from '@yaks/testing'
import {
  blobKeywords,
  blobRead,
  blobs,
  blobSchema,
  sqliteBlobs,
} from '@yaks/blob'

let post = {
  component: true,
  type: 'object',
  properties: { body: { type: 'string', store: 'blob', search: true } },
}
let vocab = loadVocab([{ $defs: { post } }], [blobKeywords])
let driver = open(':memory:')
let db = storage(driver, vocab, { derived: blobRead(vocab) })
for (let statement of [...db.ddl(), ...blobSchema()]) {
  driver.query(statement)
}
for (let statement of schema(fields(vocab), blobRead(vocab))) {
  driver.query(statement)
}
let g = graph({
  storage: db,
  vocab,
  plugins: [blobs(vocab, sqliteBlobs(driver))],
})
g.apply([{ entity: { eid: 'p1' }, post: { body: 'orchard' } }])
equal(find(driver, fields(vocab), 'orchard').map((hit) => hit.entity), ['p1'])
```

`blobRead()` maps `component.property` to two @yaks/sql expressions:
`expr(owner)` reads the text through the owner's row, for ordinary reads, and
`text(stored)` turns an address already in hand into its text, for the
delete/update triggers that must read the old value and for `@yaks/sqlite`'s
`doc_value` view. Triggers and the FTS content view resolve the same text, so
graph writes, direct SQL writes and index rebuilds use consistent content. Store
the content before inserting a referencing component row. For existing rows and
indexes, see [@yaks/fts](../fts/README.md).

## Binary files

`artifactStore(store)` returns a function accepting `(bytes, mediaType)` and
resolving to `{ address, media_type, size }` after storing and verifying the
bytes. Known binary signatures determine the media type. Text with valid UTF-8
keeps a valid declared type; unknown bytes use `application/octet-stream`:

```ts
import { equal } from '@yaks/testing'
import { artifactBytes, artifactStore, fileBlobs } from '@yaks/blob'

let dir = await Deno.makeTempDir()
try {
  let store = fileBlobs(dir)
  let bytes = new Uint8Array([0, 255])
  let artifact = await artifactStore(store)(bytes, 'application/octet-stream')
  equal(artifact.size, 2)
  equal(await artifactBytes(store, artifact), bytes)
} finally {
  await Deno.remove(dir, { recursive: true })
}
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

## Attachments

`artifactDoc` declares `artifact { address, media_type, size }` and an
`attachment` component referencing an artifact. An attachment can also record
the provider call ID and revised prompt associated with generation.

```ts
import { equal } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { artifactDoc, artifactStore, encode, memoryBlobs } from '@yaks/blob'

let vocab = loadVocab([artifactDoc])
let g = graph({ storage: ram(vocab), vocab })
let artifact = await artifactStore(memoryBlobs())(encode('Hello'), 'text/plain')
await g.apply([
  { entity: { eid: artifact.address }, artifact },
  {
    entity: { eid: 'a1' },
    attachment: { artifact: artifact.address, name: 'hello.txt' },
  },
])
equal((await g.read('.attachment'))[0].attachment, {
  artifact: artifact.address,
  name: 'hello.txt',
})
```

## Image headers and media types

`sizeOf(bytes)` reads `{ w, h }` from PNG, JPEG, GIF and WebP headers without
bitmap decoding. Unsupported or invalid headers, including zero dimensions,
return `undefined`. `mediaTypeOf(bytes)` names the same four formats from their
signatures (`image/png`, `image/jpeg`, `image/gif`, `image/webp`), and
`undefined` for anything else.

```ts
import { equal } from '@yaks/testing'
import { contentType, encode, mediaTypeOf, mimeOf, sizeOf } from '@yaks/blob'

let gif = new Uint8Array([...encode('GIF89a'), 2, 0, 3, 0])
equal(sizeOf(gif), { w: 2, h: 3 })
equal(mediaTypeOf(gif), 'image/gif')
equal(await contentType(gif, 'text/plain'), 'image/gif')
equal(await contentType(encode('<svg/>'), 'image/svg+xml'), 'image/svg+xml')
equal(mimeOf('report.pdf'), 'application/pdf')
```

## HTTP responses

`served(bytes, { mime?, name?, etag?, cache? }, request)` creates a byte-range
capable HTTP response with `x-content-type-options: nosniff` and an optional
inline filename disposition. Documents keep
`content-security-policy: sandbox;
script-src 'none'`; audio and video keep
their origin with `script-src 'none'` so a browser's native player can fetch
them. A mutable response revalidates. A versioned public response can use
`cache: 'immutable'` for a one-year cache; an app response can use `revalidate`
or `private` so access changes take effect. `validator(address, meta)` makes the
ETag for bytes and metadata. Scripts are blocked; the policy does not mean an
HTML or SVG document cannot render. `ranged(bytes, request, headers)` serves the
same byte-range behavior when a caller supplies its own response headers.
`servedOpen` and `rangedOpen` accept an opened object and stream the selected
span without loading the whole file; conditional responses and HEAD need no body
read. `mimeOf(name)` gives deployed files and named uploads one media type
lookup. `servedVia(read, meta, request)` applies the same headers and
conditional handling when a cache or another store supplies the byte response.

```ts
import { equal } from '@yaks/testing'
import {
  address,
  encode,
  ranged,
  served,
  servedOpen,
  servedVia,
  validator,
} from '@yaks/blob'

let bytes = encode('Hello')
let meta = { mime: 'text/plain', etag: await validator(address('Hello'), {}) }
let request = new Request('https://blob.invalid/', {
  headers: { range: 'bytes=1-3' },
})
let response = served(bytes, meta, request)
equal(response.status, 206)
equal(await response.text(), 'ell')
let streamed = await servedOpen(
  {
    size: bytes.length,
    version: 'v1',
    read: async (range) =>
      new Response(range ? bytes.slice(range.from, range.to + 1) : bytes).body!,
  },
  meta,
  request,
)
equal(await streamed.text(), 'ell')
let unchanged = served(
  bytes,
  meta,
  new Request('https://blob.invalid/', {
    headers: { 'if-none-match': meta.etag },
  }),
)
equal(unchanged.status, 304)
let forwarded = await servedVia(
  async (request) => ranged(bytes, request),
  meta,
  request,
)
equal(forwarded.status, 206)
equal(await forwarded.text(), 'ell')
```

## The HTTP endpoints

`@yaks/blob/routes` exports `routes(host, options)` for plugin servers such as
[`yak serve`](../cli/README.md). It mounts `/blob/<sha256>` and
`/blob/<sha256>/<representation>`:

- A bare `GET` or `HEAD` redirects to the current representation and
  revalidates. An address without a representation gets one on first read.
- A versioned `GET` or `HEAD` returns bytes and immutable media type and
  filename headers. Public responses cache for one year. Invalid addresses and
  missing objects return 404. The route itself performs no authentication check.
- `PUT` requires 64 lowercase hex digits and bytes hashing to that address;
  either mismatch returns 400. It counts streamed body bytes and returns 413
  above the configured limit. It records a normalized media type from
  `content-type` when the bytes are text, identifies known binary signatures,
  and returns artifact metadata as JSON with the versioned URL in `Location`.

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

`limit` defaults to 25 MiB (`LIMIT`). A composed `yak` host gives the route and
the harness the same artifact store. By default, a file-backed graph keeps
binary artifacts in `images/` beside its database; an in-memory graph keeps them
in memory. The plugin's `store` option changes that store for both. Graph text
properties remain in the SQLite text table. Standalone routes without a host
artifact store use their `store` option or the SQLite default.

The routes use these backends:

- `{ "via": "sqlite" }`: the default text table; rejects invalid UTF-8 uploads.
- `{ "via": "file", "dir": "..." }`: a directory for binary or text uploads.
- `{ via: 'object', bucket, prefix? }`: an object-store binding supplied in
  code, not serializable JSON configuration.

The `graph` sub-module keeps marked graph text properties in the host's blob
store (`host.blobs`, a table in the server's database). A composed host refuses
an invalid artifact backend at startup; standalone routes log the reason and
mount no routes.

The representation plugin refuses changes and deletions to representations.
`representation()` derives their identities; `represents()` verifies them. The
`graph` sub-module registers this plugin alongside the body plugin.

```ts
import { equal } from '@yaks/testing'
import { representation, represents } from '@yaks/blob'

let fixed = representation(
  'blob',
  'a'.repeat(64),
  'TEXT/PLAIN; charset=utf-8',
  'notes.txt',
)
equal(represents(fixed.eid, fixed.row), true)
equal(fixed.row.media_type, 'text/plain')
equal(fixed.path, `${'a'.repeat(64)}/${fixed.eid}`)
equal(represents(fixed.eid, { ...fixed.row, name: 'other.txt' }), false)
```

The endpoints can be exercised through their route handlers without starting a
server. The supplied graph registers the package's rules and declarations.

```ts
import { equal } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { open } from '@yaks/sqlite/db'
import { address, blobSchema, encode, memoryBlobs } from '@yaks/blob'
import { docs, keywords } from '@yaks/blob/vocab'
import { plugins } from '@yaks/blob/graph'
import { routes } from '@yaks/blob/routes'

let vocab = loadVocab(docs, keywords)
let sql = open(':memory:')
let db = storage(sql, vocab)
for (let statement of [...db.ddl(), ...blobSchema()]) sql.query(statement)
let bytes = memoryBlobs()
let g = graph({ storage: db, vocab, plugins: plugins({ vocab, blobs: bytes }) })
let table = routes({ sql, graph: g, artifacts: bytes })
let upload = table.find((route) => route.method == 'PUT')!
let read = table.find((route) => route.method == 'GET')!
let url = `https://blob.invalid/blob/${address('Hello')}`
let response = await upload.handle(
  new Request(url, {
    method: 'PUT',
    body: encode('Hello'),
    headers: { 'content-type': 'text/plain' },
  }),
)
equal(response.status, 200)
equal((await response.json()).size, 5)
let versioned = new URL(response.headers.get('location')!, url)
equal((await read.handle(new Request(url))).status, 302)
equal(await (await read.handle(new Request(versioned))).text(), 'Hello')
```

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

```ts
import { equal } from '@yaks/testing'
import { address, valueTools } from '@yaks/blob'

let tools = valueTools(async (eid) =>
  eid == 'p1' ? { entity: { eid }, post: { body: 'A 🌳 tree' } } : undefined
)
let args = {
  entity: 'p1',
  component: 'post',
  property: 'body',
  revision: address('A 🌳 tree'),
}
let read = tools.find((tool) => tool.name == 'graph_value_read')!
let slice = JSON.parse(await read.run({ ...args, start: 2, count: 1 }))
equal(slice.text, '🌳')
equal(slice.next, 3)
let search = tools.find((tool) => tool.name == 'graph_value_search')!
let result = JSON.parse(await search.run({ ...args, query: 'tree' }))
equal(result.matches[0].offset, 4)
```

## Limits

There is no garbage collection for unreferenced content. Applications own
retention and backups, including separate file or object stores. A database
backup alone cannot restore external bytes.

Removing the plugin leaves stored addresses and content intact, but ordinary
reads need the configured resolver to return text. The underlying table/file
format remains accessible to application code.

## Compatibility

The core keyword, plugin and SQLite store use no platform-specific storage API.
They work wherever the supplied driver and required standard web APIs work. The
bundled filesystem adapter specifically requires Deno filesystem functions; use
another Blobs implementation for Node, browsers or Workers without them.
