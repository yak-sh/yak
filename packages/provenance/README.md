# @yaks/provenance

Who made an entity and who last changed it, when, and through what: the
`created` and `updated` stamps the graph fills in on every write. A graph
composed without this package keeps neither.

## Stored data and exports

- `created{at, by, via}` is set once, when the entity is made.
- `updated{at, by, via}` records the last write after that, and is absent until
  the first one.

Every property is stamped: clients read them and never write them. The
[stamp phase](../graph/README.md#stamps-and-actors) of @yaks/graph fills them
in, `at` from the write's clock and `by` and `via` from its
[actor](../graph/README.md#data-model). Neither component keeps journal history.

The root import exports `provenanceDoc`, a vocabulary document.
`@yaks/provenance/vocab` also exports `docs: [provenanceDoc]` and `description`
for plugin loaders. This package has no storage, tools or effects.

## Example

```ts
import { provenanceDoc } from '@yaks/provenance'
import { graph, signed } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

let vocab = loadVocab([provenanceDoc, {
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
  },
}])
let g = graph({ vocab, storage: ram(vocab) })
let ada = { by: '00000000-0000-4000-8000-000000000001' }
let write = (title: string, now: string) =>
  g.apply(signed([{ entity: { eid: 'b1' }, book: { title } }], ada), { now })
await write('Dune', '2026-01-01T00:00:00.000Z')
await write('Emma', '2026-01-02T00:00:00.000Z')
let [book] = await g.get(['b1'])
equal(book.created, { at: '2026-01-01T00:00:00.000Z', by: ada.by })
equal(book.updated, { at: '2026-01-02T00:00:00.000Z', by: ada.by })
```

## Compatibility

Deno, Node and browsers. The package exports JSON declarations and makes no
runtime calls.
