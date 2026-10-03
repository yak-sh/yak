# @yaks/web

The web door: a person's threaded inbox, cards, boards and editing in a browser.
`/` is the configured owner's Inbox. `/T-9` opens T-9 fullscreen, `?v=` picks
its view, and every card on screen is live: an edit anywhere reaches the page
over the socket.

## An app store on yaks.app

Open `https://<space>.yaks.app/<app>/_web` while signed in to that space. The
app's members and owners can browse it; a visitor gets the app's JSON refusal
even when the app itself is public or open. Editing still follows the app's own
write permission. The Inbox person is the signed-in person, not the box's
configured owner.

The host declares a page mount and API prefix (`hosting.ts`); assets and copied
entity addresses stay under that mount, while reads, writes and subscriptions
use the app's existing `/api` doors. The vocabulary comes from `/api/vocab` in
@yaks/api's `{docs, keywords}` envelope. A host without tasks or transcripts
gets generic browsing instead of task/session queries and verbs; transcript
chrome only asks for runtime columns the vocabulary actually declares. Box-only
Inspect and the removed legacy freeze doors are not app operations.

`assets.ts` builds the same browser module, page and stylesheet the routes facet
serves into a static host's directory. workers/yak builds them during its normal
deployment preparation; the Worker owns only access and mounting.

## Use

List it in a `yak serve` config beside @yaks/api, whose doors the page reads and
writes through. Add @yaks/canvas for the spatial canvas, tray and layouts.
`yak init` writes a config that has both. The least one that serves the page:

```json
{
  "db": "yak.db",
  "plugins": [
    "@yaks/kernel",
    "@yaks/id",
    "@yaks/doc",
    "@yaks/task",
    "@yaks/canvas",
    "@yaks/api",
    "@yaks/web"
  ]
}
```

Set `person` to the owner's id: `/web/owner` resolves it for the Inbox at `/`.
It groups @yaks/inbox threads into Needs you (blocking first), Replies, Updates
and Recent. Each row shows its newest words and attention reason; expand it to
answer a decision or reply within the conversation's branches. Archive hides it
until new activity. Search filters said or received words and can include
archived threads. Reply, decision and search drafts stay shared across web and
terminal. Expansion and search switches live in the page graph; the UI kit
provides the inbox's visual parts for both doors. The TUI opens on the same
Inbox: j/k read, Enter expands a row or uses a button, Enter or i on a field
types, Enter submits, Shift+Enter adds a reply line, and Esc keeps the draft. l
follows an entity link and h returns home. `TASKS_HOST` points the TUI at its
server; `TASKS_TUI_STATE` can name a separate file for its browsing position
when probing another graph.

With @yaks/canvas installed, canvas entities remain reachable by their ids.
Without it, canvas views, actions and screen subscriptions are omitted; stored
canvas rows and parked edits remain in place for reinstalling the plugin. If the
config names no `person`, home shows an empty Inbox naming the missing owner.

The routes facet (`@yaks/web/routes`, routes.ts) answers:

| path                                    | serves                                    |
| --------------------------------------- | ----------------------------------------- |
| `/`                                     | the page (index.html)                     |
| `/<letter>-*`, `/<letter>%23*`, `/%23*` | the page, for each id letter in use       |
| `/web/app.js`                           | main.tsx, built by `deno bundle` at start |
| `/web/styles.css`                       | @yaks/ui's, then styles.css               |
| `/web/manifest.webmanifest`, icons      | the files beside it                       |

`POST /web/apply` signs the person's writes; `/apply` remains the generic API
door.

Any other one-segment path is a name an id may be written as (`/lemon-cake`):
the page when it names an entity, and the page answered 404 when it names
nothing. @yaks/api answers a path from the route naming it most closely, so
`/query`, `/ws`, `/apply` and every other plugin's routes still reach their own
handlers.

## How it works

- **Vocabulary.** The page learns the host's documents from @yaks/api's `/vocab`
  before any module reads them (types.ts ends with the fetch), so the browser
  and the server speak one set of components. Tests learn the same plugin
  documents by importing testing.ts first; the TUI's main.tsx fetches them from
  its host.
- **Reads.** Each named subscription in live.ts is a server-evaluated watch on a
  @yaks/client box (live_client.ts) over @yaks/api's `/ws`. @yaks/sync owns the
  socket, its reconnect and the resubscribe after it. Aggregates (`.tally=`,
  `.count`, `.distinct=`) arrive as their value and again when it moves. wire.ts
  turns a query line into the host's grammar and bundles into the cache's
  changes.
- **Writes.** A batch is applied locally, kept in a durable outbox, and POSTed
  to `/web/apply` (live.ts `post`), attributed to the configured owner by the
  web door using @yaks/api's admission and write handler. A refusal is recorded
  in the refusal ledger and the rows it touched are read again; a network error
  or a 5xx is redelivered.
- **Rendering.** components/registry.ts selects renderers through @yaks/render
  and mounts them with @yaks/preact; Entity.tsx holds the curated list, and
  components/views holds the views. The TUI (tui/, `deno task tui`) mounts the
  same registry through @yaks/tui's fake DOM and layout.

## Limits

- `/web/app.js` is built with `deno bundle`, which Deno marks experimental. From
  a checkout it bundles the files under the workspace's config; installed from
  JSR it bundles the published main.tsx under `@yaks/cli/release`'s config, so
  the day a release publishes it finds the rest of that release.
