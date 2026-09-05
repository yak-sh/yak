# @yaks/names

Resolve an entity **by name** — the name a person actually types.

## Install

```sh
deno add jsr:@yaks/names
# or: npx jsr add @yaks/names
```

## Not everything has a name

An author is reached as `Ursula Le Guin`. A review is not reached by the
sentence it opens with, even though it has a title too: a word deep inside a
store's prose matches by coincidence, and in a large store there is always one.
So a component says which it is.

## The `by_name` keyword

This package owns one keyword. A component that declares `"by_name": true` says
its entities answer to a name, read from the vocabulary's name column (`title`
by default); a string names a different column.

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

A candidate is anything with its components under `comps`, and you get your own
object back — the package reads the vocabulary and the name, never your row
type.

## Matching

An exact name always wins. Failing that the closest name above the match floor
wins, because nobody types a name the way it is stored: the case drifts, the
punctuation goes, and a long name gets abbreviated to its first word. Pass
`{ close: 1 }` to accept exact names only.

`match.ts` is the scoring on its own — `score`, `closeness`, `nearest` — usable
over any list, in case you want the same reading of "close enough" somewhere
else (a did-you-mean, say). Two gates keep containment off coincidence: a short
word must cover most of the longer name, and a prefix beats a word merely
spelled inside it, because a prefix is how a name gets shortened.

## The surface

| export                                   | is                                                    |
| ---------------------------------------- | ----------------------------------------------------- |
| `nameKeywords`, `NAMES_URI`              | the `by_name` keyword vocabulary, ready to register   |
| `named(v)`                               | every component addressable by name → its name column |
| `nameOf(v)`                              | an entity → its name, or nothing when it has none     |
| `resolve(v)`                             | a typed name + candidates → the entity meant          |
| `score`, `closeness`, `nearest`, `CLOSE` | the matching, on its own                              |

## Where it sits

A splinter of [@yaks/vocab](https://jsr.io/@yaks/vocab): the meta-model carries
the `by_name` keyword without knowing what it means, and this package is what it
means. It sits beside [@yaks/id](https://jsr.io/@yaks/id), which owns the other
way an entity is addressed — the human id (`B-7`) a person types.

## Compatibility

Pure TypeScript. Its only dependency is
[@yaks/vocab](https://jsr.io/@yaks/vocab) (types plus a loaded schema). Runs on
**Deno**, **Node**, and in the **browser**.
