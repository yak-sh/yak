# @yaks/id

UUID creation, the entity number a human-readable ID is built from, and the
formatting and resolution of IDs such as `B-7`. Numbers are opt in: a graph has
them because it loaded this package's document and registered its plugins, and
has none otherwise.

## Install

```sh
deno add jsr:@yaks/id
# or: npx jsr add @yaks/id
```

## Two ids, one entity

An entity's durable identifier is its **eid**. @yaks/graph's `mint()` generates
a UUID on the client, so creating an id does not require a database round trip.
The graph can also accept other string ids; not every package uses UUIDs. A
numbered entity has a **human id**, such as `B-7`, for easier reading and
typing. Storage assigns the number; the vocabulary (the component schema)
supplies the prefix.

## The `prefix` keyword

This package owns one keyword. A component that declares `"prefix": "B"` formats
its numbered entities with a `B` prefix; it does not allocate numbers:

```json
{
  "$vocabulary": {
    "https://yak.sh/vocab/core": true,
    "https://yak.sh/vocab/id": true
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
import { mint } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { idKeywords, idOf, parse } from '@yaks/id'

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

## Numbers are opt in

Most applications never show a number, so nothing here is on by default. There
are three pieces, and a graph takes the ones it wants:

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { idDoc, idKeywords } from '@yaks/id/vocab'
import { ids, numbers } from '@yaks/id/rules'

let vocab = loadVocab([catalog, idDoc], [idKeywords])
let g = graph({
  storage,
  vocab,
  plugins: [numbers(allocate), ids(vocab)],
})
```

- **`idDoc`** adds `num` to the `entity` row — the one property a number needs.
  It is an `extends` document ([@yaks/vocab](../vocab)): the spine is declared
  once, by whichever package declares it, and this adds a property to it rather
  than declaring a second `entity`.
- **`numbers(allocate)`** answers `$num: true` on a bundle. Code that creates an
  entity asks for a number per entity, by writing
  `{ entity: { eid }, $num: true, book: {} }`; the same request later numbers an
  entity that has none yet. The allocator runs inside the graph's write
  transaction and must return the existing number when asked again for the same
  entity. Nothing else requests a number: neither a component nor a display
  prefix does. A storage adapter can also number every entity as it is written
  (@yaks/sqlite's `number: true`), which is the other way to have numbers and
  needs no plugin.
- **`ids(vocab)`** resolves the id a person typed (`B-7`, or a bare `7`) to the
  eid it names, as a graph plugin's `address` — so the MCP server, the HTTP
  `/query` endpoint, the command line and a write all accept the ids people
  type. One that names nothing, including a letter that disagrees with the
  entity's own, is refused, never minted as an entity of that literal name.

A graph that registers none of this stores no number, displays none, and refuses
`$num: true` as a request nothing answers — an error naming the request, rather
than a write that silently returns no number.

On a host assembled from a config file ([@yaks/cli](../cli)), naming `@yaks/id`
among the plugins loads `idDoc` and installs `ids`.

## Exports

| export                         | is                                                                 |
| ------------------------------ | ------------------------------------------------------------------ |
| `idKeywords`, `ID_URI`         | the `prefix` keyword vocabulary, ready to register                 |
| `short(eid, prefix?)`, `SHORT` | the 10-hex `#` handle, and the pattern that matches one            |
| `prefixes(v)`                  | every declared prefix: component name → letter                     |
| `prefixOf(v)`                  | the letter a component's ids have (declared, or its initial)       |
| `format(prefix, num)`          | `'B-7'`                                                            |
| `parse(id)`                    | `'B-7'` → `{ prefix: 'B', num: 7 }`; `undefined` if it is no id    |
| `idOf(v)`                      | an entity → its display ID                                         |
| `human(v)`                     | a bundle (`{entity: {eid, num?}, ...components}`) → its display ID |
| `idDoc`                        | `entity{num}`, the property a number is kept in                    |
| `numbers(allocate)`            | the `$num` allocator, from `@yaks/id/rules`                        |
| `ids(v)`                       | human id → eid, from `@yaks/id/rules`                              |

## Integration

An extension of [@yaks/vocab](https://jsr.io/@yaks/vocab): the meta-model
carries the `prefix` keyword without interpreting it, and this package supplies
the interpretation. Reading a number out of a query also belongs to the storage
adapter — [@yaks/sqlite](https://jsr.io/@yaks/sqlite) and its siblings — which
calls `parse` on what a person typed.

## Compatibility

Pure TypeScript, and its only dependency is
[@yaks/vocab](https://jsr.io/@yaks/vocab) — `@yaks/id/rules` included. The
plugins there state the graph shapes they need structurally (`graph.ts`) rather
than importing [@yaks/graph](https://jsr.io/@yaks/graph): the dependency between
the two runs one direction, and this is the leaf end of it, because
[@yaks/sql](https://jsr.io/@yaks/sql) reads a human id with `parse` and
@yaks/graph is built over @yaks/sql. [@yaks/match](https://jsr.io/@yaks/match)
states the same thing about a bundle for the same reason. What the factories
return is a `Plugin` and passes wherever one is asked for. Runs on **Deno**,
**Node**, and in the **browser**.
