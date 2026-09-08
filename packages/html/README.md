# @yaks/html

Server-side HTML from the same portable views used by `@yaks/preact` and
`@yaks/text`. `render(registry, bundle, view, vocab, ctx?)` uses the Preact host
for registry selection and tree construction, then `preact-render-to-string` for
serialization. An unmatched view returns an empty string.

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

Dotted views, aliases, fallback views and column context follow `@yaks/render`.
Text and attribute values are escaped by Preact's serializer; void elements,
boolean attributes and nested children use its HTML semantics. Renderers own
their tags, props and URL policy, just as they do in the browser. Event handlers
are not serialized, including portable editor actions, and no client script or
hydration is added. Property lists compose their editors through the same
registry; pass `readOnly: true` to display values instead of controls.

## Compatibility

Deno, Node, browsers and workers. No DOM or runtime globals are required.
`preact` and its server serializer must resolve to the same Preact instance.

## Verification

`deno test packages/html/` checks escaping and registry behavior, and compares
the serialized DOM with the same renderer mounted through `@yaks/preact`.
`deno test --doc packages/html/mod.ts` runs the example.
