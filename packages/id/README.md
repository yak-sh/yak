# @yaks/id

Entity ids: the **eid** a client mints, and the **human id** a person types.

## Install

```sh
deno add jsr:@yaks/id
# or: npx jsr add @yaks/id
```

## Two ids, one entity

An entity's durable identity is its **eid** — a uuid, minted by whoever creates
the entity, the browser included, so a write never waits for the store to name
it. Nobody says a uuid out loud, so an entity also wears a **human id**: a
letter and a number, `B-7`. The number comes from the store; the letter comes
from the vocabulary.

## The `prefix` keyword

This package owns one keyword. A component that declares `"prefix": "B"` says
its entities are numbered in the `B` series:

```json
{
  "$vocabulary": {
    "https://yaks.sh/vocab/core": true,
    "https://yaks.sh/vocab/id": true
  },
  "$defs": {
    "book": {
      "type": "object",
      "kind": true,
      "prefix": "B",
      "properties": { "title": { "type": "string" } }
    }
  }
}
```

Register the keyword vocabulary when you load the schema, and the ids follow:

```ts
import { loadVocab } from '@yaks/vocab'
import { idKeywords, idOf, mint, parse } from '@yaks/id'

let v = loadVocab([catalog], [idKeywords])
let id = idOf(v)

id({ eid: mint(), kind: 'book', num: 7 }) // 'B-7'
id({ eid: 'a3f19c02-…', kind: 'book' }) // 'a3f19c02' — not numbered yet
parse('B-7') // { prefix: 'B', num: 7 }
parse('7') // { prefix: '', num: 7 }
```

The letter is display, the number is identity: `B-7` and `7` name the same book,
so an id typed from memory — or in the wrong case — still lands. A component
that declares no prefix borrows its own initial, so every entity has an id to
show. An entity the store has not numbered yet wears the short handle instead:
the eid's leading 8 hex, typeable and resolvable by prefix match.

## The surface

| export                 | is                                                              |
| ---------------------- | --------------------------------------------------------------- |
| `idKeywords`, `ID_URI` | the `prefix` keyword vocabulary, ready to register              |
| `mint()`               | a fresh eid (a v4 uuid)                                         |
| `short(eid)`, `SHORT`  | the 8-hex handle, and what one looks like as a token            |
| `prefixes(v)`          | every declared prefix: component name → letter                  |
| `prefixOf(v)`          | the letter a component's ids wear (declared, or its initial)    |
| `format(prefix, num)`  | `'B-7'`                                                         |
| `parse(id)`            | `'B-7'` → `{ prefix: 'B', num: 7 }`; `undefined` if it is no id |
| `idOf(v)`              | an entity → the id every door should speak it by                |

## Where it sits

A splinter of [@yaks/vocab](https://jsr.io/@yaks/vocab): the meta-model carries
the `prefix` keyword without knowing what it means, and this package is what it
means. Resolving a typed id back to a stored entity belongs to the storage
adapter — [@yaks/sqlite](https://jsr.io/@yaks/sqlite) and its siblings — which
uses `parse` to read the number out of what a person typed.

## Compatibility

Pure TypeScript. Its only dependency is
[@yaks/vocab](https://jsr.io/@yaks/vocab) (types plus a loaded schema), and
`mint()` needs `crypto.getRandomValues`, which every modern runtime has. Runs on
**Deno**, **Node**, and in the **browser**.
