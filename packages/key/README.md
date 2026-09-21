# @yaks/key

Unique typed values that identify entities — an ISBN, an email address, a short
name. Each value is stored as its own entity rather than as a column on the
thing it identifies, and its id is derived from the value, so a value is unique
within its kind by construction.

## Install

```sh
deno add jsr:@yaks/key
# or: npx jsr add @yaks/key
```

## The idea

A key is an entity carrying the `key{of, value}` component plus a second
component that tags which kind of value it is — `isbn`, `email`, `alias`. The
kinds are the application's to declare; this package ships the carrier and none
of them. `of` points at the entity the value identifies, so one entity can have
as many keys as you write. It is the same tagged-component pattern
[@yaks/edge](../edge/README.md) uses for links.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { keyDoc, keyed, keyKeywords, keys } from '@yaks/key'

let library = {
  $defs: {
    book: { type: 'object', kind: true, properties: {} },
    // one component, and `isbn` is a kind of value
    isbn: { type: 'object', key: true },
  },
}
let vocab = loadVocab([keyDoc, library], [keyKeywords])
let g = graph({ storage, vocab, plugins: [keys(vocab)] })

g.apply([keyed('isbn', 'b1', '9780441013593')])
```

That writes one entity:

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
  its kind with no index to declare and no race to lose, and reading one back is
  a `get` rather than a query.
- **A key lives only as long as what it identifies.** `of` is a reference
  declared `death: release`: the row goes when that entity is deleted, and the
  value is free again. A cascade would instead tombstone an id derived from the
  value, and the value could never be used again.
- **Incomplete keys are refused:** a key with no kind, no value or no `of` never
  reaches storage.
- **Claiming a value somebody already holds lands on the holder.** When a write
  mints an entity under a `$alias` and gives it a value another entity already
  holds, the write patches that existing entity instead of creating a second one
  — which is what makes a seed, a chunked import, and a page that saves itself
  every time it opens idempotent. A caller who wrote an id down rather than
  using an alias is refused instead, with the holder named.

## The vocabulary

| component        | meaning                                          |
| ---------------- | ------------------------------------------------ |
| `key{of, value}` | this entity identifies `of` by `value`           |
| your tag         | which kind of value it is (declared `key: true`) |

A tag component declares which carrier it belongs to: `key: true` marks a key
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
Deleting the key entity instead would tombstone an id derived from the value,
and no one could ever use that value again.

## Composed with

[@yaks/alias](https://jsr.io/@yaks/alias) is the kind of key that is a **name**:
the word a person or an agent types instead of an id, resolved anywhere an eid
is accepted.
