# @yaks/alias

Persistent names for entities in an [@yaks/graph](../graph/README.md) store. Use
aliases when callers need a stable, readable identifier or repeated imports
should update the same entity without first looking up its EID.

This differs from a graph's `$temporary` aliases: those resolve only within one
batch. This plugin stores names through [@yaks/key](../key/README.md), so they
can be resolved in later batches and requests.

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
      type: 'object',
      properties: { title: { type: 'string' } },
    },
  },
}], [keyKeywords])
const g = graph({
  storage: ram(vocab),
  vocab,
  plugins: [keys(vocab), aliases(vocab)],
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
entity rather than creating a duplicate. The `keys` plugin must precede
`aliases`.

## Representation and lookup

`alias: { name }` on an incoming entity is input syntax consumed during
normalization. `name` is not a persisted column on the `alias` component. The
plugin creates a separate key entity with `key{of,value}` and an `alias` tag.
Its derived identity makes a name unique; an entity can have multiple names.
Deleting the target releases its names through the key's reference rules.

Names can be used as bundle EIDs and reference targets. `g.address(names)` also
resolves them explicitly. An existing EID takes precedence over an alias with
the same spelling. UUID-shaped IDs and content hashes are treated as direct IDs
and are not looked up as aliases.

A colon in a name has no namespace semantics; it is ordinary text. Choose a
naming convention in the application if names from different sources must not
collide. This package provides name resolution, not authorization or ownership
policy.
