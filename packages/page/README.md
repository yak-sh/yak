# @yaks/page

A page as witnessed.

`web{url, frozen_at, bytes}` — the address that was read, when a copy of the
document was taken, and where that copy is. A citation keeps its meaning after
the page changes or disappears.

## Install

```sh
deno add jsr:@yaks/page
# or: npx jsr add @yaks/page
```

## The address is the identity

`web.url` declares `identity`, so a page's entity id is **derived** from its
canonical address:

```ts
import { canon, pageEid } from '@yaks/page'

canon('HTTPS://Example.com/a/?utm_source=n#top') // 'https://example.com/a'
pageEid('https://example.com/a/') == pageEid('https://example.com/a') // true
```

Witnessing one page twice writes one row **by construction** — no lookup to
race, no uniqueness index to remember, and a client holding a URL can name its
page without asking anybody. `canon` is the one place an address is spelled, and
the plugin applies it in the `normalize` phase, the earliest there is, so every
door canonicalizes before the id is minted from the value.

What carries no identity goes: a fragment names a spot inside a page, campaign
parameters name the trip rather than the destination, credentials are never part
of a page's name, and a trailing slash is a server's habit. Query parameters
stay, in the order they arrived. Anything that is not an http(s) URL is left
exactly as it came.

## A frozen page renders from its own bytes

`scrub()` removes every external reference **at freeze time**: scripts and every
other document a page can embed, link tags that are not `data:`, meta refresh,
inline handlers, every url-bearing attribute pointing outside these bytes, and
`url()` in CSS. That is the mechanism. The serving CSP is defence in depth and
nothing more — an archive that is mailed, copied, or opened from a file has no
header in front of it.

It is a parse, not a pass of regular expressions: an attribute's value is
decided by the HTML parser's reading of the document rather than by ours.

## Two ways bytes arrive

A browser tab posts its own document to `POST /page`. It has three things no
server has: the address somebody is standing at, the document after a login and
its scripts (refetch a paywalled page and you archive the paywall), and the
moment. Anything else is fetched afterwards by the archiver the config named,
post-commit — so a capture that takes thirty seconds is not a request anybody is
holding open, and a site that is down cannot refuse the write.

Both land the same way: scrubbed, stored under its own SHA-256 in the host's
[@yaks/blob](../blob) store, and stamped onto the page. `frozen_at` and `bytes`
are server-owned, so no client can claim an archive nobody holds.

## The facets

| subpath     | what it brings                                                 |
| ----------- | -------------------------------------------------------------- |
| `./vocab`   | the `web` component                                            |
| `./rules`   | the canonical address, applied at `normalize`                  |
| `./effects` | `created(web)` — archive a page witnessed by its address alone |
| `./routes`  | `POST /page` (the witness) and `GET /page/<eid>` (its bytes)   |

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

`archive` names the external tool that turns a live URL into one self-contained
document, `{url}` being the address (appended where no argument mentions it);
the document comes back on its **stdout**, so there is no temporary file to name
or leave behind. Name no archiver and nothing is fetched — which is what a graph
witnessed only by a browser wants.

`bytes` is a directory the frozen documents go in. Left unsaid, they go in the
blob table the host already has: not a second store to configure, back up or
serve, and `GET /blob/<sha>` answers for them like anything else. A frozen page
inlines every asset and is often megabytes, which is the reason to name a
directory instead.

`GET /page/<eid>` answers the document itself — @yaks/blob's fence (a sandbox
CSP with no scripts, nosniff), its media type, and the two headers that date a
snapshot without asking the graph: `Memento-Datetime` is the moment these bytes
were what the page said, and the `rel="original"` link is the address they were
said at (RFC 7089).

## What it does not own

The title and prose are `doc{title, body}` ([@yaks/doc](../doc)), composed
beside this package rather than inside it — a vocabulary refuses a component
declared twice. The bytes are [@yaks/blob](../blob)'s. A promise about source
rather than about the web — paths and a sha — is `anchor`, which
[@yaks/git](../git) owns.

## Compatibility

`./vocab` is a JSON document with no runtime calls and loads anywhere. The rest
runs where there is a filesystem and a way to start a process: the archiver is
an external command, and `./routes` reads and writes the host's store.
