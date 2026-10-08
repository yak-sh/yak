# @yaks/browse

The graph browsing app: cards, boards, pages and editing in a browser and a
terminal. `/` is home: the owner drawn in the home page a configured package
offers, or the host's own list where none does. `/T-9` opens T-9's page, `?v=`
picks its view, and every card on screen is live: an edit anywhere reaches the
page over the socket.

## An app store on yaks.app

Open `https://<space>.yaks.app/<app>/_web` while signed in to that space. The
app's members and owners can browse it; a visitor gets the app's JSON refusal
even when the app itself is public or open. Editing still follows the app's own
write permission. The owner a home page draws is the signed-in person, not the
box's configured owner.

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

Set `person` to the owner's id: `/web/owner` resolves it for the home page at
`/`. Reply, decision and search drafts stay shared across web and terminal.
`yak browse` opens the same App in a terminal. Tab/Shift+Tab and j/k focus
controls; Enter follows links or uses buttons, typing changes a focused field,
Enter submits and Shift+Enter adds a line. Escape leaves a field without
spending its draft. `f` focuses the sidebar query and `i` the first page field.
Ctrl-O goes back, Ctrl-F forward, and q quits. `TASKS_TUI_STATE` names the
terminal history file; the configured server supplies the graph, never a guessed
host.

```sh
yak browse --config /path/to/yak.json
yak inspect --config /path/to/yak.json
yak inspect T-9 --config /path/to/yak.json
yak inspect '.task .count' --config /path/to/yak.json
```

With @yaks/canvas installed, canvas entities remain reachable by their ids.
Without it, canvas views, actions and screen subscriptions are omitted; stored
canvas rows and parked edits remain in place for reinstalling the plugin. If a
package offers a home page and the config names no `person`, home says no owner
is named.

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

## Pages and the sidebar

The main area shows one page at a time, each at its own address; the browser's
back is the way back, and a page gone back to starts scrolled where it was left.
Changing a page's view replaces its address rather than adding one.

The sidebar is a short fixed list of places: search, then home (named for the
offered home page, or Home), Favorites, Recent, each package's destinations,
Sessions, and the Schema when the host serves its packages. Each is a plain
link, and the one you are on is lit. Narrower than a tablet, it folds behind the
bar's menu. A destination is a page at `/?<key>` listing what its query finds. A
package offers its own from its `./views` facet beside its renderers, so Browse
lists a tracker's bugs without knowing a bug:

```ts
import { destinations } from '@yaks/tracker/views'
import { equal } from '@yaks/testing'
equal(destinations.map((d) => d.key), ['bugs'])
```

The terminal door keeps its history in `TASKS_TUI_STATE`. Ctrl-O goes back and
Ctrl-F goes forward.

The configured `./web` facet contributes `app` to the browser door. The door
imports that facet from the plugin config, never imports browse by name.

## What a package offers

A configured package's `./views` facet is how it reaches the app's screens;
browse names no package's views itself. Each door imports every configured
package's facet before the app paints, and takes in these exports:

| export         | what browse does with it                                         |
| -------------- | ---------------------------------------------------------------- |
| `views`        | portable renderers, entered in the shared registry               |
| `inspectViews` | @yaks/inspect views, drawn with the app's `io`                   |
| `destinations` | pages listed in the sidebar                                      |
| `home`         | the owner's home page                                            |
| `tabs`         | views offered as tabs on the entities they draw                  |
| `icons`        | Lucide glyphs, by the names its destinations, home and tabs wear |

A **home page** is `{name, icon, view}`: `/` draws the owner in `view`, and the
sidebar's first line is `name` wearing `icon`. Without one, `/` lists the host's
home query (@yaks/web's `home` option) under the title Home, and nothing at `/`
asks for more than that list.

A **tab** is `{view, icon}`: a view offered on every entity it draws, ahead of
the app's own, so an entity it draws opens on it. A project's cockpit
(`Dashboard`) draws a cell for each tab that applies to the project: the project
in that view, with `limit` in its context.

A tab or a home page may say what **waits** there: `waiting(e, io)`, a hook
called as the place paints with the entity drawn and the same `io` as the
package's views, answering a count, or undefined while it is unknown. A count
above zero is worn as a badge on the tab, on the sidebar's home line and in the
cockpit cell's heading.

```ts
import { parse } from '@yaks/query'
import type { View } from '@yaks/inspect'
import { equal } from '@yaks/testing'

// A desk: each person's page of their own, offered as home and as a tab.
let desk: View = { view: 'Desk', match: parse('.person'), Render: () => null }
let inspectViews = [desk]
let home = { name: 'Desk', icon: 'lamp', view: 'Desk' }
let tabs = [{ view: 'Desk', icon: 'lamp', waiting: () => 3 }]
let icons = { lamp: [['circle', { cx: '12', cy: '12', r: '4' }]] }
equal([home.view, tabs[0].view, inspectViews[0].view], ['Desk', 'Desk', 'Desk'])
equal(Object.keys(icons), ['lamp'])
```
