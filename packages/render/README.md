# @yaks/render

A renderer registry shared by every rendering backend: `@yaks/preact` in a
browser, `@yaks/text` for Markdown and plain text, `@yaks/tui` in a terminal.
Each portable renderer receives `(bundle, h, ctx)` and returns whatever the `h`
it is given builds. This package imports no backend and performs no action of
its own.

```ts
import { define, resolve } from '@yaks/render'
import { parse } from '@yaks/query'

let registry = define([
  {
    view: 'Tile',
    match: parse('.doc'),
    render: (b, h) => h('h2', null, (b.doc as { title: string }).title),
  },
  {
    view: 'Tile',
    match: parse('.doc, .task'),
    render: (b, h) => h('strong', null, (b.doc as { title: string }).title),
  },
])
let renderer = resolve(registry, bundle, 'Board.List.Tile', vocab)
let node = renderer?.render(bundle, h, {})
```

At each view name, the matching query with the most top-level clauses wins; ties
preserve registration order. `true` scores 0.5, below every query match. The
walk tries `Board.List.Tile`, `List.Tile`, then `Tile`. A missing view falls to
a matching `JSON` registration, or returns `undefined`. An unnamed request
considers `options.views`, or every registered view when omitted.

`Registration` is what selection needs, `{view, match}`. A registry preserves
any further fields on a renderer, and their types, including native `Render`
components and file metadata. `@yaks/preact` mounts native components; the
portable `Renderer` remains the default for text and the other backends.

`extend(registry, renderers)` prepends an overlay to that registry; an overlay
wins equal scores while a more specific base renderer still wins. Other
registries remain independent. `applicable(registry, bundle, vocab, ctx?)`
returns matching exact view names in `options.views` order, or registration
order when views are omitted. It does not use the JSON fallback to invent tabs
for unmatched names.

A caller can supply `define(renderers, {archetypes: eid => tables})`, where
`tables` is an immutable array of physical table names from `@yaks/archetype`.
Presence-only queries then match `bundle.entity.archetype` without reading
component bodies, with one cached answer per query, vocabulary and table set.
Scores, view traversal and overlays are unchanged. Value predicates and column
controls still use the ordinary matcher; absent or unknown descriptor ids also
fall back to it. A caller must load the descriptors before rendering projected
bundles, and keep its descriptor subscription open so that newly created sets
arrive.

Actions are contributed through `define`:

```ts
define(renderers, {
  vocab,
  actions: { doc: [{ name: 'clear', run: () => ({ doc: { title: null } }) }] },
})
```

Call `actions(registry, bundle)` to get their union in component registration
order. Optional `when: parse('.task')` conditions filter the offerings.
Duplicate names remain separate contributions. `run(bundle, input?)` returns a
component patch; the caller decides whether and how to apply it. The vocabulary
may instead be passed as the third argument to `actions`.

Dynamic actions use an ordered array of `{match: Query | true, acts(source)}`
contributors in `options.actions`. Every matching contributor runs when actions
are requested; each returns its current offerings, including optional `when`
queries. Action callbacks are never invoked while listing. For an application
with its own action and entity shapes, use
`define<MyRenderer, MyAction, MyEntity>(renderers, options)` and
`actions(registry, bundle, vocab, entity)`. Queries read the matchable bundle;
factories receive the original typed entity. Without a separate source,
factories receive the bundle. `Registry` defaults to portable `Renderer`,
`Action` and `Bundle` for existing callers.

Editors are ordinary renderers. Register the built-in family beside your entity
views and add `Props` to lay out every declared column of a component:

```ts
import { define, editors, properties } from '@yaks/render'
import { render } from '@yaks/preact'

let registry = define([...editors(vocab), properties(vocab)])
let node = render(registry, bundle, 'Props', vocab, {
  comp: 'doc',
  onPatch: (patch, bundle) => store.patch(bundle.entity.eid, patch),
  onError: (error) => showError(error),
})
// One column: render(registry, bundle, 'Edit', vocab, {comp: 'doc', col: 'title', onPatch})
```

`editors(vocab, options?)` returns seven registrations: text (`string`, `url`,
`query`), number (`number`, `priority`), enum, entity reference (`ref`),
timestamp (`time`), boolean and JSON. Enum options come from
`vocab.column().values`. JSON is declared `{type: 'string', format: 'json'}` and
stored as JSON text. References accept entity ids; applications can overlay a
picker with a more specific `.column.type=ref, .column.ref=project` query.

Controls carry an `Action` as their `onChange` property. `@yaks/preact` turns
that data into a change handler, calls `run(bundle, input)` and passes the patch
to `onPatch`. Validation failures reach `onError` and the control's native
validation feedback. The package itself never applies a patch. Native controls
can call the same `edit()` action while retaining their own gestures and paint.

`Props` takes `{comp}` and uses the backend's nested render callback to select
each column's `Edit` in the same registry, including overlays. Its definition
list includes absent values and read-only columns. `@yaks/text` renders both
views read-only in Markdown or plain text; values such as false and zero remain
visible, and unset values show `—`. `readOnly: true` also works on Preact.

When both `comp` and `col` are supplied, selection reads a schema projection:

```ts
{
  entity: { eid: 'doc.title' },
  column: { comp: 'doc', col: 'title', type: 'string', ref: undefined },
}
```

Its queryable fields are `comp`, `col`, `type`, `ref` under `column`. `type` is
`string`, `number`, `boolean`, `ref`, `enum`, `time`, `url`, `query` or
`priority` or `json`, according to the declaration. This selects the declared
type even when the entity's value is absent. Render still receives the original
bundle. An unknown column address or a `col` without `comp` throws. A `comp`
alone supplies component context to an entity view. Entity queries and column
queries describe different subjects; use appropriate views for each. An editor
can close over `vocab.column(comp, col)` for enum choices or other schema
details. No second registry is needed.

`edit(vocab, {comp, col}, options?)` creates an action whose
`run(bundle, input)` parses a value and returns only `{[comp]: {[col]: value}}`.
It never writes. Text remains text; numbers and booleans become typed values,
enum aliases resolve to declared members, and timestamps require an explicit
timezone. JSON columns hold validated JSON text. Null clears a column. Computed
columns, stamped columns, and columns the vocabulary does not mark `wire: true`
refuse edits.

An application's `options.parse(input, column, bundle)` supplies its value
language; vocabulary checks still run afterward.
`options.validate(value, column, bundle)` may throw to refuse a value before the
action returns a patch. Creating or listing an action invokes neither hook. A
backend may supply `ctx.render(view, context?)` to compose nested views through
the same registry and bundle, merging the child context over the parent.

## Compatibility

Deno, Node, browsers and workers. Depends on `@yaks/query`, `@yaks/match` and
`@yaks/vocab`; it needs no DOM, no runtime globals, no database and no
framework.

## Verification

`deno test --doc packages/render/mod.ts` runs the recording-hyperscript example;
`deno test packages/render/` covers matching, view resolution, column types and
action union.
