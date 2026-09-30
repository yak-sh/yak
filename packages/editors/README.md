# @yaks/editors

A property's value, changed where it stands. Pressed, a value either turns into
its own editor in place, the same element made `contenteditable`, so nothing on
the page moves, or keeps its face and floats a picker beside it. Enter or
leaving writes it, Escape puts it back, and half-typed text survives a remount.
Each editor is chosen by the property's type through a [@yaks/render](../render)
registry and drawn with [@yaks/ui](../ui)'s parts, in a browser and a terminal.

The editors know no store. They read and write through the page's host, bound
once: web's page (@yaks/web) and the inspector's (@yaks/inspect) each bind their
own, both over a @yaks/client graph.

## The editors

| a property's type                     | its editor                                                         | its face                                                 |
| ------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| text, a body, number, url, time, JSON | typed over in place, read as its type; a body on many lines        | the text; a priority `P2`; a url a link; a time in words |
| enum, bool                            | a popout row of choices, the held one marked; a flag is its toggle | the value                                                |
| ref                                   | a popout search of the graph over the entities it may name         | what the entity is called                                |
| text with a `well`                    | a popout of the values seen so far, what is typed a choice too     | the text                                                 |
| query                                 | the host's query field (@yaks/filter), or text without one         | the line                                                 |

A 'none' row in a popout clears the value. What a value's type cannot say comes
from the property's declaration: a body is a string kept apart
(`store: 'blob'`), and a well is named by `well`.

## Use

```ts ignore
import { bind, Edit, Prop } from '@yaks/editors'

bind(host) // once, before anything is drawn
h(Prop, { eid, comp: 'filed', prop: 'priority', editable: true })
h(Edit, { eid, comp: 'doc', prop: 'title' }) // double-click to type over it
```

| export                                              | what it is                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Prop`                                              | a value that opens its own editor when pressed; `show` paints a custom face, `handle` gives a link face a separate press |
| `Edit`, `InlineEdit`                                | a value typed over in place (`multi`, `open`, `inline`, `readOnly`)                                                      |
| `ColumnEdit`                                        | a property's editor opened by its caller, anchored where it says                                                         |
| `editorViews`, `views`                              | the editors as registrations (`Inline.Edit`, `Edit`), and as a registry of their own: the `./views` facet                |
| `Overlay`, `place`, `placeAt`, `usePlaceAt`, `tips` | what floats above the page, clear of every clipping container                                                            |
| `save`, `peek`, `drop`, `focused`, `useDraft`       | half-typed text, kept per tab until it is written or put back                                                            |
| `pickLine`, `useHits`, `label`                      | a picker's candidates, asked of the graph                                                                                |
| `write`, `canEdit`, `formatProp`                    | a property written from typed input, whether it may be, and its face                                                     |
| `bind`, `Host`                                      | what a page supplies                                                                                                     |

## The host

`bind(host)` supplies, once:

- `vocab`: what a property is, and whether a client may write it.
- `get(eid)`: an entity, read reactively.
- `apply(change)`: write bundles; one the graph refuses throws or rejects.
- `problem(message, eid)`: where a refusal is said.
- `name`, `id`, `kind`, `when`: what an entity is called, its human id and kind,
  and a moment in words.
- `find(line, limit)`: a server search, the entities a query line answers.

and, where the page has them: `editing` (its input language, @yaks/render
`EditOptions`), `renderView` and `columnView` (its own registry, holding
`editorViews()`), `values` (a well's values), `fields` (its query fields),
`markup` (inline markdown), `want` (a body held back until asked), `mode`
(typing began or ended), `wears` (what a choice wears beside its word, a
status's dot).

## Limits

- One host per page: a second `bind` replaces the first.
- Which value is being edited is the editor's own state (Preact's), not the
  page's graph.
