# @yaks/browse

The graph browsing app: a person's threaded inbox, cards, boards and editing in
a browser. `/` is the configured owner's Inbox. `/T-9` opens T-9 fullscreen,
`?v=` picks its view, and every card on screen is live: an edit anywhere reaches
the page over the socket.

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
chrome only asks for runtime columns the vocabulary actually declares. The
Inspect link opens the inspector over the same store at `/<app>/_web/inspect`.
The legacy freeze door is not an app operation.

@yaks/web’s `assets.ts` builds the same browser module, page and stylesheet the
routes facet serves into a static host's directory. workers/yak builds them
during its normal deployment preparation; the Worker owns only access and
mounting.

## Use

List it in a `yak serve` config beside @yaks/web and @yaks/api, whose doors the
page reads and writes through. Add @yaks/canvas for the spatial canvas, tray and
layouts. `yak init` writes a config that has both. The least one that serves the
page:

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
    "@yaks/web",
    "@yaks/browse"
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
provides the inbox's visual parts for both doors. `yak browse` opens the same
App in a terminal. Tab/Shift+Tab and j/k focus controls; Enter follows links or
uses buttons, typing changes a focused field, Enter submits and Shift+Enter adds
a line. Escape leaves a field without spending its draft. `f` focuses the
sidebar query and `i` the first page field. Ctrl-O goes back, Ctrl-F forward,
and q quits. `TASKS_TUI_STATE` names the terminal history file; the configured
server supplies the graph, never a guessed host.

```sh
yak browse --config /path/to/yak.json
yak inspect --config /path/to/yak.json
yak inspect T-9 --config /path/to/yak.json
yak inspect '.task .count' --config /path/to/yak.json
```

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
| `/web/styles.css`                       | @yaks/ui's, then browse styles.css        |
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
  documents by importing testing.ts first; the terminal door fetches them from
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
  components/views holds the views. The terminal door (`terminal.ts`) mounts
  that same App and registry through @yaks/tui's fake DOM, native interaction
  adapter and kit sheets.

## Limits

- `/web/app.js` is built with `deno bundle`, which Deno marks experimental. From
  a checkout it bundles the files under the workspace's config; installed from
  JSR it bundles the published main.tsx under `@yaks/cli/release`'s config, so
  the day a release publishes it finds the rest of that release.

## Exports

| export           | provides                                                 |
| ---------------- | -------------------------------------------------------- |
| `.`              | vocabulary learning and graph address normalization      |
| `./hosting`      | the app's page mount, transport and storage declarations |
| `./app`, `./web` | source assets contributed to a browser door              |
| `./cli`          | `yak browse` and `yak inspect`, the terminal door        |
| `./main`         | browser entry served by the browser door                 |

The source URLs let a door bundle the app without importing its page state into
the server process:

```ts
import { entry, styles } from '@yaks/browse/app'
import { equal } from '@yaks/testing'
equal(entry.pathname.endsWith('/main.tsx'), true)
equal(styles.pathname.endsWith('/styles.css'), true)
```

## Stacked pages

Following a page link stacks it in the main area. The UX `Stack` controls panes
in the page graph; pressing a strip returns to that page. The browser door keeps
snapshots in `history.state`, so back, forward and reload restore the stack and
its scroll offsets. The address names only the top page: opening that address in
another tab starts with one page. Changing the top page's view replaces it
rather than adding a strip.

The terminal door keeps history snapshots in `TASKS_TUI_STATE`. Ctrl-O goes back
and Ctrl-F goes forward.

The configured `./web` facet contributes `app` to the browser door. The door
imports that facet from the plugin config, never imports browse by name.
