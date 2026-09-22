# @yaks/page

Store web page URLs and archived HTML in a [@yaks/graph](../graph/README.md), so
recorded sources can still be read after the original page changes or
disappears. Use it to save HTML captured in a browser or to archive URLs with an
external command.

The graph's storage adapter stores the `web` component:

| Column      | Meaning                                                               |
| ----------- | --------------------------------------------------------------------- |
| `url`       | Canonical page URL, used to derive the entity id.                     |
| `frozen_at` | When the archive was stored; absent until a capture is saved.         |
| `bytes`     | SHA-256 key for the HTML in an [@yaks/blob](../blob/README.md) store. |

`frozen_at` and `bytes` are server-owned columns. Ordinary client writes cannot
set them. Page titles and prose use the separate `doc` component from
[@yaks/doc](../doc/README.md). This package stores the latest archive reference
on each page entity; it does not maintain a list of snapshots.

## Install

```sh
deno add jsr:@yaks/page
# or: npx jsr add @yaks/page
```

## Use

For a graph that records URLs without fetching them:

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc, docs } from '@yaks/doc'
import { pageDoc, pageEid, pages } from '@yaks/page'

let vocab = loadVocab([docDoc, pageDoc])
let g = graph({ storage: ram(vocab), vocab, plugins: [docs(), pages()] })
let url = 'https://example.com/article'

await g.apply([{
  entity: { eid: pageEid(url) },
  web: { url },
  doc: { title: 'An article' },
}])
console.log(await g.read('.web'))
```

Each object passed to `apply()` is a **bundle**: one entity's components as a
JSON object. A **batch** is a list of changes applied in one transaction. The
example uses memory storage; replace it with a persistent graph storage adapter
to keep records across restarts.

## The address is the identity

`web.url` is declared `identity`, so the graph can derive a page's entity id
from its canonical URL when creating it under an alias. `pageEid()` computes
that same id directly:

```ts
import { canon, pageEid } from '@yaks/page'

