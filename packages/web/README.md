# @yaks/web

The browser door: the page, bundle, styles and assets that run
[@yaks/browse](../browse) through [@yaks/api](../api). Browse owns the app's
views, editing and navigation; web owns serving it in a tab.

## Use

List web and browse beside the graph and API plugins in a `yak serve` config:

```json
{
  "db": "yak.db",
  "plugins": [
    "@yaks/kernel",
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

`POST /web/apply` attributes writes to the configured person using the API's
admission and write handler. `/web/owner` resolves that person through the
graph's address interface. The generic `/apply`, `/query` and `/ws` doors stay
with @yaks/api.

A one-segment alias such as `/lemon-cake` answers the page when it names an
entity, and the same page with status 404 otherwise. Other plugins keep their
more-specific routes.

## Exports

| export     | provides                                               |
| ---------- | ------------------------------------------------------ |
| `.`        | `routes`, `letters` and the host's `Hosting` interface |
| `./routes` | routes facet composed by the browser host              |

`assets.ts` builds the same module, page, stylesheet and icons into a static
host's asset directory:

```sh
deno run -A packages/web/assets.ts /tmp/yak-web-assets
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

A **home query** is the query the box lists at `/` when it has no inbox root.
The `@yaks/web` plugin's options name its heading and query:

```json
{
  "use": "@yaks/web",
  "with": { "home": { "title": "Documents", "query": ".doc" } }
}
```

Without `home`, the heading is `Browse` and the query is `.doc`. The browser
bundle imports the configured plugins' `/views` facets; their portable `views`
and query-backed `inspectViews` enter the browsing app's shared registry. Domain
packages own the queries and readings, not the web door.
