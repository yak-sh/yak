# @yaks/fp

A vocabulary of small curried functions, each word made of the words before it:
`inc` is `add(1)`, `negate` is `compose(not)`, `reject` is
`compose(filter, negate)`. Every word is one expression over plain values, its
examples are the `///` lines above it in `mod.ts`, and those lines run as its
tests.

```ts
import { beget, cmp, defaults, pipe, tally, typeOf, when } from '@yaks/fp'

let label = when(typeOf, { number: (n) => `#${n}`, _: String })
label(7) // '#7'

let options = defaults({ limit: 25, order: 'num' })
options({ limit: null }) // { limit: 25, order: 'num' }

let count = tally('status')
count([{ status: 'open' }, { status: 'open' }]) // { open: 2 }

let title = pipe((b) => b.doc, (doc) => doc.title)
title({ task: {} }) // undefined: no doc, so the title is never read

let next = beget({ n: 1 }, (o) => o.n = 2) // { n: 2 }, the first untouched
let sorted = [3, 1, 2].sort(cmp) // [1, 2, 3]
```

## Words

- **Basics**: `id`, `always`, `tap` (call for the effect, answer the value),
  `typeOf` (`typeof` telling null, arrays, regexes, promises, maps and sets
  apart), `isNil`, `not`.
- **Composing**: `compose` (right to left; given one function it waits for the
  next), `negate`, and `pipe`, left to right, which stops at the first nil and
  goes async only when a value on the way is a promise. `guard(pred)` answers
  nothing where `pred` fails, so a `pipe` stops there.
- **Dispatch**: `when(test, desc)` computes a tag with `test` and runs `desc`
  where the tag holds, or the tag's entry of a table, `_` the default.
- **Objects**, each answering a copy: `beget(x, fn)` (copy, tweak, return),
  `mapObj`, `set`, `update` (a function per key), `defaults` (fill the nil
  values), `or`, `prop` (a key's reader; a function is its own), `incProp`.
- **Lists**: `map`, `filter`, `reject`, `fold(fn, init)` (each item first, so a
  curried word is a step: `fold(add, 0)` sums), `tally(key)` (how many items
  share each key), `add`, `inc`, `dec`.
- **Order**: `cmp(a, b)` is a three-way comparison for `sort`: lists compare
  item by item, a value with a `cmp` method compares itself, and two types order
  by the type's name. `bsearch(x)(xs)` is where `x` goes in a list sorted by
  `cmp`, after its equals.

The words that answer a copy never change what they were given. `tally` copies
its counts at every item, so a hot loop over many rows counts in a `Map` of its
own.

## Compatibility

Pure functions with no dependencies and no platform APIs: any JavaScript
runtime.
