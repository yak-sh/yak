# @yaks/key

The values an entity answers to — as entities — for a
[@yaks/graph](https://jsr.io/@yaks/graph).

## Install

```sh
deno add jsr:@yaks/key
# or: npx jsr add @yaks/key
```

## The idea

This package is to a has-many **value** exactly what
[@yaks/edge](https://jsr.io/@yaks/edge) is to a **link**: one generic carrier
component, tagged by the application's own words, with the entity's id derived
from what it says. An edge is `edge{from, to}` plus a tag (`cites`); a key is
`key{of, value}` plus a tag (`isbn`, `email`, `alias`). Because the id is
derived, stating the same thing twice writes one row in both packages — and
because the carrier is its own entity, one book has as many isbns, one person as
many addresses, as you write.

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
- **Half a sentence is refused**, by name: a key with no kind, no value or no
  `of` never reaches storage.
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

A tag says the **carrier's** name: `key: true` on a key's tag, `edge: true` on
an edge's. One rule — this tag rides that component — reads them all. Declaring
a string instead names the reading (`key: 'mailbox'` on an `email` component),
the way `@yaks/edge` reads a `references` tag as `referenced`.

## Retiring a value

```ts
import { unkeyed } from '@yaks/key'
g.apply([unkeyed('isbn', '9780441013593')])
```

The components go; the identity stays, so the same value can be claimed again
tomorrow — by this entity or another.

## Composed with

[@yaks/alias](https://jsr.io/@yaks/alias) is the kind of key that is a **name**:
the word a person or an agent types instead of an id, resolved wherever an eid
goes.
