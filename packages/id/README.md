# @yaks/id

UUID creation and human-readable entity ID formatting. Vocabulary prefixes
control display; storage adapters are responsible for resolving IDs to entities.

## Install

```sh
deno add jsr:@yaks/id
# or: npx jsr add @yaks/id
```

## Two ids, one entity

An entity's durable identity is its **eid** — a uuid, minted by whoever creates
the entity, the browser included, so a write never waits for the store to name
it. Nobody says a uuid out loud, so an entity also has a **human id**: a letter
and a number, `B-7`. The number comes from the store; the letter comes from the
vocabulary.

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
id({ eid: 'a3f19c02-4b00-4000-8000-000000000001', kind: 'book' }) // 'B#a3f19c024b'
parse('B-7') // { prefix: 'B', num: 7 }
parse('7') // { prefix: '', num: 7 }
```

The letter is display, the number is identity: `B-7` and `7` name the same book,
so an id typed from memory — or in the wrong case — still lands. A component
that declares no prefix borrows its own initial, so every entity has an id to
show. An entity the store has not numbered yet has the short handle instead: the
kind prefix, `#`, and the eid's leading 10 dashless hex. The sigil distinguishes
even an all-digit eid fragment from a number. Resolvers accept prefixed or bare
`#` fragments (at least 6 hex), refuse ambiguity, and check a supplied kind
prefix after resolving the fragment. Full UUIDs remain valid input. Web links
encode the sigil as `%23`, since a literal `#` starts a browser fragment, not a
path. Quote bare sigilled handles in a shell (`task show '#3f9a1c2e7b'`), where
an unquoted leading `#` starts a comment.

## Exports

| export                         | is                                                              |
| ------------------------------ | --------------------------------------------------------------- |
| `idKeywords`, `ID_URI`         | the `prefix` keyword vocabulary, ready to register              |
| `mint()`                       | a fresh eid (a v4 uuid)                                         |
| `short(eid, prefix?)`, `SHORT` | the 10-hex sigilled handle, and the input token pattern         |
| `prefixes(v)`                  | every declared prefix: component name → letter                  |
| `prefixOf(v)`                  | the letter a component's ids have (declared, or its initial)    |
| `format(prefix, num)`          | `'B-7'`                                                         |
| `parse(id)`                    | `'B-7'` → `{ prefix: 'B', num: 7 }`; `undefined` if it is no id |
| `idOf(v)`                      | an entity → its display ID                                      |

## Integration

An extension of [@yaks/vocab](https://jsr.io/@yaks/vocab): the meta-model
carries the `prefix` keyword without knowing what it means, and this package is
what it means. Resolving a typed id back to a stored entity belongs to the
storage adapter — [@yaks/sqlite](https://jsr.io/@yaks/sqlite) and its siblings —
which uses `parse` to read the number out of what a person typed.

## Compatibility

Pure TypeScript. Its only dependency is
[@yaks/vocab](https://jsr.io/@yaks/vocab) (types plus a loaded schema), and
`mint()` needs `crypto.getRandomValues`, which every modern runtime has. Runs on
**Deno**, **Node**, and in the **browser**.
