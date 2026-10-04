# @yaks/inspect

Inspect views show how a graph is made: its entities, vocabulary components,
packages, properties, query rows and map. They draw through the host's shared
[@yaks/render](../render) registry, in browsers and terminals.

A **view** is a registration selected for a bundle, with declared queries and a
renderer. The host supplies `Io`: answers, edits, references, page state and
navigation. Inspect owns the reading; [@yaks/browse](../browse) owns the app,
sidebar and history stack.

## Views

| name                                            | draws                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `Inspect.Page`                                  | a `_comp`, `_package` or `_prop` vocabulary entity               |
| `Inspect.Head`, `Inspect.Body`, `Inspect.Facts` | name, provenance, words and component values                     |
| `Inspect.Links`, `Inspect.History`              | references both ways and recorded changes                        |
| `Inspect.Query`                                 | query rows with shared component columns, count or tally         |
| `Inspect.Map`                                   | packages, components, relations and archetypes with their counts |
| `Inspect.Note`                                  | a note under a heading, selected through the registry            |
| `Tile`, `Inline`                                | vocabulary entities in any screen that asks for them             |

The `/views` facet contributes `all`. Hosts adapt `View.Render` to their query
and edit interfaces; `asks` declares which answers the renderer needs.

```ts
import { all } from '@yaks/inspect/views'
import { equal } from '@yaks/testing'
equal(all.some((v) => v.view === 'Inspect.Query'), true)
equal(all.some((v) => v.view === 'Inspect.Map'), true)
```

Inspect pages are read until the reader asks to edit. Values use @yaks/ux
editing; changes are emitted as bundles. Notes are comments and tasks about the
entity and heading where they were left. Page-only table order, paging, editing
and refusal state use the `/front` vocabulary.

## Exports

| export    | provides                                                         |
| --------- | ---------------------------------------------------------------- |
| `.`       | host/view contracts, value helpers, notes and a registry adapter |
| `./views` | registrations and schema-page registrations                      |
| `./front` | page-only state vocabulary                                       |

The `inspector(registry, host)` adapter mounts registrations supplied by a host.
Browse uses its own shared registry instead; it never creates a second registry
for Inspect.

## Limits

Inspect serves no page or terminal app, and owns no stack or URL. Browse
integrates these views into its app. Its `Inspect.Full` view combines these
readings with every raw property. The census asks the graph for archetype rows
and counts, rather than running a count query for each component.
