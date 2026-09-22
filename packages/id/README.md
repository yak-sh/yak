# @yaks/id

UUID creation and human-readable entity ID formatting. Vocabulary prefixes
control display; storage adapters or graph address plugins are responsible for
resolving IDs to entities. This package stores nothing and does not assign
database numbers.

## Install

```sh
deno add jsr:@yaks/id
# or: npx jsr add @yaks/id
```

## Two ids, one entity

An entity's durable identifier is its **eid**. `mint()` generates a UUID on the
client, so creating an id does not require a database round trip. The graph can
also accept other string ids; not every package uses UUIDs. A numbered entity
has a **human id**, such as `B-7`, for easier reading and typing. Storage
assigns the number; the vocabulary (the component schema) supplies the prefix.

## The `prefix` keyword

This package owns one keyword. A component that declares `"prefix": "B"` formats
its numbered entities with a `B` prefix; it does not allocate numbers:

```json
{
  "$vocabulary": {
    "https://yaks.sh/vocab/core": true,
    "https://yaks.sh/vocab/id": true
  },
  "$defs": {
    "book": {
      "type": "object",
      "component": true,
      "kind": true,
      "prefix": "B",
      "properties": { "title": { "type": "string" } }
    }
  }
}
```

Call the JSON document above `catalog`, then register the keyword vocabulary
when loading it. This enables prefix formatting; it does not allocate numbers:

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

The number identifies the record within a store: `B-7` and `7` can resolve to
the same book. `parse()` normalizes a prefix to uppercase. Resolvers may
validate that a supplied prefix matches one of the entity's component kinds, so
a wrong prefix is not necessarily accepted. A component that declares no prefix
uses its own initial, so every entity has an id to show. An entity the store has
not numbered yet gets a short handle instead: the component's prefix letter,
`#`, and the first 10 hex characters of the eid with its dashes removed. The `#`
is what keeps an all-digit eid fragment from being read as a number. Resolvers
accept `#` fragments with or without the prefix letter (at least 6 hex
characters), reject ambiguous ones, and check a supplied prefix letter after
resolving the fragment. Full UUIDs remain valid input. Web links encode the `#`
as `%23`, since a literal `#` starts a browser fragment rather than a path.
Quote a bare `#` handle in a shell (`task show '#3f9a1c2e7b'`), where an
unquoted leading `#` starts a comment.

A **bundle** is one entity's components as a JSON object, with its identifier
under `entity.eid`. `human(v)` formats the ID from that object.

## Exports

| export                         | is                                                                 |
| ------------------------------ | ------------------------------------------------------------------ |
| `idKeywords`, `ID_URI`         | the `prefix` keyword vocabulary, ready to register                 |
| `mint()`                       | a fresh eid (a v4 UUID)                                            |
| `short(eid, prefix?)`, `SHORT` | the 10-hex `#` handle, and the pattern that matches one            |
| `prefixes(v)`                  | every declared prefix: component name → letter                     |
| `prefixOf(v)`                  | the letter a component's ids have (declared, or its initial)       |
| `format(prefix, num)`          | `'B-7'`                                                            |
| `parse(id)`                    | `'B-7'` → `{ prefix: 'B', num: 7 }`; `undefined` if it is no id    |
| `idOf(v)`                      | an entity → its display ID                                         |
| `human(v)`                     | a bundle (`{entity: {eid, num?}, ...components}`) → its display ID |

## Integration

An extension of [@yaks/vocab](https://jsr.io/@yaks/vocab): the meta-model
carries the `prefix` keyword without interpreting it, and this package supplies
the interpretation. Resolving a typed id back to a stored entity belongs to the
storage adapter — [@yaks/sqlite](https://jsr.io/@yaks/sqlite) and its siblings —
which calls `parse` to read the number out of what a person typed.

## Compatibility

Pure TypeScript. Its only dependency is
[@yaks/vocab](https://jsr.io/@yaks/vocab) (types plus a loaded schema), and
`mint()` needs `crypto.getRandomValues`, which every modern runtime has. Runs on
**Deno**, **Node**, and in the **browser**.
