# @yaks/names

Vocabulary-based display names and fuzzy name matching. The caller supplies
candidate entities; this package does not query storage or enforce name
uniqueness.

## Install

```sh
deno add jsr:@yaks/names
# or: npx jsr add @yaks/names
```

## Selecting name fields

Only fields explicitly declared with `by_name` participate in name resolution. A
text field such as a review body should not become an entity name merely because
it contains matching words.

## The `by_name` keyword

This package owns one keyword. A component that declares `"by_name": true` makes
its entities addressable by name, read from the vocabulary's name column
(`title` by default); a string names a different column.

```json
{
  "$vocabulary": {
    "https://yaks.sh/vocab/core": true,
    "https://yaks.sh/vocab/names": true
  },
  "$defs": {
    "author": { "type": "object", "kind": true, "by_name": true },
    "shelf": {
      "type": "object",
      "kind": true,
      "by_name": "label",
      "properties": { "label": { "type": "string" } }
    }
  }
}
```

Register the keyword vocabulary when you load the schema, and names resolve:

```ts
import { loadVocab } from '@yaks/vocab'
import { named, nameKeywords, nameOf, resolve } from '@yaks/names'

let v = loadVocab([catalog], [nameKeywords])
let shelf = [
  { comps: { author: {}, doc: { title: 'Ursula Le Guin' } } },
  { comps: { review: {}, doc: { title: 'Ursula at her best' } } },
]

named(v) // { author: { comp: 'doc', prop: 'title' }, shelf: { … } }
nameOf(v)(shelf[0]) // 'Ursula Le Guin'
nameOf(v)(shelf[1]) // undefined — a review's title is not a name
resolve(v)('le guin', shelf) // the author
```

A candidate is any object with its components under `comps`, and you get your
own object back — the package reads the vocabulary and the name, never your row
type.

## Matching

An exact name always wins. Failing that, the closest name above the match
threshold wins, because nobody types a name exactly as it is stored: the case
drifts, the punctuation is dropped, and a long name gets abbreviated to its
first word. Pass `{ close: 1 }` to accept exact names only.

`match.ts` is the scoring on its own — `score`, `closeness`, `nearest` — usable
over any list, in case you want the same definition of "close enough" elsewhere
(in a did-you-mean suggestion, say). Two conditions keep substring matching from
firing on coincidence: the shorter string must cover most of the longer name,
and a string that is a prefix scores higher than one that merely appears
somewhere inside, because a prefix is how a name usually gets shortened.

## Exports

| export                                   | is                                                    |
| ---------------------------------------- | ----------------------------------------------------- |
| `nameKeywords`, `NAMES_URI`              | the `by_name` keyword vocabulary, ready to register   |
| `named(v)`                               | every component addressable by name → its name column |
| `nameOf(v)`                              | an entity → its name, or nothing when it has none     |
| `resolve(v)`                             | a typed name + candidates → the entity it refers to   |
| `score`, `closeness`, `nearest`, `CLOSE` | the matching, on its own                              |

## Integration

An extension of [@yaks/vocab](https://jsr.io/@yaks/vocab): the meta-model
carries the `by_name` keyword without interpreting it, and this package supplies
the interpretation. It sits beside [@yaks/id](https://jsr.io/@yaks/id), which
owns the other way an entity is addressed — the human id (`B-7`) a person types.

## Compatibility

Pure TypeScript. Its only dependency is
[@yaks/vocab](https://jsr.io/@yaks/vocab) (types plus a loaded schema). Runs on
**Deno**, **Node**, and in the **browser**.