canon('HTTPS://Example.com/a/?utm_source=n#top') // 'https://example.com/a'
pageEid('https://example.com/a/') == pageEid('https://example.com/a') // true
```

`pages()` normalizes URLs before the graph assigns ids. Use an alias or
`pageEid(url)` when creating a page so repeated records of the same URL update
one entity. Normalization removes fragments, credentials, recognized tracking
parameters, and trailing slashes from non-root paths. Other query parameters
retain their order. These are this package's identity rules; URLs that differ
only in these ways are treated as one page.

All inputs are trimmed. Invalid and non-HTTP(S) URLs are otherwise left alone by
`canon()`. Automatic fetching and `POST /page` accept only HTTP(S) addresses.

## HTML processing

Before saving HTML, `scrub()` parses it with `linkedom` and removes scripts,
`base`, embedded documents (`iframe`, `frame`, `embed`, `object`), meta refresh,
and inline event handlers. It removes `link` elements unless their `href` starts
with `data:`. It also removes external values from the URL attributes listed in
[scrub.ts](./scrub.ts), including `src`, `href`, `srcset`, and form actions;
`data:`, fragment, and `about:` values are retained.

CSS `url()` references are emptied except for embedded `data:` values. This is a
specific set of HTML and CSS transformations, not a complete CSS sanitizer: for
example, quoted CSS `@import` rules are not removed. Served archives also
receive a restrictive Content-Security-Policy from `@yaks/blob`; that header is
not present when someone opens a copied HTML file directly.

`froze(page, html, { blobs, now? })` scrubs and stores the HTML, then returns
the changes to apply with `{ trusted: true }`. It derives the blob key from the
stored HTML's SHA-256, so identical stored documents use the same key. It adds
the HTML title only if the page has no `doc` component.

## Two ways the bytes arrive

With the route module loaded, a browser or extension can post the document it
already has, including content available only after login or script execution:

```sh
curl -X POST http://localhost:8000/page \
  -H 'content-type: application/json' -d '{
  "url": "https://example.com/article",
  "title": "An article",
  "html": "<html><head><title>An article</title></head><body>Saved text</body></html>"
}'
```

`url` is required. `title` and `html` are optional. The response is the JSON
array returned by `graph.apply()`. HTML is scrubbed and stored before its hash
and a server timestamp are written to the entity. The request cannot set the
capture timestamp. A supplied title takes precedence over the HTML title when
the page has no `doc` component; an existing document is preserved.

For URL-only records, the optional `created('web')` effect calls the configured
archiver after the transaction commits. It skips entities that already have
`web.bytes` and non-HTTP(S) URLs. A failed capture is reported by the effects
registry without rolling back the URL record. The effect is awaited, so a slow
capture can delay the caller even though the transaction has already committed.

Both paths use the same HTML processing and blob storage. No archiver is
configured by default, so URL-only records remain unarchived until an
application supplies HTML or arranges a capture.

## What each entry point exports

The root import `@yaks/page` provides `pageDoc`, `WEB`, `pages()`, `canon()`,
`pageEid()`, `fetchable()`, `scrub()`, `froze()`, `freezing()`, `archiver()`,
and `blobsOf()`, plus the types `Scrubbed`, `Archive`, `Keep`, `Capture`,
`Options`, and `Run`.

A **host** is the process that opened the graph, represented here by an object
containing the services a function uses. `effects()` and `blobsOf()` need a
SQLite `sql` driver; `routes()` also needs `graph` and `storage`.

The server loader uses these separate sub-module exports:

| Import               | Exports                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| `@yaks/page/vocab`   | `pageDoc` and `docs`, the `web` vocabulary document and its one-item array.             |
| `@yaks/page/rules`   | `rules()`, returning the graph plugin and its normalization hook.                       |
| `@yaks/page/effects` | `effects(host, options)`, returning an archive handler when configured; also `Options`. |
| `@yaks/page/routes`  | `routes(host, options)`, `PREFIX`, and `Filing` for `POST /page` and `GET /page/<eid>`. |

A plugin entry in a `yak serve` configuration can be:

```json
{
  "use": "@yaks/page",
  "with": {
    "archive": {
      "run": ["monolith", "-j", "-f", "-I", "-q", "{url}"],
      "timeout": 60000
    },
    "bytes": "/var/lib/yak/frozen"
  }
}
```

`archive.run` names the command and arguments. Each `{url}` in an argument is
replaced with the URL; if no argument contains it, the URL is appended. The
command must write HTML to stdout. Nonzero exit status, empty output, or timeout
fails the capture. The default timeout is 60,000 milliseconds. Install the
command separately; this package does not include it.

`bytes` selects a directory for archived HTML. Omit it to use the host's SQLite
blob table, which `blobsOf()` creates if needed. A directory can keep large HTML
documents outside the graph database. `GET /page/<eid>` reads from the
configured store in either case. A separately configured `GET /blob/<sha>` route
can serve the same bytes only if it uses the same store.

`GET /page/<eid>` returns HTML with a sandbox Content-Security-Policy that
blocks scripts, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-cache`
because a later capture can replace the page's archive reference. It adds
`Memento-Datetime` from `frozen_at` and `Link: <url>; rel="original"` from
`url`, using the archive metadata headers defined by RFC 7089. Missing pages,
missing archives, and invalid entity ids return 404.

## What this package does not own

Load [@yaks/doc](../doc/README.md) alongside this package for
`doc{title, body}`; it is not redeclared here. [@yaks/blob](../blob/README.md)
supplies byte storage. Source-code references with paths and a Git commit id use
`anchor` from [@yaks/git](../git/README.md).

## Compatibility

`@yaks/page/vocab` exports a vocabulary document and has no runtime calls. The
configured archiver uses `Deno.Command`; the configured stores use SQLite or the
filesystem. The root import includes these server helpers and is not covered by
the package's browser type check, which checks only `./vocab`. URL
normalization, HTML processing, and capture composition do not themselves start
processes; `freezing()` accepts an application-supplied `Archive` function and
blob store.
