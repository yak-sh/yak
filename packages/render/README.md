# @yaks/render

One renderer registry for yaks.app's browser, text and terminal hosts. Each
portable renderer receives `(bundle, h, ctx)` and returns whatever the injected
`h` builds. The package imports no host and performs no action.

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
walk tries `Board.List.Tile`, `List.Tile`, then `Tile`. `define` accepts
`{aliases: {Show: 'Full'}}`; an alias is consulted at each level, and subsequent
stripping follows the renamed name. A cycle stops. A missing view falls to a
matching `JSON` registration, or returns `undefined`. An unnamed request
considers `options.views`, or every registered view when omitted.

`Registration` is the selection contract, `{view, match}`. A registry preserves
any additional renderer payload and its type, including native `Render`
components and file metadata. `@yaks/preact` mounts native components; the
portable `Renderer` remains the default for text and other hosts.

`extend(registry, renderers)` prepends an overlay to that registry; an overlay
wins equal scores while a more specific base renderer still wins. Other
registries remain independent. `applicable(registry, bundle, vocab, ctx?)`
returns matching exact view names in `options.views` order, or registration
order when views are omitted. It does not use aliases or JSON fallback to invent
tabs for unmatched names.

Actions are contributed with
`define(renderers, {vocab, actions: {doc: [
{name: 'clear', run: () => ({doc: {title: null}})}]}})`.
Call `actions(registry, bundle)` to get their union in component registration
order. Optional `when: parse('.task')` conditions filter the offerings.
Duplicate names remain separate contributions. `run(bundle)` returns a component
patch; the caller decides whether and how to apply it. The vocabulary may
instead be passed as the third argument to `actions`.

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

Editors are ordinary renderers:

```ts
let editor = define([{
  view: 'Edit',
  match: parse('.column.type=string'),
  render: (b, h, ctx) => {
    let row = b[ctx.comp!] as Record<string, unknown> | undefined
    return h('input', { value: row?.[ctx.col!] })
  },
}])
let ctx = { comp: 'doc', col: 'title' }
let renderer = resolve(editor, bundle, 'Edit', vocab, ctx)
let node = renderer?.render(bundle, h, ctx)
```

When both `comp` and `col` are supplied, selection reads a schema projection
`{entity: {eid: 'doc.title'}, column: {comp: 'doc', col: 'title', type: 'string',
ref: undefined}}`.
Its queryable fields are `comp`, `col`, `type`, `ref` under `column`. `type` is
`string`, `number`, `boolean`, `ref`, `enum`, `time`, `url`, `query` or
`priority`, according to the declaration. This selects the declared type even
when the entity's value is absent. Render still receives the original bundle. An
incomplete or unknown column address throws. Entity queries and column queries
describe different subjects; use appropriate views for each. An editor can close
over `vocab.column(comp, col)` for enum choices or other schema details. No
second registry or editor implementation is needed.

## Compatibility

Deno, Node, browsers and workers. Depends on `@yaks/query`, `@yaks/match` and
`@yaks/vocab`; no DOM, runtime globals, database or framework is required.

## Verification

`deno test --doc packages/render/mod.ts` runs the recording-hyperscript example;
`deno test packages/render/` covers matching, view resolution, column types and
action union.
