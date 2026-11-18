# @yaks/provenance

Who made an entity and who last changed it, when, and through what: the
`created` and `updated` stamps the graph fills in on every write. A graph
composed without this package keeps neither.

## Stored data and exports

- `created{at, by, via}` is set once, when the entity is made.
- `updated{at, by, via}` records the last write after that, and is absent until
  the first one.
- `authorship{fields}` retains the writers of the words and primitive values
  still held by the row, where a store composes the tracker. `fields` maps
  JSON-encoded component/property/leaf paths to ranges with
  `{from, to, by,
  via}`. String ranges use UTF-16 offsets; other values use
  `[0, 1]`.

The tracker matches meaningful words across the whole row, so edits, property
moves and array shifts keep their writers. Equal repeated words keep all their
known writers conservatively. Removing their final occurrence removes that
contribution; whitespace and punctuation alone retain none. Consecutive words
with the same writers share a range, so an ordinary long field holds one range
per writer. Nested JSON values are attributed independently.

Old rows without `authorship` use both `created` and `updated`. Their first edit
seeds surviving content conservatively from those two stamps. Writers lost
before tracking began cannot be recovered from a graph without history.

Every property is stamped: clients read them and never write them. The
[stamp phase](../graph/README.md#stamps-and-actors) of @yaks/graph fills them
in, `at` from the write's clock and `by` and `via` from its
[actor](../graph/README.md#data-model). Neither component keeps journal history.

The root import exports `provenanceDoc`, a vocabulary document.
`@yaks/provenance/vocab` also exports `docs: [provenanceDoc]` and `description`
for plugin loaders. `@yaks/provenance/tracker` exports `authorship(vocab)`, the
plugin that retains value attribution transactionally through the storage
interface. It is not a facet, so a graph listing this package keeps only the
stamps; a store opts in by composing it after other storage trackers such as
archetypes, as yaks.app's app stores do through @yaks/platform's
`yak/authorship`. `@yaks/provenance/authorship` exports `authors(row)` to read
the current writers and `retained(old, next, actor, vocab)` to compute their
ranges. The package has no storage, tools or effects.

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

Deno, Node and browsers. Its declarations and pure attribution logic make no
runtime calls.
