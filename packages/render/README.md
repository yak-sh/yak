# @yaks/render

Selects views, editors, and actions for [bundles](../graph/README.md#data-model)
through a query-matched registry independent of the rendering host.

A **view** is a name requested by a caller, such as `Tile` or `Board.List.Tile`.
A **registration** associates a view with a
[query](../query/README.md#query-model) or `true`:
`{ view: 'Tile', match: parse('.doc') }` (`Registration`). A **renderer** is a
registration with a `render(bundle, h, ctx)` function, or a `load()` function
that prepares it (`Renderer`). A **registry** holds ordered registrations and
the options used for selection and actions (`Registry`).

A **context** holds extra values supplied by the caller (`Context`). A rendering
host supplies `h(tag, props, ...children)` (`H`), which builds its output nodes.
It may also supply `ctx.render(view, context?)` for nested views and `ctx.vocab`
for the [vocabulary](../vocab/README.md#vocabulary) (`RenderContext`).
[@yaks/preact](../preact/README.md) supplies Preact rendering;
[@yaks/text](../text/README.md) supplies Markdown and plain text rendering.

## Preparation

A deferred renderer keeps its selection metadata available while its `load()`
function imports or prepares the rendering implementation. Selection never calls
`load`. A host calls `prepared(registry)` before drawing, or supplies the
selected registrations as its second argument. The returned registry preserves
all entries, options, and their order; the input registry remains unchanged.

```ts
import { define, prepared } from '@yaks/render'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { render } from '@yaks/text'

const views = define([{
  view: 'Tile',
  match: true,
  load: async () => (_bundle, h) => h('span', null, 'Ready'),
}])
const ready = await prepared(views)
equal(render(ready, { entity: { eid: 'one' } }, 'Tile', loadVocab([])), 'Ready')
```

Browser and terminal hosts prepare the full registry before painting. A portable
host may supply `ctx.deferred(renderer)` to collect selected and nested deferred
renderers, prepare those registrations, and draw again. A selected unprepared
renderer without this boundary throws; it does not silently draw empty content.
Preparation failures propagate when the host prepares the required renderer.

## Use

```ts
import { define } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { render } from '@yaks/text'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      properties: { title: { type: 'string' } },
    },
  },
})
let bundle = { entity: { eid: 'example' }, doc: { title: 'A document' } }
let registry = define([{
  view: 'Tile',
  match: parse('.doc'),
  render: (b, h) => h('h2', null, (b.doc as { title: string }).title),
}])
equal(render(registry, bundle, 'Board.List.Tile', vocab), '## A document')
```

## Exports

| Module               | Exports                                                                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@yaks/render`       | `define`, `extend`, `resolve`, `applicable`, `actions`, `edit`; types `Registration`, `Renderer`, `Registry`, `Selection`, `Options`, `H`, `Child`, `Context`, `RenderContext`, `Action`, `Contributor`, `Patch`, `EditOptions`, `ArchetypeLookup`; re-exported `Bundle` and `Query` |
| `@yaks/render/views` | `views`, `sheet`; types `Shown`, `Related`                                                                                                                                                                                                                                           |

## Selection

`resolve(registry, bundle, view, vocab, ctx?)` returns a registration without
invoking its renderer. For `Board.List.Tile`, it tries `Board.List.Tile`,
`List.Tile`, then `Tile`. At the first view with a match, the query with the
most top-level [clauses](../query/README.md#query-model) wins; registration
order breaks ties. A `match: true` registration scores 0.5, below every matching
query, including an empty query. If nothing matches, it tries a matching `JSON`
registration, then returns `undefined`.

An unnamed request considers `options.views`, or all registered views when that
option is omitted. `applicable` lists matching exact view names in that order,
or registration order when `views` is omitted; it does not try shorter names or
use the `JSON` fallback. Registrations using unknown vocabulary names are
skipped.

`define` preserves additional registration fields and their types; a host can
select its own rendering contract through the same interface. `extend` prepends
registrations, so they win equal scores without affecting other registries.
`Selection` is the registry's `renderers`, `views`, and `archetypes` fields.

```ts
import { applicable, define, extend, resolve } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    doc: { component: true, properties: {} },
    task: { component: true, properties: {} },
  },
})
let bundle = { entity: { eid: 'a' }, doc: {}, task: {} }
let registry = define([
  { view: 'Tile', match: true, name: 'any' },
  { view: 'Tile', match: parse('.doc .task'), name: 'task' },
  { view: 'Page', match: parse('.doc'), name: 'page' },
  { view: 'JSON', match: true, name: 'json' },
], { views: ['Page', 'Tile'] })
equal(resolve(registry, bundle, 'Board.Tile', vocab)?.name, 'task')
equal(resolve(registry, bundle, 'Missing', vocab)?.name, 'json')
equal(resolve(registry, bundle, undefined, vocab)?.name, 'task')
equal(applicable(registry, bundle, vocab), ['Page', 'Tile'])
extend(registry, [{ view: 'Tile', match: parse('.doc .task'), name: 'custom' }])
equal(resolve(registry, bundle, 'Tile', vocab)?.name, 'custom')
```

### Component presence through archetypes

`options.archetypes` accepts an `ArchetypeLookup`: a function from an
[archetype](../archetype/README.md) eid to its immutable physical table-name
array. Component-presence queries can match that array through
`bundle.entity.archetype`, even when component values were omitted. Results are
cached per query, vocabulary, and table array. Value predicates and property
selection use ordinary bundle matching; missing or unknown archetype eids fall
back to it. The caller loads archetypes and keeps their subscription open to
receive additional table arrays.

```ts
import { define, resolve } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    doc: { component: true, properties: {} },
  },
})
let tables = Object.freeze(['doc'])
let registry = define([{ view: 'Tile', match: parse('.doc') }], {
  archetypes: (eid) => eid == 'shape' ? tables : undefined,
})
let bundle = { entity: { eid: 'a', archetype: 'shape' } }
equal(resolve(registry, bundle, 'Tile', vocab)?.view, 'Tile')
```

## Actions

An **action** is an offered operation with a `name`, an optional query `when`,
and a `run(bundle, input?)` function returning
[component](../graph/README.md#data-model) changes (`Action`). `Patch` is the
component-only part of a [patch](../graph/README.md#data-model); the caller
chooses whether to apply it. Listing actions never invokes `run`.

Static actions are keyed by component name. `actions` collects them for
components present on the bundle, preserving component registration order and
duplicates. A `when` condition requires a vocabulary, supplied in
`options.vocab` or directly to `actions`.

```ts
import { actions, define } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    doc: { component: true, properties: { title: { type: 'string' } } },
  },
})
let bundle = { entity: { eid: 'a' }, doc: { title: 'Before' } }
let calls = 0
let registry = define([], {
  vocab,
  actions: {
    doc: [{
      name: 'clear',
      when: parse('.doc'),
      run: () => {
        calls++
        return { doc: { title: null } }
      },
    }],
  },
})
let offered = actions(registry, bundle)
equal(offered.map((action) => action.name), ['clear'])
equal(calls, 0)
equal(offered[0].run(bundle), { doc: { title: null } })
equal(calls, 1)
```

A **contributor** supplies dynamic actions through `{ match, acts(source) }`
(`Contributor`). `actions` invokes matching contributors in registration order,
then filters their returned actions by `when`. Queries read the bundle;
contributors receive the separately supplied source, or the bundle when no
source is supplied. `define<R, A, E>` preserves custom registration, action, and
source types; `Registry` defaults to `Renderer`, `Action`, and `Bundle`.

```ts
import { actions, define, type Registration } from '@yaks/render'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let registry = define<Registration, { name: string }, { writable: boolean }>(
  [],
  {
    actions: [{
      match: true,
      acts: (source) => source.writable ? [{ name: 'save' }] : [],
    }],
  },
)
let bundle = { entity: { eid: 'a' } }
let vocab = loadVocab([])
equal(actions(registry, bundle, vocab, { writable: true }), [{ name: 'save' }])
equal(actions(registry, bundle, vocab, { writable: false }), [])
```

## Editors

An **editor** is a renderer selected by a
[property](../graph/README.md#data-model)'s declaration rather than an entity's
current values. Supplying `ctx.comp` and `ctx.prop` to `resolve` or `applicable`
selects against a **property projection**: a temporary bundle of that property's
declaration, such as
`{ entity: { eid: 'doc.title' }, prop: { comp: 'doc', prop: 'title', type: 'string', ref: undefined } }`.
Rendering still receives the original bundle and context.

The property projection's queryable fields are `prop.comp`, `prop.prop`,
`prop.type`, and `prop.ref`. `prop.type` uses the vocabulary category or scalar
type, translating `text` to `string` and `bool` to `boolean`. Selection works
when the property's value is absent; an unknown property or `prop` without
`comp` throws. A `comp` alone leaves entity selection unchanged. Use separate
view names for entity queries and property queries. Editors can inspect more
schema details through `vocab.prop(comp, prop)`; [@yaks/ux](../ux/README.md)
registers `Edit` controls.

```ts
import { define, resolve } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    doc: { component: true, properties: { title: { type: 'string' } } },
  },
})
let registry = define([{ view: 'Edit', match: parse('.prop.type=string') }])
let bundle = { entity: { eid: 'a' } }
equal(
  resolve(registry, bundle, 'Edit', vocab, { comp: 'doc', prop: 'title' })
    ?.view,
  'Edit',
)
```

### Parsing edits

`edit(vocab, { comp, prop }, options?)` creates a single-property action. Its
`run` parses input, validates it with the vocabulary, and returns only that
property. Null clears the property. Numbers and booleans become typed values;
enum aliases resolve to declared members; timestamps require an explicit
timezone; JSON text is validated. Computed or stamped properties, and properties
of components without `wire: true`, reject edits.

`options.parse(input, prop, bundle)` replaces the input parser;
`options.validate(value, prop, bundle)` can reject a parsed, vocabulary-checked
value by throwing. Creating or listing an action calls neither hook.

```ts
import { edit } from '@yaks/render'
import { loadVocab } from '@yaks/vocab'
import { equal, throws } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    doc: { component: true, properties: { count: { type: 'number' } } },
  },
})
let bundle = { entity: { eid: 'a' }, doc: { count: 2 } }
let set = edit(vocab, { comp: 'doc', prop: 'count' })
equal(set.run(bundle, '3'), { doc: { count: 3 } })
equal(set.run(bundle, null), { doc: { count: null } })
await throws(() => set.run(bundle, 'many'))
let custom = edit(vocab, { comp: 'doc', prop: 'count' }, {
  parse: (input) => Number(input) * 2,
  validate: (value) => {
    if (Number(value) > 10) throw new Error('too many')
  },
})
equal(custom.run(bundle, '3'), { doc: { count: 6 } })
await throws(() => custom.run(bundle, '6'))
equal(bundle.doc.count, 2)
```

## Shared views

`@yaks/render/views` exports the `views` registry: `Title`, `Tile`, `Facts`,
`Comment`, and `Page`. Register package-specific renderers ahead of these; query
matches beat catch-all registrations. `Title` falls back to the caller's id, or
kind inside `Tile`; an [edge](../edge/README.md)'s `Title` states its relation.
`Tile` combines id, title, and status. `Facts` lists components except `entity`,
`doc`, `comment`, and `edge`. `Comment` combines author, time, and body. `Page`
gathers title, body, relations, comments, and facts through nested rendering.

**Shown** is the caller-supplied context for these views: `id`, `kind`, `name`,
`when`, and `show` describe display values and render other entities; optional
`link`, `relation`, `relations`, and `comments` supply links and related
content. A **Related** value groups bundles under a title:
`{ title: 'requires', items: [...] }`. `sheet(colors)` supplies the views'
terminal styles from `dim`, `heading`, and `muted` colors;
[@yaks/tui](../tui/README.md) supplies terminal painting.

```ts
import { sheet, type Shown, views } from '@yaks/render/views'
import { type Node, plain, tree } from '@yaks/text'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab({
  $defs: {
    task: { component: true, properties: {} },
    comment: { component: true, properties: {} },
    edge: { component: true, properties: {} },
  },
})
let bundle = { entity: { eid: 'a' }, task: {} }
let ctx: Shown<Node> = {
  id: (b) => b.entity.eid,
  kind: () => 'task',
  name: (eid) => eid,
  when: () => 'today',
  relation: () => 'requires',
  show: (b, view) => tree(views, b, view, vocab, ctx),
  relations: [{ title: 'requires', items: [{ entity: { eid: 'b' } }] }],
  comments: [{ entity: { eid: 'c' }, comment: {} }],
}
equal(plain(tree(views, bundle, 'Title', vocab, ctx)), 'a')
let edge = { entity: { eid: 'e' }, edge: { from: 'a', to: 'b' } }
equal(plain(tree(views, edge, 'Title', vocab, ctx)), 'a requires b')
equal(plain(tree(views, bundle, 'Tile', vocab, ctx)), 'a task ')
equal(plain(tree(views, bundle, 'Facts', vocab, ctx)), 'task: ✓')
equal(plain(tree(views, ctx.comments![0], 'Comment', vocab, ctx)), 'someone')
let page = plain(tree(views, bundle, 'Page', vocab, ctx))
for (
  let part of [
    'task a',
    'requires',
    'b task',
    '1 comment',
    'someone',
    'Details',
    'task: ✓',
  ]
) {
  equal(page.includes(part), true)
}
equal(sheet({ dim: 'gray', heading: 'blue', muted: 'silver' }).Section_Title, {
  fg: 'blue',
})
```

## Limits

The registry and its caches live in memory. This package opens no graph or
database, stores no entities, and applies no changes. Rendering hosts build
output nodes; callers provide related bundles, display values, and write
handling. It runs in Deno, Node, browsers, and workers without a DOM or UI
framework.
