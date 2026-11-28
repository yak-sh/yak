# @yaks/html

Renders graph records as HTML strings, using the same view functions as
`@yaks/react` and `@yaks/text`. A registry is a list of named view functions
with selection predicates; a bundle is one entity's components as a JSON object.
The vocabulary describes those components.

The exported `render(registry, bundle, view, vocab, ctx?)` uses `@yaks/react`
for view selection and tree construction, then React's server renderer for
serialization. An unmatched view returns an empty string.

In the browser, `@yaks/html/dom` draws a view as the document's own nodes
instead (`fragment(doc, node)`), through React DOM, which the page already
loads; React's server renderer is far larger and is never sent to a browser. A
view that holds trusted HTML imports `raw` from `@yaks/html/raw`, so it loads
neither renderer.

```ts
import { render } from '@yaks/html'
import { define } from '@yaks/render'
import { loadVocab } from '@yaks/vocab'

let registry = define([{
  view: 'Tile',
  match: true,
  render: (b, h) => h('p', null, b.entity.eid),
}])
let bundle = { entity: { eid: 'page' } }
let vocab = loadVocab([])
let html = render(registry, bundle, 'List.Tile', vocab)
```

Dotted views, fallback views and property context follow `@yaks/render`. Text
and attribute values are escaped by React's serializer; void elements, boolean
attributes and nested children use its HTML semantics. Renderers own their tags,
props and URL policy, just as they do in the browser. Event handlers are not
serialized, including portable editor actions, and no client script or hydration
is added. Property lists compose their editors through the same registry; pass
`readOnly: true` to display values instead of controls.

The caller supplies the registry, vocabulary and context; this package neither
loads entities nor persists edits. For portable renderer selection and editor
contracts, see [@yaks/render](../render/README.md).

## Compatibility

Deno, Node, browsers and workers. `render` and `markup` need no DOM or runtime
globals; `fragment` draws into the document it is given. `react` and `react-dom`
must resolve to the same React instance.

## Verification

`deno task test packages/html` checks escaping and registry behavior, compares
the serialized DOM with the same renderer mounted through `@yaks/react`, and
runs the example.
