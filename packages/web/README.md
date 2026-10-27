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

The routes facet answers `/` and entity addresses such as `/T-9` with the page.
`/web/app.js` bundles browse's browser entry. `/web/styles.css` serves
@yaks/ui's stylesheet followed by browse's styles. The manifest and icons live
beside the page.

The page carries @yaks/tracker's page reporter inline, ahead of the app. It
posts what it catches to `POST /api/report`, which reads the body with
@yaks/tracker's `broken` and hands each break to the host's `report` as the
configured person's, tagged `entrypoint: browser report` and the page's path. A
box whose config names a tracker spool files them as bugs.

`POST /web/apply` attributes writes to the configured person using the API's
admission and write handler. `/web/owner` resolves that person through the
graph's address interface. A config that names no person makes the page
read-only: `/web/owner` answers no owner and `/web/apply` refuses. The generic
`/apply`, `/query` and `/ws` doors stay with @yaks/api.

With secrets and connections configured, Browse's sidebar opens Configuration at
`/?config`: replace a secret with a masked value, or sign in to an integration.
Credential writes go directly to `/web/apply`, never through an offline outbox.
`POST /web/authorize` uses @yaks/connections' authorization and keeps return
URLs outside the graph.

A one-segment alias such as `/lemon-cake` answers the page when it names an
entity, and the same page with status 404 otherwise. Other plugins keep their
more-specific routes.

## Exports

| export       | provides                                               |
| ------------ | ------------------------------------------------------ |
| `.`          | `routes`, `letters` and the host's `Hosting` interface |
| `./routes`   | routes facet composed by the browser host              |
| `./outlived` | whether a page outlived the bundle it runs             |

`assets.ts` builds the same module, page, stylesheet and icons into a static
host's asset directory:

```sh
deno run -A packages/web/assets.ts /tmp/yak-web-assets @yaks/browse/web
```

A yaks.app host mounts those assets under its app's `/_web` address and supplies
its API prefix and authentication. It imports browse's `Hosting` declaration;
web contributes no app-specific graph state.

## Limits

The script is built with `deno bundle`. From a checkout it resolves the
workspace; from JSR it resolves the matching release through @yaks/cli's bundle
machinery. Terminal rendering belongs to @yaks/tui, and the terminal app belongs
to browse.

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
equal(await application(['example'], undefined, async () => ({ app })), app)
```

The door loads the configured plugins' `/views` facets and passes them, with its
`home` option, to that application's `mount`. With several applications, set
web's `app` option to the chosen plugin name. No contribution or an ambiguous
choice fails explicitly. Static hosts pass an application's facet to
`assets.ts`; the browser history primitive is installed before its entry.
