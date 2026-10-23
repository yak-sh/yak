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

Inspect pages are read until the reader asks to edit. Values use @yaks/ux
editing; changes are emitted as bundles. Notes are comments and tasks about the
entity and heading where they were left. Page-only table order, paging, editing
and refusal state use the `/front` vocabulary.

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
