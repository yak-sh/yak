# @yaks/render

Select renderers and actions for a **bundle**: one entity's components as a JSON
object. A registry associates view names with queries and renderer functions.
For example, a `Tile` view can use a different renderer for a document and a
task.

This package handles selection and editing rules. A rendering backend supplies
`h(tag, props, ...children)`, the function that builds its output nodes.
[@yaks/preact](../preact/README.md) produces Preact nodes, and `@yaks/text`
produces Markdown or plain text. The registry and its caches live in memory;
this package opens no graph or database, stores no entities, and applies no
changes.

## Exports

All exports come from `@yaks/render`:

| Export                  | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `define`, `extend`      | Create a registry and prepend renderer registrations. |
| `resolve`, `applicable` | Select a renderer or list matching view names.        |
| `actions`               | List actions offered for a bundle.                    |
| `edit`                  | Create a validated, single-property editing action.   |
| `editors`, `properties` | Create portable `Edit` and `Props` renderers.         |

The module also exports the contracts `Registration`, `Renderer`, `Registry`,
`Selection`, `Options`, `H`, `Child`, `Context`, `RenderContext`, `Action`,
`Contributor`, `Patch`, `EditOptions`, and `ArchetypeLookup`, and re-exports the
`Bundle` and `Query` types.

`@yaks/render/views` holds the views any entity has, whatever it is made of:
`Title`, `Tile`, `Facts`, `Comment` and `Page`, with `sheet`, their dress in a
terminal. Register a package's own views ahead of them, and the most specific
match wins. What a view cannot know from one bundle (how an id reads, where a
link goes, the relations and comments a page gathers) arrives in the context as
a `Shown`. The `yak` command prints an answer through them
(packages/cli/answer.ts).

## Use

This example builds a renderer registry and renders a document as Markdown:

```ts
import { define } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { render } from '@yaks/text'

let vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
    task: {
      component: true,
      type: 'object',
      properties: { done: { type: 'boolean' } },
    },
  },
})
let bundle = { entity: { eid: 'example' }, doc: { title: 'A document' } }
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
console.log(render(registry, bundle, 'Board.List.Tile', vocab)) // ## A document
```

A portable `Renderer` receives `(bundle, h, ctx)` and returns the node built by
`h`. `ctx` contains values supplied by the caller, such as the property being
edited. A backend may supply `ctx.render(view, context?)` for nested views,
using the same registry and bundle and merging the child context over the parent
context.

## Renderer selection

`resolve(registry, bundle, view, vocab, ctx?)` returns the selected registration
or `undefined`. It does not invoke the renderer.

For `Board.List.Tile`, selection tries `Board.List.Tile`, `List.Tile`, then
`Tile`. At the first view name with a match, the query with the most top-level
clauses wins; ties preserve registration order. A `match: true` registration
scores 0.5, below every query match, including an empty query. If no view
matches, selection tries a matching `JSON` registration. When `view` is omitted,
selection considers the names in `options.views`, or all registered names if
that option is omitted.

`Registration` requires only `{ view, match }`. The registry preserves
additional fields and their types, including backend-specific `Render`
components and file metadata. `@yaks/preact` can mount native Preact components;
portable renderers use the `render` function shown above.

`extend(registry, renderers)` prepends registrations to that registry. These
registrations win equal scores; a more specific existing registration still
wins. Other registries are unaffected.

`applicable(registry, bundle, vocab, ctx?)` lists matching exact view names in
`options.views` order, or registration order when `views` is omitted. It neither
tries shorter names nor adds names through the `JSON` fallback.

### Matching component presence

`define(renderers, { archetypes: eid => tables })` accepts a lookup of immutable
physical table-name arrays from [@yaks/archetype](../archetype/README.md). For
queries that test only component presence, selection can use
`bundle.entity.archetype` to look up those tables instead of reading component
values. Results are cached per query, vocabulary, and table array. This supports
bundles whose component values were omitted from a query result.

Value predicates and property selection still use the ordinary matcher. Missing
or unknown descriptor ids also fall back to it. Applications using this lookup
must load the descriptors before rendering such bundles and keep their
subscription open to receive new table sets. Scoring and view selection do not
change.

## Actions

Static actions are registered by component name. Continuing the example:

```ts
import { actions } from '@yaks/render'

let actionable = define(registry.renderers, {
  vocab,
  actions: { doc: [{ name: 'clear', run: () => ({ doc: { title: null } }) }] },
})
let offered = actions(actionable, bundle)
let patch = offered[0].run(bundle) // { doc: { title: null } }
```

