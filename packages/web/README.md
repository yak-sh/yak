# @yaks/web

The web door: a graph's canvas, cards, boards and editing in a browser. `/` is
the root canvas, `/T-9` opens T-9 fullscreen, `?v=` picks its view, and every
card on screen is live: an edit anywhere reaches the page over the socket.

## Use

List it in a `yak serve` config beside @yaks/api, whose doors the page reads and
writes through:

```json
{
  "name": "yak",
  "plugins": ["@yaks/id", "@yaks/doc", "@yaks/task", "@yaks/api", "@yaks/web"]
}
```

The routes facet (`@yaks/web/routes`, routes.ts) answers:

| path                                                  | serves                                    |
| ----------------------------------------------------- | ----------------------------------------- |
| `/`, `/admin`, `/admin/*`                             | the page (index.html)                     |
| `/<letter>-*`, `/<letter>%23*`, `/%23*`               | the page, for each id letter in use       |
| `/web/app.js`                                         | main.tsx, built by `deno bundle` at start |
| `/web/styles.css`, `/web/manifest.webmanifest`, icons | the files beside it                       |
| `/web/vocab.json`                                     | the host's vocabulary documents           |

It claims no catch-all, so `/query`, `/ws`, `/apply` and every other plugin's
routes still reach their own handlers.

## How it works

- **Vocabulary.** The page learns the host's documents from `/web/vocab.json`
  before any module reads them (types.ts ends with the fetch), so the browser
  and the server speak one set of components. Tests learn the same plugin
  documents by importing testing.ts first; the TUI's main.tsx fetches them from
  its host.
- **Reads.** Each named subscription in live.ts is a server-evaluated watch on a
  @yaks/client box (live_client.ts) over @yaks/api's `/ws`. @yaks/sync owns the
  socket, its reconnect and the resubscribe after it. Aggregates (`.tally=`,
  `.count!`, `.distinct=`) arrive as their value and again when it moves.
  wire.ts turns a query line into the host's grammar and bundles into the
  cache's changes.
- **Writes.** A change is applied locally, kept in a durable outbox, and POSTed
  to `/apply` (live.ts `post`). A refusal is recorded in the refusal ledger and
  the rows it touched are read again; a network error or a 5xx is redelivered.
- **Rendering.** components/registry.ts selects renderers through @yaks/render
  and mounts them with @yaks/preact; Entity.tsx holds the curated list, and
  components/views holds the views. The TUI (tui/, `deno task tui`) mounts the
  same registry through @yaks/tui's fake DOM and layout.
- **Portable views.** `@yaks/web/views` (views.ts) holds the @yaks/render views
  any entity has — `Title`, `Tile`, `Facts`, `Comment`, `Page` — which the `yak`
  command prints an answer through (packages/cli/answer.ts).

## Limits

- `/web/app.js` is built with `deno bundle`, which Deno marks experimental.
