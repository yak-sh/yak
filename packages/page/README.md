# @yaks/page

Records a web page as it was seen, and keeps a copy of it.

`web{url, frozen_at, bytes}` — the address that was read, when a copy of the
document was taken, and where that copy is stored. A citation keeps its meaning
after the page changes or disappears.

## Install

```sh
deno add jsr:@yaks/page
# or: npx jsr add @yaks/page
```

## The address is the identity

`web.url` is declared `identity`, so a page's entity id is **derived** from its
canonical address:

```ts
import { canon, pageEid } from '@yaks/page'

canon('HTTPS://Example.com/a/?utm_source=n#top') // 'https://example.com/a'
pageEid('https://example.com/a/') == pageEid('https://example.com/a') // true
```

Recording the same page twice writes one row **by construction** — no lookup to
race, no uniqueness index to remember, and a client holding a URL can compute
its entity id without asking anybody. `canon()` is the only place an address is
rewritten, and the plugin calls it in @yaks/graph's `normalize` phase, the
earliest one, so the id is always minted from the canonical form no matter which
code path wrote the row.

What carries no identity is dropped: a fragment names a spot inside a page,
campaign parameters name the trip rather than the destination, credentials are
never part of a page's name, and a trailing slash is a server's habit. Query
parameters are kept, in the order they arrived. Anything that is not an http(s)
URL is returned exactly as it came.

## A frozen page renders from its own bytes

`scrub()` removes every external reference **at freeze time**: scripts and every
other document a page can embed, `link` tags that are not `data:`, meta refresh,
inline event handlers, every URL-bearing attribute pointing outside these bytes,
and `url()` in CSS. That is the mechanism. The Content-Security-Policy header
sent when the archive is served is defence in depth and nothing more — an
archive that is mailed, copied, or opened from a file has no header in front of
it.

It parses the document rather than running regular expressions over it: where an
attribute's value begins and ends is decided by the HTML parser, not by us.

## Two ways the bytes arrive

A browser extension or tab posts its own document to `POST /page`. It has three
things no server has: the address somebody is standing at, the document as it
looks after login and after scripts ran (refetch a paywalled page and you
archive the paywall), and the moment. Any other page is fetched afterwards by
the archiver named in the config, in an effect handler that runs after the
commit — so a capture that takes thirty seconds is not a request anybody is
holding open, and a site that is down cannot cause the write to fail.

Both end up the same way: scrubbed, stored under its own SHA-256 in the server's
[@yaks/blob](../blob) store, and stamped onto the page entity. `frozen_at` and
`bytes` are server-owned columns, so no client can claim an archive that does
not exist.

## What each entry point exports

Throughout, "the server" means whichever process opened the graph and loaded
this package.

| subpath     | what it exports                                                 |
| ----------- | --------------------------------------------------------------- |
| `./vocab`   | the `web` component definition                                  |
| `./rules`   | the plugin: the component, plus canonicalization at `normalize` |
| `./effects` | a `created(web)` handler that archives a page given its address |
| `./routes`  | two HTTP endpoints: `POST /page` and `GET /page/<eid>`          |

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

`archive` names the external command that turns a live URL into one
self-contained document. `{url}` in an argument is replaced with the address,
and where no argument mentions it the address is appended. The document is read
from the command's **stdout**, so there is no temporary file to name or clean
up. Name no archiver and nothing is fetched — which is what a graph fed only by
a browser extension wants.

`bytes` is a directory the frozen documents are written to. Leave it out and
they go in the blob table the server already has: not a second store to
configure, back up and serve, and `GET /blob/<sha>` serves them like anything
else. A frozen page inlines every asset and is often megabytes, which is the
reason to name a directory instead.

`GET /page/<eid>` returns the archived document itself, with @yaks/blob's
restrictive headers (a sandbox CSP with no scripts, plus `nosniff`), its media
type, and the two headers that let a reader date a snapshot without querying the
graph: `Memento-Datetime` is the moment these bytes were what the page said, and
the `rel="original"` link is the address they were read from (RFC 7089).

## What this package does not own

The title and prose are `doc{title, body}` ([@yaks/doc](../doc)), loaded beside
this package rather than redefined in it — a vocabulary refuses a component
declared twice. The bytes belong to [@yaks/blob](../blob). A record of source
code rather than of a web page — paths plus a git sha — is the `anchor`
component, which [@yaks/git](../git) owns.

## Compatibility

`./vocab` is a JSON document with no runtime calls and loads anywhere. The rest
needs a filesystem and the ability to start a process: the archiver is an
external command, and `./routes` reads and writes the server's blob store.
