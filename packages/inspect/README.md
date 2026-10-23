# @yaks/inspect

Inspect views show how a graph is made: its entities, vocabulary components,
packages, properties, query rows and map. They draw through the host's shared
[@yaks/render](../render) registry, in browsers and terminals.

A **view** is a registration selected for a bundle, with declared queries and a
renderer. The host supplies `Io`: answers, edits, references, page state and
navigation. Inspect owns the reading; [@yaks/browse](../browse) owns the app,
sidebar and history stack.

## Views

| name                                            | draws                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Inspect.Page`                                  | a `_comp`, `_package`, `_prop` or `_effect` vocabulary entity                       |
| `Inspect.Head`, `Inspect.Body`, `Inspect.Facts` | name, provenance, words and component values                                        |
| `Inspect.Links`, `Inspect.History`              | references both ways and recorded changes                                           |
| `Inspect.Query`                                 | query rows with shared component columns, count or tally                            |
| `Inspect.Map`                                   | the schema: a package tree, components, relations and archetypes, with their counts |
| `Inspect.Note`                                  | a note under a heading, selected through the registry                               |
| `Tile`, `Inline`                                | vocabulary entities in any screen that asks for them                                |

The `/views` facet contributes `inspectViews()`, which loads `all` when a host
asks for inspector views. Hosts adapt `View.Render` to their query and edit
interfaces; `asks` declares which answers the renderer needs.

```ts
import { inspectViews } from '@yaks/inspect/views'
let all = await inspectViews()
import { equal } from '@yaks/testing'
equal(all.some((v) => v.view === 'Inspect.Query'), true)
equal(all.some((v) => v.view === 'Inspect.Map'), true)
```

`Past` reads an entity as it was: what it held just after one of its
transactions, rebuilt from its history, or, for a deleted entity, what it held
last, with when and by whom it was deleted. It is never edited, and its history
opens each moment's version through the host's `past(eid, tx)` door, as an
entity's own History does wherever the host has one.

Inspect pages are read until the reader asks to edit. Values use @yaks/ux
editing; changes are emitted as bundles. Notes are comments and tasks about the
entity and heading where they were left. Page-only table order, paging, editing
and refusal state use the `/front` vocabulary.

## What an entity holds, in order

`Held` draws what an entity holds by its links as an ordered list edited in
place, for any package's page: each row is the entity a link leads to, drawn by
the view the caller names (`tile`), in the order the caller gives the links.
Where the host takes edits, a row dragged between two others is put there, which
writes the links' positions (`edge.ord`, @yaks/edge's `placed`), and an entity
dragged from elsewhere (@yaks/ux's `drag`) joins the list where it is dropped,
linked by `tag`; `join` says what else that writes, or refuses it. Each row
opens in place on the title and body of what it leads to, typed over where they
stand (@yaks/ux's `Edit.Text`). An open row is no drag handle: selecting its
text, clicking into it and typing never pick it up. @yaks/topic's page draws its
lists with it.

```ts ignore
h(Held, {
  io,
  from,
  links,
  ends,
  tile: 'Topic.List.Tile',
  tag: 'contains',
  empty: 'nothing yet',
})
```

## What an entity says, where it stands

`Words` draws a body (`comp.prop`, markdown) the way browse draws every body:
read as markdown, and typed over in its source on a double-click (@yaks/ux's
`Edit.Text`), written when the person leaves it. Where the host takes no edits
it is only read. Where typing is what a page is for (`click`), one click types
into it and it says so under the pointer. `Held`'s rows and @yaks/persona's
pages draw their documents' bodies with it.

```ts ignore
h(Words, { io, e, comp: 'doc', prop: 'body' })
```

## Code written for a storage, in a view

A view can run a function written for a storage, such as a package's composer,
over what the view holds. `useReading(io, read)` hands `read` a **reader**, a
storage that only reads (`read` a query, `get` some entities), whose every read
is one of the view's asks, kept live while the view is mounted. A read not
answered yet reads as nothing; as each answer lands the function runs again and
reads on, and when a write moves anything it read, it runs again with that. It
returns the function's value and whether every read was answered (`ready`).
@yaks/persona's Markdown view composes a persona this way, with the code the
server composes it with.

```ts ignore
let { value, ready } = useReading(io, (r) => voice(vocab)(wear(r, vocab)(eid)))
```

The function must stay synchronous over synchronous input, as @yaks/fp's `after`
and `each` do.

## Exports

| export    | provides                                                        |
| --------- | --------------------------------------------------------------- |
| `.`       | host/view contracts, helpers, notes and inspector registrations |
| `./views` | `inspectViews()` loads query-backed registrations               |
| `./front` | page-only state vocabulary                                      |

The `inspector(registry, host)` adapter mounts registrations supplied by a host.
Browse uses its own shared registry instead; it never creates a second registry
for Inspect.

## Limits

Inspect serves no page or terminal app, and owns no stack or URL. Browse
integrates these views into its app.

The schema map shows one slice at a time: a tree of packages, the components and
effects each declares, and the properties of each component; every component;
the relations; or the archetypes. Names and what each is come from the loaded
vocabulary, so the map paints before any count; the slice, open rows and table
order stay in the page graph.

The map and the detail pages share a census of archetype rows and populations
rather than running a count for each component. SQLite and the Cloudflare Store
answer the unfiltered population tally and component counts from maintained
metadata; filtered counts still run their candidate query.
