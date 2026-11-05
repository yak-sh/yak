# @yaks/diagram

Draws the [entities](../graph/README.md#data-model) a query selects, and the
references between them, as SVG. A drawing keeps each entity where it was as the
graph changes, so what a write adds is drawn in beside what it names.

- `layout(bundles, options?)` places a selection. It is pure: bundles in, a
  `Layout` of nodes and links with positions out.
- `svg(layout, options?)` draws a layout as one `<svg>` string.
- `mount(sheet, { graph, query })` keeps an element drawing a graph's answer to
  a query, again after every commit.
- `css` is the stylesheet a drawing is meant to wear.

```ts
import { layout, svg } from '@yaks/diagram'
import { assert, assertEquals } from '@std/assert'

let book = { entity: { eid: '0a' }, doc: { title: 'Dune' } }
let review = { entity: { eid: '0b' }, review: { of: '0a', stars: 5 } }
let drawn = layout([book, review])
assertEquals(drawn.links.map((l) => l.name), ['review.of'])
assert(svg(drawn).includes('>Dune</text>'))
```

## What is drawn

A **node** is an entity drawn as a box: its short id (`label`), its title, and
its components. The title is `doc.title`, else the first line of `doc.body`,
else `file.path`. The components `entity`, `created` and `updated` are left off
the list (`quiet` changes that).

A **link** is a line between two drawn entities. It is one of:

- an entity with `edge{from, to}`, drawn as a line rather than a box and named
  by its other components (`contains`, `requires`);
- a property whose value, or one of whose values, is another drawn entity's eid,
  named `comp.prop` (`comment.target`). `updated` and every `via` are not drawn,
  since they would join everything to its writer.

A reference to an entity outside the selection draws nothing, so the query
decides how much of the graph is on the sheet.

## Places

`layout(bundles, { was })` keeps every entity of `was` where it was, with its
`order`. Each new entity, in the order given, takes the cheapest free spot: one
that overlaps no box, crosses few lines and sits a short reach from the entities
it names. An entity that names nothing settles near the top middle. When no spot
is free the sheet grows downward, so `height` can come back larger than asked.
An entity that leaves the selection gives up its place.

Every node and link carries `fresh`, true when it joined in this layout.

`label` names a bundle's short id. Its default is the eid's handle
(`#a3f19c024b`); `mount` passes [@yaks/id](../id/README.md)'s `human(vocab)`, so
a numbered task reads `T-7`.

## The drawing

`svg()` emits classes and custom properties, never colours:

| class                                          | what it is                                               |
| ---------------------------------------------- | -------------------------------------------------------- |
| `Diagram`                                      | the `<svg>` (or `options.class`)                         |
| `Diagram_Node`                                 | a box's group, with `data-eid` and `data-comps`          |
| `Diagram_Fill`, `Diagram_Stroke`               | a box's inside and outline                               |
| `Diagram_Id`, `Diagram_Title`, `Diagram_Comps` | a box's three lines of text                              |
| `Diagram_Link`, `-edge` / `-ref`               | a line's group, with `data-from`, `data-to`, `data-name` |
| `Diagram_Line`, `Diagram_Name`                 | a line and its name                                      |
| `is-new`, `--i`                                | joined in this layout; `--i` is its turn to be drawn     |

Each stroke has `pathLength="1"`, so a stylesheet draws it in with
`stroke-dashoffset`. `css` does that: each new box, then the lines to it, is
drawn in one after another like a pen. It reads `--diagram-line`,
`--diagram-soft`, `--diagram-fill`, `--diagram-glow`, `--diagram-font` and
`--diagram-pen` (a stroke's duration), and draws nothing in under
`prefers-reduced-motion`.

## Mounting

`mount(sheet, { graph, query, width?, height?, drawn?, failed? })` writes the
drawing into `sheet.innerHTML` and draws again after every commit, seen through
an `effect` hook on the graph (one per graph, however many drawings). Commits
that land while it reads are drawn by one more read. It returns:

- `query(q)`: draw another query's answer, keeping the places of what both
  select. It refuses as the graph refuses the query, and the old drawing stays.
- `redraw()`: read and draw again.
- `layout`: the layout last drawn.
- `stop()`: stop following the graph.

`drawn(layout)` is told each layout once it is in the sheet. `failed(err)` is
told when a redraw after a commit fails; its default is `reportError`.

A page wires clicks itself, from `data-eid` on the box it reaches.