`actions(registry, bundle, vocab?)` collects actions for components present on
the bundle, in component registration order. Optional `when: parse('.task')`
conditions filter the result. Duplicate names remain separate contributions.
Conditions require a vocabulary, passed to `define` or directly to `actions`.
Listing actions never calls their `run` functions. A default `Action` returns a
component patch from `run(bundle, input?)`; the caller decides how to apply it.

For dynamic actions, pass an ordered array of
`{ match: Query | true,
acts(source) }` contributors as `options.actions`. Each
matching contributor's `acts` function runs when actions are listed and returns
the currently available actions, including any `when` conditions.

Applications with other action or entity types can use
`define<MyRenderer, MyAction, MyEntity>(renderers, options)` and
`actions(registry, bundle, vocab, entity)`. Queries read the bundle;
contributors receive the separately supplied entity. Without a separate entity,
contributors receive the bundle. `Registry` defaults to `Renderer`, `Action`,
and `Bundle`.

## Editors

Editors use the same registry as entity views. `editors(vocab, options?)`
returns seven `Edit` registrations: text (`string`, `url`, `query`), number
(`number`, `priority`), enum, entity reference (`ref`), timestamp (`time`),
boolean, and JSON. `properties(vocab)` returns a `Props` renderer that lays out
all declared properties of one component.

The text backend renders editors read-only. Continuing the example:

```ts
import { editors, properties } from '@yaks/render'

let editable = define([...editors(vocab), properties(vocab)])
console.log(render(editable, bundle, 'Props', vocab, { comp: 'doc' }))
```

For interactive controls, call `@yaks/preact`'s `render` with an `onPatch`
callback that applies the returned patch, and optionally `onError` to display
validation failures:

```ts
import { render as renderPreact } from '@yaks/preact'

let node = renderPreact(editable, bundle, 'Edit', vocab, {
  comp: 'doc',
  prop: 'title',
  onPatch: (patch, entity) => console.log(entity.entity.eid, patch),
  onError: (error) => console.error(error),
})
```

This example logs edits; an application replaces `onPatch` with its write
operation. Controls carry an `Action` in their `onChange` property. The Preact
backend converts it to an event handler, calls `run(bundle, input)`, and sends
the patch to `onPatch`. Validation failures reach `onError` and the control's
native validation feedback. Native controls may also call `edit()` directly.

Enum choices come from `vocab.prop(comp, prop).values`. References accept entity
ids; applications can register a more specific query such as
`.prop.type=ref, .prop.ref=project` to select their own picker. JSON properties
are declared `{ type: 'string', format: 'json' }` and contain JSON text.

`Props` requires `{ comp }` and a backend that supplies nested rendering. It
selects each property's `Edit` through the same registry, including added
registrations. It includes absent and read-only properties. Read-only output
shows false and zero, and uses `—` for unset values. The text backend always
requests read-only output; callers can also pass `readOnly: true` to the Preact
backend.

### Property selection

When both `comp` and `prop` are supplied, selection matches the property
declaration as a temporary bundle:

```ts
let selected = {
  entity: { eid: 'doc.title' },
  prop: { comp: 'doc', prop: 'title', type: 'string', ref: undefined },
}
```

The queryable fields are `prop.comp`, `prop.prop`, `prop.type`, and `prop.ref`.
The declared type is `string`, `number`, `boolean`, `ref`, `enum`, `time`,
`url`, `query`, `priority`, or `json`. Selection therefore works even if the
entity has no value for that property. Rendering still receives the original
bundle. An unknown property or `prop` without `comp` throws. A `comp` alone
supplies context without changing entity selection. Use separate view names for
entity queries and property queries. Editors can read further schema details
through `vocab.prop(comp, prop)`.

### Parsing edits

`edit(vocab, { comp, prop }, options?)` creates an action whose
`run(bundle, input)` parses and validates a value, then returns only
`{ [comp]: { [prop]: value } }`. Text stays text, numbers and booleans become
typed values, enum aliases resolve to declared members, and timestamps require
an explicit timezone. JSON properties contain validated JSON text. Null clears a
property. Computed or stamped properties, and properties of components without
`wire: true`, reject edits.

`options.parse(input, prop, bundle)` can replace the default input parser;
vocabulary validation still runs afterward.
`options.validate(value, prop, bundle)` may throw to reject a parsed value.
Creating or listing an action calls neither hook and writes no data.

## Compatibility

Deno, Node, browsers, and workers. Depends on `@yaks/query`, `@yaks/match`, and
`@yaks/vocab`; it needs no DOM, database, or UI framework.

## Verification

From the repository root, `deno test packages/render/` covers matching, view
selection, actions, property types, parsing, and editors.
