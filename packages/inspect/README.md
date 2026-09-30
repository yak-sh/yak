# @yaks/inspect

The inspector: a graph's data model, its values and how they flow, as a schema
browser built of [@yaks/ui](../ui/README.md) parts, the same in a browser and a
terminal: an index, and beside it the pages gone to, stacked. Every value is
written where it stands, and a note can be left under any heading.

The views know no store. Each is a @yaks/render registration, or a component
drawn by one, that declares the queries it needs as data, draws what the host
answers, and sends an edit out as bundles. The inspector's own state lives in
the page's own graph.

It has a page of its own at `/inspect` and a terminal of its own, `yak inspect`:
nothing of another package's app around it. A host that lists `@yaks/api` and
this package serves it.

## A tour

- **The index**, on the left, always there: every package with the components it
  declares under it. The field above it narrows it as it is typed (a component
  by its name, a package with all of its own), and runs the line as a query on
  Enter.
- **The stack**, beside it: each page gone to (a link followed, a row pressed, a
  query run) is stacked on top, and each page under it narrows to a strip at its
  left saying what it is (its name and kind, or the query). A press on a strip
  returns to that page, closing those above it. It holds six pages, the top one
  and five strips (@yaks/ux `Stack`, `LIMIT`); past that the oldest leave, and
  the browser's history still has them. The address is the stack, bottom first,
  a path segment a page (./where.ts): `/inspect/q=/T-9` is the first page with
  T-9's over it, so back, forward and a shared link restore it.
- **A page**, for what a pane names:
  - the first page (`/inspect`): the sets of components entities are made of,
    most populous first, and the edge relations.
  - a component: its name, package and description; Properties (name, type,
    description, flags); Found with (the sets it appears in, with counts);
    Refers to, and referred to by; Entities (a row each, a column per property,
    a page at a time, sorted by a pressed heading).
  - a property: its type and description, its values ranked by how many hold
    each, and its recent writes.
  - a package: the components it declares, and what it adds to others'.
  - any other entity (`/inspect/<id>`, by any id the graph resolves): its id and
    title, a small table per component under that component's description, its
    edges, and its history as a timeline (who, when, through which session,
    before and after).
  - a query (`/inspect/q=<line>`): its rows, with a column per component they
    share; a `.count` as a number, a `.tally` as values by count.
- **The keys**, in a browser: ↓ or j rests on the next row of the table the keys
  are in (the top page's first, before any), ↑ or k the one before, and Enter
  opens it.
- **Editing**, through [@yaks/ux](../ux/README.md)'s `Edit`, the same as web's
  page: a value pressed is typed over where it stands, and nothing else on the
  page moves; Enter or leaving it writes it, Escape puts it back. A closed set's
  choices, and a reference's search of the graph, float beside the value; a flag
  is its own toggle. A refusal, and input that could not be read, is said under
  the entity's head. A component is added from an entity's head and removed by
  its ×; an edge is added under its table; an entity is deleted by two presses.
- **Notes**: every heading has a `note` press that opens a one-line field. A
  note shows under its heading, and each one is a task an agent picks up.
- **The terminal**: `yak inspect` opens the first page, `yak inspect T-9` an
  entity's page and `yak inspect '<line>'` a query's. The index and the top page
  are framed columns, and each page under it a strip three wide; Tab moves the
  keys between the index and the top page, j and k walk the rows and links,
  Enter or l stacks what the walk is on, h returns to the page under the top
  one, a press on a strip returns to it, `/` types in the index's field, q
  quits. It reads through the config's `yak serve`. Values paint as values;
  editing is the page's.
- **Elsewhere**: a page that registers these views (a card's Inspect tab) draws
  an entity's page in place, a row pressed opening that entity's own card.

## The host

A browser or a terminal supplies a `Host` once (./host.ts): the vocabulary, a
hook answering a view's asks while it is mounted, where links go, `go`, which
follows one in place (a link's, or a pressed row's), how an entity is named and
when a moment was, and `apply`, which writes a change and rejects with the
reason when the graph refuses it (the value or heading that wrote says it).
`inspector(registry, host)` gives the `Door` every view is drawn through, and
`frame()` the index and the stack around it.

The inspector's own page and terminal share one host, `live()` (./live.ts), and
it is small: the vocabulary the server serves (@yaks/api `/vocab`), a
@yaks/client box connected to that server, and the page's own graph. An ask is a
server-evaluated watch held while its view is mounted, sent as it is written
(`*` for whole rows); an aggregate is the watch's `reduced` and a refusal its
`refused`; one asked `once` is kept for as long as the page is open. A write
goes to the server as it stands (@yaks/sync `submit`), so the graph resolves the
ids and aliases a person typed. `go` stacks what it follows in the page's own
graph (./state.ts `follow`). Around it the page (./main.ts) says the stack in
the address and hands @yaks/ux a host over the same one (`editing`, ./state.ts),
its pickers asking @yaks/api's `/query`; the terminal (./tui.ts) adds its keys.

| export     | what it is                                                    |
| ---------- | ------------------------------------------------------------- |
| `.`        | the views, `inspector()`, `frame()`, the addresses, the host  |
| `./views`  | the views as a registry, for a host that draws them           |
| `./routes` | `/inspect`, `/inspect/<pane>/…` and what their page loads     |
| `./cli`    | `yak inspect`                                                 |
| `./front`  | the components of the page's own graph, never a graph's vocab |

## State

The page's own graph holds the inspector's state, in components this package
declares for that graph alone (`front.json`, exported as `./front`, never a
`./vocab` a host composes; `sync: none`, `durable: connection`):

| component   | on               | what it holds                                                        |
| ----------- | ---------------- | -------------------------------------------------------------------- |
| `inspector` | `inspect`        | the pane with the keys, a note open, a delete armed, a refused write |
| `table`     | each table's key | how its rows run, the page it shows, whether its values are ranked   |

The index's field is the same `inspect` entity's `filter` (@yaks/filter), each
value being changed an `Edit` of its own, and the pages stacked a `Stack` of its
own (`STACK`, @yaks/ux). What is typed in the field is the person's draft, read
through @yaks/filter's `text`, which the page's host hands `frame()` as its
`fields`.

## Notes

A note is one entity: `doc{title, body}` + `comment{target}` + `task{}`, a
comment on what the page is about that is an open task (`note()`, ./notes.ts).
The heading it was left under rides in its title (`task · Properties: …`), since
a comment has nowhere else to say it. An agent finds it as work: `yak task list`
lists open tasks, and `yak task list .comment.target=<eid>` what was said about
one thing.

## Limits

- Which sets a component is found with is read off one tally of its entities'
  archetypes, asked once per page.
- A tally cannot be bounded, so a property's values are ranked at once only for
  an enum or a component carried by up to 5,000 entities; beyond that, a press
  ranks them.
- The journal's changes are indexed by target, not by component, so a property's
  recent writes take a second or two on a large graph; they are asked once, with
  no count.
- A `.fields` projection cannot carry a JSON value, so `_comp` rows are asked
  whole.
- A terminal's pane cannot yet scroll to an element, so walking past the bottom
  of a pane does not bring the row into view.
