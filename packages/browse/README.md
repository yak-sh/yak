# @yaks/browse

The graph browsing app: cards, boards, pages and editing in a browser and a
terminal. `/` is home: the owner drawn in the home page a configured package
offers, or the host's own list where none does. `/T-9` opens T-9's page, `?v=`
picks its view, and every card on screen is live: an edit anywhere reaches the
page over the socket. `?at=<transaction>` reads the entity as it was just after
that transaction (@yaks/inspect `Past`); each moment of its History opens one.
The id of a deleted entity opens what it held last, when and by whom it was
deleted, and its history; an id nothing ever carried is the not-found page.

## Full

Every entity has the same **Full** page: its title, who made it and its meta
line, its body, its relationships, then its comments, each part drawn by the
entity's own renderer. A document's title and body are typed over where they
stand (a double-click); a kind says them its own way by registering its `Title`,
`Body` or `Full.Body` (a tool by its name and description, a persona by its text
and every document it carries, a component by its properties), and an entity
with no text of its own says the facts its components state. Each relationship
is a row of two lines: the relation and the entity's name, then smaller, what it
is (its `Gist`). Under them, `+ link` adds a link of any relation the vocabulary
declares, read either way where the relation says how ('required by'): pick the
relation, then find the far end, or type a new task's title. An entity opens on
the first view offered for it (a persona on its Context desk, a board on its
board) and on Full otherwise; the inspector's page is a tab.

## Search

The sidebar's **Search /** button and the `/` key open the same palette over any
page. Type words or query filters, use arrow keys to select a result, and Enter
to open it. Escape closes it; Ctrl/⌘+Enter opens the selected result in a new
tab. Word searches rank by relevance unless the query names its own order.
Loading, a refused query, and no matches have distinct feedback.

Each result is the entity's shared tile, so a mail has its subject, a comment
its words, and a session its work—not a search-specific untitled placeholder.
The arrow beside the query opens an inspector table at `/?.task`; that address
is also a draggable link for keeping or sharing a query.

## New

The sidebar's **New** line, the `n` key and `/?@page=new` open a form to make an
entity: Debug on an empty one. Search the vocabulary to add a component (each
answer reads `comp{prop, …}` and what it is); each property gets a field for its
type, a closed set its choices, and a reference a search of the graph. Below
them, an **outline** makes more entities like it, one a line: indenting a line
puts it in the one above (`contains`), Enter keeps the indent and Tab and
Shift+Tab move a line in and out. When the form names an entity (a title, or
what identifies it) the outline goes inside it.

Any entity's menu offers **new like this** (`/?@page=new&@like=T-9`: the same
components, blank) and **add child** (`/?@page=new&@in=T-9`: made inside it,
like it); the command line says them as `:like` and `:child`, which is how a
terminal reaches them.

What it will write shows as it is typed, and Create (Enter in a field,
Ctrl+Enter or Alt+Enter anywhere) writes it as one batch, held until the server
takes it: nothing half-made shows, and a refusal appears beside the field it
names (@yaks/graph's refusals carry `eid`, `comp` and `prop`). What is typed is
the person's draft, one per address, so it is kept until it is created or
discarded.

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
    "@yaks/provenance",
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
`/`. Without one the page reads and refuses writes. Reply, decision and search
drafts stay shared across web and terminal. `yak browse` opens the same App in a
terminal. Vim's keys move the cursor as on the web (see Pages and the sidebar);
Tab/Shift+Tab focus every control in turn; typing changes a focused field, Enter
submits and Shift+Enter adds a line. Escape leaves a field without spending its
draft. `f` focuses the sidebar query. Ctrl-O goes back, Ctrl-F forward, and q,
with nothing in front to close, quits. `TASKS_TUI_STATE` names the terminal
history file; the configured server supplies the graph, never a guessed host.

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
  changes. A subscription is owned by the component that draws its data:
  `useHold` (live.ts) opens it when that component mounts and closes it when it
  unmounts, identical holds share one line, and every read (`queryEids`,
  `querySubscription`, `aggRead`, …) only reads what is held.

  ```tsx ignore
  let Tasks = ({ project }: { project: string }) => {
    let preds = useMemo(() => parseQuery(`.filed.project=${project}`), [
      project,
    ])
    useHold({ query: preds })
    return <List eids={queryEids(preds).value} />
  }
  ```
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

A **peek** is a pressed link's entity shown over the page, which stays where it
was: whole, in the Full view its own page draws, its title and body typed into
right there. There is one at a time, and a link pressed inside it shows its
entity in its place. A second press on a link to it, its Id in the head, or the
head's open button goes to its page; Esc, q, the close button or a press
anywhere else puts it away. The head moves it and its corner sizes it. Only a
fine pointer peeks: a phone and the terminal open the page at once.

Vim's keys move a cursor over the page and the sidebar beside it, in a browser
and a terminal alike ([@yaks/ux/keys](../ux/README.md#vims-keys)). The status
bar says the mode: `-- NORMAL --`, or `-- INSERT --` filled while a field is
typed into. In normal mode h, j, k and l move the cursor to the item left,
below, above or right, the first j from nowhere onto the page; gg and G go to
the first and the last; H and L go back and forward; Enter or Space presses the
item (a link peeks, as a press does). The cursor walks past a title, a body or a
field without typing into it: i, or Enter on one, types into it, and Esc leaves
it with the cursor still there. While a peek, a menu or a popover is up, the
keys walk only the front one, and Esc or q closes it with the cursor back where
it stood. The cursor wears the theme's accent ring, or paints inverse in a
terminal.

The sidebar is a short fixed list of places: search, then home (named for the
offered home page, or Home), Favorites, Recent, each package's destinations,
Sessions, and the Schema when the host serves its packages. Each is a plain
link, and the one you are on is lit. Narrower than a tablet, it folds behind the
bar's menu. A destination is a page at `/?@page=<key>` listing what its query
finds, under a page part its `view` draws, or that part alone where it names no
query (the topics' shelves, @yaks/topic). A package offers its own from its
`./views` facet beside its renderers, so Browse lists a tracker's bugs without
knowing a bug:

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
