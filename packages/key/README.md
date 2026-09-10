# @yaks/key

Unique typed values that identify graph entities. Key entities contain
`key{of, value}` and a type tag; plugins validate claims and resolve repeated
imports to existing owners.

## Install

```sh
deno add jsr:@yaks/key
# or: npx jsr add @yaks/key
```

## The idea

A key is an entity containing `key{of, value}` and an application-defined tag
such as `isbn`. Its identity is derived from the tag and value. Repeating the
same claim addresses the same key entity, while `of` identifies its owner. One
owner can therefore have several keys. This follows the same tagged-relationship
pattern used by [@yaks/edge](../edge/README.md).

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

- **A key is named by what it says.** `keyEid(kind, value)` is
  `sha256("<kind>|<value>")` worn as a UUID, so a value is unique within its
  kind by construction — no index to declare, no race to lose — and reading one
  back is a `get`, not a query.
- **A key lives only while what it names does.** `of` is a reference with
  `death: release`: the row goes when the entity dies and the value is free
  again. (A cascade would tombstone an id derived from the value, and the value
  could never be used again.)
- **Incomplete keys are rejected:** a key with no kind, no value or no `of`
  never reaches storage.
- **Stating a held value lands on its holder.** A batch that mints an entity
  under a `$alias` and claims a value somebody already holds patches that entity
  instead of writing a second one — which is what makes a seed, a chunked
  import, and a page that saves itself every time it opens all idempotent. A
  caller who wrote an id down is refused instead, with the holder named.

## The vocabulary

| component        | what it says                                     |
| ---------------- | ------------------------------------------------ |
| `key{of, value}` | this entity answers to this value                |
| your tag         | which kind of value it is (`key: true` declares) |

A tag declares the component it qualifies: `key: true` marks a key tag and
`edge: true` marks an edge tag. A string value names its query relationship, for
example `key: 'mailbox'` on an `email` component.

## Retiring a value

```ts
import { unkeyed } from '@yaks/key'
g.apply([unkeyed('isbn', '9780441013593')])
```

The operation removes the components but retains the identity. The value can
then be claimed by the same owner or a different owner.

## Composed with

[@yaks/alias](https://jsr.io/@yaks/alias) is the kind of key that is a **name**:
the word a person or an agent types instead of an id, resolved wherever an eid
goes.
