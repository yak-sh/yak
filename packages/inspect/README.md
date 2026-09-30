# @yaks/inspect

The inspector: a graph's data model, its values and how they flow, as pages and
listings built of [@yaks/ui](../ui/README.md) parts, the same in a browser and a
terminal. Any part can take feedback where it was seen.

The views know no store. Each is a @yaks/render registration that declares the
queries it needs as data (`asks`), draws what the host answers, and sends an
edit out as bundles. The inspector's own state lives in the page's own graph.

It has a page of its own at `/inspect` and a terminal of its own, `yak inspect`:
nothing of another package's app around it. A host that lists `@yaks/api` and
this package serves it.

## A tour

- **`/inspect`** is the map: a query bar (@yaks/filter) over listings, each a
  saved query that folds. **Query** runs the bar's line: rows as tiles, a
  `.count` as a number, a `.tally` as values by count. **Components** lists
  every component with its package and how many entities carry it.
  **Archetypes** lists the sets of components entities are made of, most
  populous first. **Packages** and **Relations** (the edge relations, each with
  its reverse reading) follow. `/inspect?q=<line>` opens the map with that line
  run.
- **A page**, `/inspect/<id>` (any id the graph resolves), shows one entity: the
  trail that led there, its tile, and lenses: `parts`, `markdown` for a
  document, `json`. Its parts are sections by kind:
  - a component (`_comp`): About, Properties, References (its own and those
    naming it), Archetypes, Carried by, Feedback, Writes, Fields
  - a property (`_prop`): About, Values (a tally of what it holds), Feedback,
    Writes
  - a package (`_package`): About, Declares, Extends, Feedback
  - an archetype: its components, and its members
  - a transaction (`_tx`): what it wrote
  - anything else: Fields (each value in its editor where the vocabulary lets a
    client write it; add or remove a component; delete), Links (edges each way,
    and every entity whose reference names it; add or remove an edge), History
    (the journal's changes to it, by transaction), Feedback
- **The terminal**: `yak inspect` opens the map, `yak inspect T-9` an entity's
  page and `yak inspect '<line>'` the map with the line run. Tab and ⇧Tab (or j
  and k) walk the links, Enter or a click follows one, h goes back, `/` types a
  query, q quits. It reads through the config's `yak serve`. Controls paint as
  values there; editing is the page's.
- **Elsewhere**: a page that registers these views (a card's Inspect tab) draws
  an entity's page in place, and links to `/inspect` for the rest.

## The host

A browser or a terminal supplies a `Host` once (./host.ts): the vocabulary, a
hook answering a view's asks while it is mounted, where links go, how an entity
is named and when a moment was, and `apply`, which writes a change and rejects
with the reason when the graph refuses it (the section that wrote says it under
its title). `inspector(registry, host)` gives the `Door` every view is drawn
through.

The inspector's own page and terminal share one host, `live()` (./live.ts), and
it is small: the vocabulary the server serves (@yaks/api `/vocab`), a
@yaks/client box connected to that server, and the page's own graph. An ask is a
server-evaluated watch held while its view is mounted, an aggregate is the
watch's `reduced` and a refusal its `refused`; a write goes to the server as it
stands (@yaks/sync `submit`), so the graph resolves the ids and aliases a person
typed. `here()` draws what an address names (./where.ts). Around it the page
(./main.ts) adds a floating list for the query field and follows links in place;
the terminal (./tui.ts) adds its keys.

| export     | what it is                                                    |
| ---------- | ------------------------------------------------------------- |
| `.`        | the views, `inspector()`, the addresses, the contract         |
| `./views`  | the views as a registry, for a host that draws them           |
| `./routes` | `/inspect`, `/inspect/<id>` and what their page loads         |
| `./cli`    | `yak inspect`                                                 |
| `./styles` | the CSS a page that draws the views serves after @yaks/ui's   |
| `./front`  | the components of the page's own graph, never a graph's vocab |

## State

The page's own graph holds the inspector's state, in components this package
declares for that graph alone (`front.json`, exported as `./front`, never a
`./vocab` a host composes; `sync: none`, `durable: connection`):

| component | on               | what it holds                                   |
| --------- | ---------------- | ----------------------------------------------- |
| `map`     | `inspect`        | the listings the map shows                      |
| `listing` | each listing     | its title, query, kind, whether open, its limit |
| `section` | `<eid> <view>`   | whether a section is open; a refused write      |
| `lens`    | the entity's eid | the lens its page shows; a delete armed         |
| `trail`   | `inspect:trail`  | the pages drilled through                       |

## Feedback

Feedback on a part is one entity: `doc{title, body}` + `comment{target}` +
`task{}`, a comment on the part that is an open task (`feedback()`,
./Feedback.ts). It shows on the part's page, and an agent finds it as work:
`yak task list` lists open tasks, and `yak task list .comment.target=<eid>` what
was said about one part. A comment alone reaches a session only through a claim
on its target (@yaks/session), and nothing claims a component or a property, so
feedback is filed as a task.

## Limits

- How many entities carry a component is read off one tally of every entity's
  archetype. It reads every entity (seconds on a large graph), so it is asked
  once when a listing opens, not kept live.
- The journal's changes are indexed by target, not by component, so a
  component's Writes section is folded until opened.
- A `.fields` projection cannot carry a JSON value, so `_comp` rows are asked
  whole.
- A history asks the transactions and components by reverse hop
  (`._tx&._changes_tx._change.…`), which every host answers, rather than a
  projection through a reference.
- A live answer adds a new row at its end, so a view that shows an order sorts
  by the column it asked the order on.
