# @yaks/key

Unique typed values that identify entities — an ISBN, an email address, a short
name. Each value is stored as its own entity rather than as a property on the
thing it identifies, and its id is derived from the value, so a value is unique
within its kind by construction. An entity is a record identified by
`entity.eid`; components are the named objects stored on that record.

## Install

```sh
deno add jsr:@yaks/key
# or: npx jsr add @yaks/key
```

## The idea

A key is an entity carrying the `key{of, value}` component plus a second
component that tags which kind of value it is — `isbn`, `email`, `alias`. The
application declares these tag components; this package declares only `key`. It
does not provide a database: key records use the graph's storage adapter. `of`
points at the entity the value identifies, so one entity can have as many keys
as you write. It is the same tagged-component pattern
[@yaks/edge](../edge/README.md) uses for links.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { keyDoc, keyed, keyKeywords, keys } from '@yaks/key'
import { ram } from '@yaks/ram'

let library = {
  $defs: {
    book: { component: true, type: 'object', kind: true, properties: {} },
    // one component, and `isbn` is a kind of value
    isbn: { component: true, type: 'object', key: true },
  },
}
let vocab = loadVocab([keyDoc, library], [keyKeywords])
let g = graph({ storage: ram(vocab), vocab, plugins: [keys(vocab)] })

await g.apply([
  { entity: { eid: 'b1' }, book: {} },
  keyed('isbn', 'b1', '9780441013593'),
])
```

Alongside the book, that writes this key entity:

```json
{
  "entity": { "eid": "…derived…" },
  "key": { "of": "b1", "value": "9780441013593" },
  "isbn": {}
}
```

## Four things follow

- **A key's id is derived from the value.** `keyEid(kind, value)` returns
  `sha256("<kind>|<value>")` formatted as a UUID, so a value is unique within
  its kind without a separate uniqueness index. A key can be read by its derived
  id using `get`, rather than searched for by value.
- **A key lives only as long as what it identifies.** `of` is a reference
  declared `death: release`: the row goes when that entity is deleted, and the
  value is free again.
- **Incomplete keys are refused:** a key with no kind, no value or no `of` never
  reaches storage.
- **A repeated value can resolve to its existing owner.** When a write creates
  an entity using a temporary `$alias` and gives it a value another entity
  already holds, the write patches that existing entity instead of creating a
  second one — which is what makes a seed, a chunked import, and a page that
  saves itself every time it opens idempotent. A caller who wrote an id down
  rather than using an alias is refused instead, with the holder named.

## The vocabulary

| component        | meaning                                          |
| ---------------- | ------------------------------------------------ |
| `key{of, value}` | this entity identifies `of` by `value`           |
| your tag         | which kind of value it is (declared `key: true`) |

A tag component declares which component it accompanies: `key: true` marks a key
tag, `edge: true` marks an edge tag. Declaring a string instead names the kind
something other than the component — `key: 'mailbox'` on an `email` component
means the component written is `email` and the kind queries name is `mailbox`.

## Retiring a value

```ts
import { unkeyed } from '@yaks/key'
g.apply([unkeyed('isbn', '9780441013593')])
```

That removes both components and leaves the entity itself in place, carrying
nothing. The value can then be claimed again, by the same entity or another one.

## Exports

The root module exports `keyDoc`, `keyKeywords`, `keys(vocab)`, `keyed`,
`unkeyed`, `keyEid`, and helpers for identifying key tags and reading key
values. `./vocab` provides declarations and keywords, and `./rules` provides the
plugin factory used by package loaders. A bundle is a JSON object containing one
entity's id and components; `keyed` and `unkeyed` return such objects for
`g.apply()`.

## Composed with

[@yaks/alias](https://jsr.io/@yaks/alias) is the kind of key that is a **name**:
the word a person or an agent types instead of an id, resolved anywhere an eid
is accepted.
