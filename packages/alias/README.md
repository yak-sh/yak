# @yaks/alias

Persistent names for entities in an [@yaks/graph](../graph/README.md) store. Use
aliases when callers need a stable, readable identifier, or when a repeated
import should update the same entity without first looking up its eid (entity
identifier). A bundle is a JSON object containing `entity: {eid}` and the
entity's named components, such as `recipe: {title}` in the example below.

This is not the same thing as a graph's `$temporary` aliases, which resolve only
within the one list of changes they appear in. This plugin stores names through
[@yaks/key](../key/README.md), so they can be resolved by later writes and
requests.

## Setup

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { aliasDoc, aliases } from '@yaks/alias'

const vocab = loadVocab([keyDoc, aliasDoc, {
  $defs: {
    recipe: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
  },
}], [keyKeywords])
const g = graph({
  storage: ram(vocab),
  vocab,
  plugins: [keys(vocab), aliases()],
})
await g.install()
await g.apply([{
  entity: { eid: '$recipe' },
  alias: { name: 'recipe:lemon-cakes' },
  recipe: { title: 'Lemon cakes' },
}])
await g.apply([{
  entity: { eid: 'recipe:lemon-cakes' },
  recipe: { title: 'Lemon cupcakes' },
}])
```

Repeating the first write with the same `alias.name` also updates the named
entity rather than creating a duplicate. The `keys` plugin must be listed before
`aliases`.

## Exports

The root module exports `aliasDoc` (the schema document), `aliases()` (the graph
plugin), and helpers for constructing and reading alias keys. `./vocab` exports
the declarations for plugin loaders; `./rules` exports the plugin factory. This
package does not provide its own database: the graph's storage adapter stores
the key entities. The example above uses memory only.

## How a name is stored and looked up

`alias: { name }` on an incoming entity is input syntax, consumed during the
`normalize` phase. `name` is not a stored property of the `alias` component.
Instead the plugin creates a separate key entity holding `key{of, value}` with
an `alias` component beside it. That key entity's id is derived from its value,
which is what makes a name unique; one entity can have several names. Deleting
the named entity releases its names, through the key's reference rules.

Names can be used as bundle eids and as reference values. `g.address(names)`
also resolves them explicitly. An existing eid always wins over an alias spelled
the same way. Ids shaped like UUIDs and content hashes are treated as direct ids
and are never looked up as aliases.

A colon in a name carries no namespace meaning; it is ordinary text. Choose a
naming convention in the application if names from different sources must not
collide. This package provides name resolution, not authorization or ownership
policy.
