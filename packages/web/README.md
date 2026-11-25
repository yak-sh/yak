# @yaks/web

The browser door serves configured applications over [@yaks/api](../api). A
**web facet** is an application's `./web` contribution: source URLs for its
entry, mounting module and optional stylesheet. Web discovers those facets from
the plugin config; it imports no application.

## Use

List web and browse beside the graph and API plugins in a `yak serve` config:

```json
{
  "db": "yak.db",
  "plugins": [
    "@yaks/kernel",
    "@yaks/provenance",
    "@yaks/id",
    "@yaks/doc",
    "@yaks/task",
    "@yaks/api",
    "@yaks/web",
    "@yaks/browse"
  ]
}
```

The routes facet answers `/` and entity addresses such as `/T-9` with the page
(`./page`). It and every file `/web/*` serves are read through Deno's module
loader (@yaks/api/asset), so a host from JSR answers them from what Deno keeps,
offline too, instead of fetching them from jsr.io. `/web/app.js` is the canvas
(`./canvas`): browse's browser entry bundled with the configured plugins' views.
A release ships the canvas of a fresh `yak init` already made, so a host
composed that way answers with it instead of bundling from JSR on the person's
machine. `/web/styles.css` serves @yaks/ui's stylesheet followed by browse's
styles. The manifest and icons live beside the page.

The page carries @yaks/tracker's page reporter inline, ahead of the app. It
posts what it catches to `POST /api/report`, @yaks/tracker's report `door` as
yaks.app's pages have it: a verified bot's render is dropped, the app's pages
together may report 30 breaks a minute, and each break goes to the host's
`report` as the configured person's, with the release its page named, tagged
`entrypoint: browser report` and the page's path. A box whose config names a
tracker spool files them as bugs.

`POST /web/apply` attributes writes to the configured person using the API's
admission and write handler. `/web/owner` resolves that person through the
graph's address interface. A config that names no person makes the page
read-only: `/web/owner` answers no owner and `/web/apply` refuses. The generic
`/apply`, `/query` and `/ws` doors stay with @yaks/api.

With secrets and connections configured, Browse's sidebar opens Configuration at
`/?page=config`: replace a secret with a masked value, or sign in to an
integration. Credential writes go directly to `/web/apply`, never through an
offline outbox. `POST /web/authorize` uses @yaks/connections' authorization and
keeps return URLs outside the graph.

A one-segment alias such as `/lemon-cake` answers the page when it names an
entity, and the same page with status 404 otherwise. Other plugins keep their
more-specific routes.

## Exports

| export       | provides                                                  |
| ------------ | --------------------------------------------------------- |
| `.`          | `routes`, `letters` and the host's `Hosting` interface    |
| `./routes`   | routes facet composed by the browser host                 |
| `./canvas`   | the canvas a composition serves, and `prepare`            |
| `./page`     | the page every address answers, and what it wears         |
| `./outlived` | whether a page outlived the bundle it runs                |
| `./assets`   | an asset build said as data, to serve or to write to disk |
| `./navigate` | the browser entry that starts `@yaks/ui/navigate`         |
| `./picture`  | a kept page's picture, made from a snapshot of it         |
| `./worker`   | a service worker keeping pages and files named by bytes   |
| `./keep`     | a page registering that worker and sending it snapshots   |
| `./opening`  | what a page shows while it opens, and when opening fails  |

A **kept page** is drawn at once when its person opens it again, before the
network answers. A **snapshot** is a page's whole document as its person last
saw it, which the page (`keep`) sends its site's service worker as it is hidden,
left in place or unloaded. The worker (`keeping`) keeps the **picture** of each
(`picture`): a snapshot whose scripts and frames never run and which says it is
kept, `data-kept` on its root and a status line over it. Opening the page again
answers the picture at once while the worker asks for the page as it is now, and
the picture's one script writes that page over it when it comes, whose scripts
then run once as on any load; a page that cannot be had leaves the picture,
saying it is offline. The worker also answers files named by their bytes from
what it kept. A push naming the page its notification opens (`opens`) keeps a
picture of that page as it is when the push arrives, so opening it from the
notification, or offline, shows what the push was about at once. Visiting an
address it is told to forget at (signing out) forgets every kept page.

