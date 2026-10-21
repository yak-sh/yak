# @yaks/id

Formatting and resolution of human ids such as `B-7`, with opt-in entity numbers
and vocabulary-declared prefixes. Use it to give people an id they can read and
type while keeping the [eid](../graph/README.md#data-model) as the entity's
durable identity.

## Human ids

A **human id** is a prefix and a number joined by a hyphen, such as `B-7`. The
**number** is the store-local integer kept in `entity.num`; it identifies an
entity within that store. A **prefix** is the letter declared by a
[component](../graph/README.md#data-model)'s `prefix` keyword, such as
`prefix: 'B'`. A component without a declared prefix uses its uppercase initial.

A **short handle** is `#` followed by the first ten characters of the eid, with
dashes removed and letters lowercased, such as `#a3f19c024b`. It is what
`idOf()` and `human()` display until the entity has a nonzero number.

## Format and parse

Register `idKeywords` when loading the
[vocabulary](../vocab/README.md#vocabulary) so the loader keeps the `prefix`
keyword. `idOf(vocab)` accepts an eid, a [kind](../vocab/README.md#vocabulary),
and an optional number; `human(vocab)` accepts a
[bundle](../graph/README.md#data-model) and obtains the kind from its
components.

```ts
import { human, idKeywords, idOf, parse } from '@yaks/id'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { component: true, kind: true, prefix: 'B', properties: {} },
  },
}, [idKeywords])
const eid = 'a3f19c02-4b00-4000-8000-000000000001'
equal(idOf(vocab)({ eid, kind: 'book', num: 7 }), 'B-7')
equal(human(vocab)({ entity: { eid, num: 7 }, book: {} }), 'B-7')
equal(idOf(vocab)({ eid, kind: 'book' }), '#a3f19c024b')
equal(parse('b-7'), { prefix: 'B', num: 7 })
equal(parse('7'), { prefix: '', num: 7 })
equal(parse('#a3f19c024b'), undefined)
```

`parse()` accepts letters followed by a hyphen and digits, or bare digits. It
uppercases the prefix and refuses numbers outside JavaScript's safe integer
range. It does not look up an entity or validate its prefix.

## Install

```sh
deno add jsr:@yaks/id
# Node: npx jsr add @yaks/id
```

## Exports

| Import           | Exports                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@yaks/id`       | `idKeywords`, `ID_URI`, `short`, `SHORT`, `prefixes`, `prefixOf`, `format`, `parse`, `idOf`, `human`; `Named`, `Parsed`, `Wearing`; `idDoc` |
| `@yaks/id/vocab` | `idDoc`, `docs`, `idKeywords`, `keywords`, `description`                                                                                    |
| `@yaks/id/graph` | `numbers`, `ids`, `plugins`                                                                                                                 |

## Prefixes and short handles

`prefixes()` returns only declared prefixes; `prefixOf()` also supplies the
initial for a component without one. `SHORT` recognizes typed short handles with
6–64 hex characters. `short()` formats the eid without checking whether it is
hex.

```ts
import { format, idKeywords, prefixes, prefixOf, SHORT, short } from '@yaks/id'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    book: { component: true, prefix: 'B', properties: {} },
    author: { component: true, properties: {} },
  },
}, [idKeywords])
equal(prefixes(vocab), { book: 'B' })
equal(prefixOf(vocab)('author'), 'A')
equal(format('B', 7), 'B-7')
equal(short('ABCDEF01-2345-4000-8000-000000000001'), '#abcdef0123')
equal(SHORT.test('#abcdef'), true)
equal(SHORT.test('abcdef'), false)
```

The keyword schema requires one uppercase letter. Formatting a prefix does not
allocate a number.

## Allocate numbers and resolve ids

`idDoc` [extends](../vocab/README.md#composition) the `entity` component with
`num`. `numbers(allocate)` contributes that document and answers the
[request](../graph/README.md#data-model) `$num: true` for a live entity. The
allocator runs inside the write transaction and must return the same number
whenever it is asked for the same eid.

`ids(vocab)` is a [plugin](../graph/README.md#data-model) whose `address`
resolves human ids and short handles. The number is the identity: a human id
names the entity carrying its number, whatever letter it is written with, and a
bare number does too. An entity's letter follows its components, so an id
printed before a component came or went keeps naming it. A number no entity
carries, or a short handle shared by several entities, is refused. Eids and
other strings are left to the graph's other addressing.

```ts
import { graph } from '@yaks/graph'
import { human, idDoc, idKeywords } from '@yaks/id'
import { numbers } from '@yaks/id/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab([idDoc, {
  $defs: {
    entity: { component: true, properties: {} },
    book: { component: true, kind: true, prefix: 'B', properties: {} },
  },
}], [idKeywords])
// This store numbers on write; the allocator returns the number it keeps.
const storage = ram(vocab, { number: true })
const allocate = (eid: string) => storage.get([eid])[0].entity
const allocator = numbers(allocate)
const g = graph({ storage, vocab, plugins: [allocator] })
const eid = 'a3f19c02-4b00-4000-8000-000000000001'
g.apply([{ entity: { eid }, $num: true, book: {} }])
// The plugin answers a later numbering request with the same number.
const repeated = await allocator.hooks!.cascade!([{
  entity: { eid },
  $num: true,
}], storage)
equal(repeated.at(-1)!.entity.num, 1)
const [book] = storage.get([eid])
equal(book.entity.num, 1)
equal(human(vocab)(book), 'B-1')
```

The resolver's `address` accepts a read transaction and the ids to resolve:

```ts
import { idDoc, idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab([idDoc, {
  $defs: {
    entity: { component: true, properties: {} },
    book: { component: true, kind: true, prefix: 'B', properties: {} },
  },
}], [idKeywords])
const eid = 'a3f19c02-4b00-4000-8000-000000000001'
const storage = ram(vocab, { number: true })
storage.tx((tx) => tx.patch([{ entity: { eid }, book: {} }]))
const resolver = ids(vocab)
const resolved = await resolver.address!(storage, ['B-1', '1', '#a3f19c024b'])
equal(Object.fromEntries(resolved), {
  'B-1': eid,
  '1': eid,
  '#a3f19c024b': eid,
})
```

Allocation policy does not invalidate an address already given out. The CLI
leaves existing numbers intact when excluding sessions, letters, knocks and
internal records from new allocations. Old `S-…`, `E-…` and `K-…` references
keep resolving; new unnumbered entities use the short handles above, including
in `yak session peek '#…'` and web paths with `%23` in place of `#`.

Numbers are opt in. Without `numbers()`, a graph refuses `$num` unless another
plugin declares it. A storage adapter can instead number every entity when
writing it, as [@yaks/sqlite](../sqlite/README.md) does with `number: true`. The
`plugins(host)` factory installs `ids(host.vocab)`; it does not install an
allocator. A host using [@yaks/cli](../cli/README.md) loads the vocabulary and
that factory when its config names `@yaks/id`.

## Limits

This package does not generate eids:
[@yaks/graph](../graph/README.md#data-model) owns `mint()`. It does not persist
numbers or choose an allocation strategy; those belong to the storage adapter or
calling program. Human ids are local to a store, so use eids for durable
references.

A short handle's `#` must be encoded as `%23` in a URL path. Quote a short
handle in a shell (`yak graph show '#a3f19c024b'`) so a leading `#` is not read
as a comment.

The formatting exports are pure TypeScript and depend on @yaks/vocab. The
plugins accept synchronous or asynchronous graph reads and allocators, and
preserve synchronous writes when their inputs are synchronous.