A page **opening** (`opening`) wears its site's background from its first frame,
and its head's inline script shows the site's mark with a quiet bar when nothing
has painted 300 ms in, and says it is taking longer than usual, with Try again,
when nothing has painted 4 s in. Both leave by themselves once the page and its
stylesheets are in; neither reloads the page or drops a stylesheet. A page whose
own scripts fail before it loads says so. Try again forgets every kept page and
loads the page again. An open the worker cannot get from the network (offline,
unreachable, or a server error the site's own page does not say) is answered
with the site's **failure page** (`failurePage`), drawn by the same script. One
that is only slow is waited for.

An **asset** (`Asset`) is one file a browser loads: its `name`, how it is made
(a browser module bundled with all it imports, a body made in the process, a
file a package ships, or none for a source already in the directory), and
whether it is `named`, written again under `_yak/` at a name of its bytes so a
browser keeps it for good. A named stylesheet has its `@import`s written in
place and what it points at named too. The bundles `split` into one group (the
scripts a page loads together) are made in one build: what two of them import is
written once, as a chunk under `_yak/` named by its bytes, which each imports
from the site's root, so a page that loads several runs each shared module once
(`chunksOf` lists the chunks a build wrote). `served(assets, at)` answers each
at `at` and its name; `write(dir, assets)` writes them into a static host's
directory, with no earlier build's names left behind; `plan` is the naming
alone, pure over the files' bytes.

```ts
import { assertEquals } from '@std/assert'
import { plan } from '@yaks/web/assets'

let read = (name: string) => new TextEncoder().encode(`/* ${name} */`)
let { names } = plan([{ name: 'menu.js', named: true }, { name: 'a.js' }], read)
assertEquals(Object.keys(names), ['menu.js'])
assertEquals(/^_yak\/menu\.[0-9a-f]{10}\.js$/.test(names['menu.js']), true)
```

`static.ts` writes the same module, page, stylesheet and icons into a static
host's asset directory:

```sh
deno run -A packages/web/static.ts /tmp/yak-web-assets @yaks/browse/web
```

A yaks.app host mounts those assets under its app's `/_web` address and supplies
its API prefix and authentication. It imports browse's `Hosting` declaration;
web contributes no app-specific graph state.

## Limits

The script is built with esbuild and Deno’s module resolver. From a checkout it
resolves the workspace; from JSR it resolves the matching release through
@yaks/cli's bundle machinery. Terminal rendering belongs to @yaks/tui, and the
terminal app belongs to browse.

## Home query and plugin views

A **home query** is the query the box lists at `/` when no configured package
offers a home page. The `@yaks/web` plugin's options name its heading and query:

```json
{
  "use": "@yaks/web",
  "with": { "home": { "title": "Documents", "query": ".doc" } }
}
```

Without `home`, the heading is `Home` and the query is `.doc`. The browser
bundle imports the configured plugins' `/views` facets; their portable `views`
and query-backed `inspectViews` enter the browsing app's shared registry, their
`destinations` its sidebar, and a `home` page or `tabs` the places
@yaks/browse's README describes. Domain packages own the queries and readings,
not the web door.

## Browser history

Web installs the `@yaks/ui/history` port before mounting browse. The port owns
`pushState`, `replaceState` and `popstate`; browse supplies the page's path and
where it was scrolled. Ordinary internal anchors follow that port, while
modified clicks keep their native new-tab behavior.

A site of server-drawn pages (yaks.app's signed-in pages) loads `./navigate` in
a script marked `data-navigate`: it starts `@yaks/ui/navigate` over the
browser's history, so a link to another such page is fetched and laid over the
one shown, and the shell and its images keep their nodes.

## A page that outlived a deploy

`/web/app.js` carries its sha as its etag, and a deploy serves another bundle. A
page loaded before the deploy runs the old bundle, and what its old code asks (a
live query naming a word the new vocabulary dropped) can be refused by the new
server. `outlived()` (`./outlived`) says whether the bundle served now differs
from the one served when the page loaded, and browse reloads such a page onto
the code now served instead of reporting its refusals. A refusal on a page
running what is served is reported, as a bug. The tag is asked at
`/web/app.js?tag`, never at the bundle's own address: a page that fetches that
address makes Chrome drop the bundle it cached, and every reload would download
and compile it again.

## Application contributions

An application exports `app` through `./web`:

```ts
import { application } from '@yaks/web/app'
import { equal } from '@yaks/testing'
const app = {
  entry: new URL('file:///example/main.ts'),
  mount: new URL('file:///example/mount.ts'),
}
equal(
  await application(['example'], undefined, async () => ({ app })),
  { ...app, plugin: 'example' },
)
```

The door loads the configured plugins' `/views` facets and passes them, with its
`home` option, to that application's `mount`. With several applications, set
web's `app` option to the chosen plugin name. No contribution or an ambiguous
choice fails explicitly. Static hosts pass an application's facet to
`assets.ts`; the browser history primitive is installed before its entry.
