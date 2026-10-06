# @yaks/fp

Small functions for composition, object copies, lists, comparison and waits,
with no dependencies. Pipes and sequential steps stay synchronous until an input
or a step returns a promise.

A **curried function** takes arguments in successive calls: `add(2)(3)` adds 2
to 3. **nil** means `null` or `undefined`; `0`, `false` and `''` are not nil. A
**pipe** applies functions left to right and stops at nil (`pipe`).

```ts
import { defaults, guard, inc, pipe, prop, tally, update } from '@yaks/fp'
import { equal } from '@yaks/testing'

let next = pipe(
  defaults({ count: 0 }),
  update({ count: inc }),
  prop('count'),
  guard((n: number) => n > 0),
)
equal(next({ count: null }), 1)
equal(next({ count: -2 }), undefined)
equal(tally('status')([{ status: 'open' }, { status: 'open' }]), { open: 2 })
```

## Exports

| Export     | Provides                                                                              |
| ---------- | ------------------------------------------------------------------------------------- |
| `@yaks/fp` | All functions, `Fn` (a function of any shape) and `Table` (see [Dispatch](#dispatch)) |

## Composition and values

`compose` applies functions right to left. Given one function, it waits for
another function to compose beneath it. `pipe` also stops when its input is nil;
an empty pipe returns its input. `guard` returns `undefined` when its predicate
fails, which stops a pipe.

`tap` calls a function and returns its input; it does not wait for a promise
returned by that function. `typeOf` distinguishes null, arrays, regexes,
promises, maps and sets from the other `typeof` results.

```ts
import {
  always,
  compose,
  guard,
  id,
  inc,
  isNil,
  negate,
  not,
  or,
  pipe,
  tap,
  typeOf,
} from '@yaks/fp'
import { equal } from '@yaks/testing'

let seen: number[] = []
equal(pipe(guard((n: number) => n > 0), tap((n) => seen.push(n)), inc)(2), 3)
equal(pipe(guard((n: number) => n > 0), inc)(-1), undefined)
equal(seen, [2])
equal(pipe(inc)(null), null)
equal(pipe()(false), false)
equal(compose(String, inc, inc)(5), '7')
equal(compose(String)(inc)(5), '6')
equal(id(7), 7)
equal(always(7)(), 7)
equal(isNil(null), true)
equal(isNil(0), false)
equal(negate(isNil)(0), true)
equal(not(false), true)
equal(or(10)(null), 10)
equal(or(10)(0), 0)
equal([null, [], /a/, new Map(), new Set(), Promise.resolve(1)].map(typeOf), [
  'null',
  'array',
  'regex',
  'map',
  'set',
  'promise',
])
```

## Synchronous values and promises

`isPromise` recognizes a value with a callable `then`, including a thenable that
is not a native `Promise`. `after(v, f)` calls `f` with a plain value
immediately or through `v.then(f)` when `v` is a promise. `f` may itself return
a promise.

`each(items, seed, step)` carries an accumulator through items in order.
`over(items, fn)` runs a function for each item in order and returns `null`.
Both wait for a step's promise before proceeding. A pipe also waits for a
promise before testing for nil or applying its next function.

```ts
import { after, each, inc, isPromise, over, pipe } from '@yaks/fp'
import { equal } from '@yaks/testing'

equal(after(1, inc), 2)
equal(await after(Promise.resolve(1), inc), 2)
equal(isPromise({ then: () => {} }), true)
equal(each([1, 2, 3], 0, (sum, n) => sum + n), 6)
equal(await each([1, 2, 3], 0, (sum, n) => Promise.resolve(sum + n)), 6)
let seen: number[] = []
equal(
  await over([1, 2], async (n) => {
    seen.push(n)
  }),
  null,
)
equal(seen, [1, 2])
equal(await pipe(inc, (n: number) => Promise.resolve(n), inc)(1), 3)
equal(await pipe(() => Promise.resolve(null), inc)(1), null)
```

## Dispatch

A **tag** is the value `when` uses to select a function: `test(x)`, or `x`
itself when `test` is `null`. A **dispatch table** maps tags to functions, with
`_` as the default (`Table`). With no matching entry or default, `when` returns
its input. Each selected function receives the input and the tag.

Given a function instead of a dispatch table, `when` calls it only when the tag
is truthy.

```ts
import { always, isNil, typeOf, when } from '@yaks/fp'
import { equal } from '@yaks/testing'

let label = when(typeOf, { number: (n) => `#${n}`, _: String })
equal(label(7), '#7')
equal(label(true), 'true')
equal(when(typeOf, { number: String })('keep'), 'keep')
equal(when(null, { open: (_x, tag) => `${tag}!` })('open'), 'open!')
equal(when(isNil, always(0))(null), 0)
equal(when(isNil, always(0))(5), 5)
```

## Object copies

`beget` makes a shallow object copy and passes it to a function to modify.
`set`, `update`, `defaults` and `incProp` also return object copies. `set`
overlays values; `update` applies a function to each named value; `defaults`
fills named nil values. `incProp` increments a named count, starting from zero
when nil. These copies retain references to nested objects.

`prop` reads a key, or returns a supplied function unchanged. `mapObj` maps
values with their keys; given an array of objects, it maps each object's entries
and keeps the last result for each repeated key.

```ts
import {
  beget,
  defaults,
  inc,
  incProp,
  mapObj,
  prop,
  set,
  update,
} from '@yaks/fp'
import { equal } from '@yaks/testing'

let original = { count: 1, label: 'a' }
equal(
  beget(original, (copy) => {
    copy.count = 2
  }),
  { count: 2, label: 'a' },
)
equal(set({ label: 'b' })(original), { count: 1, label: 'b' })
equal(update({ count: inc })(original), { count: 2, label: 'a' })
equal(original, { count: 1, label: 'a' })
equal(defaults({ count: 0, label: 'a' })({ count: null }), {
  count: 0,
  label: 'a',
})
equal(incProp('count')({}), { count: 1 })
equal(prop('label')(original), 'a')
equal(prop(inc)(1), 2)
equal(mapObj((v: number, k) => `${k}${v}`)({ a: 1 }), { a: 'a1' })
equal(mapObj(inc)([{ a: 1, b: 1 }, { b: 2 }]), { a: 2, b: 3 })
```

## Lists and counts

`map`, `filter` and `reject` return arrays. `fold(fn, init)` accumulates a value
with `fn(item, index)(accumulator)`, so `add` can be its step directly. `tally`
counts items by a key read with `prop`. It copies the counts for each item; for
large counts in a hot loop, consider accumulating into your own `Map`.

```ts
import {
  add,
  dec,
  filter,
  fold,
  inc,
  isNil,
  map,
  reject,
  tally,
} from '@yaks/fp'
import { equal } from '@yaks/testing'

equal(map(inc)([1, 2]), [2, 3])
equal(filter(isNil)([1, null, 2]), [null])
equal(reject(isNil)([1, null, 2]), [1, 2])
equal(fold(add, 0)([1, 2, 3]), 6)
equal(add(2)(3), 5)
equal(dec(3), 2)
equal(tally((n: number) => n % 2 ? 'odd' : 'even')([1, 2, 3]), {
  odd: 2,
  even: 1,
})
```

## Comparison and insertion

`cmp` compares values for `sort`. Arrays compare item by item, then by length;
values of different types compare by their `typeOf` names. A value with a `cmp`
method supplies its own comparison. Otherwise `cmp` uses `<` and `>` and returns
-1, 0 or 1.

`same(a, b)` says whether two values hold the same data: the same scalar, or
arrays and plain objects whose items are the same under the same keys. The order
an object's keys were written in does not matter.

`bsearch(x)(xs)` finds the insertion index in an array sorted by `cmp`, after
all equal items. It does not insert the value.

```ts
import { bsearch, cmp, same } from '@yaks/fp'
import { equal } from '@yaks/testing'

equal([10, 9, 1].sort(cmp), [1, 9, 10])
equal(same({ a: 1, b: [2] }, { b: [2], a: 1 }), true)
equal(same({ a: 1 }, { a: 1, b: null }), false)
equal(cmp([1, 'b'], [1, 'a']), 1)
equal(cmp([1], [1, 0]), -1)
equal(cmp<unknown>(1, '1'), -1)
equal(cmp<unknown>({ cmp: () => 1 }, 0), 1)
let sorted = [1, 2, 2, 4]
equal(bsearch(2)(sorted), 3)
sorted.splice(bsearch(3)(sorted), 0, 3)
equal(sorted, [1, 2, 2, 3, 4])
```

## Waits

`backoff(attempts)` returns an exponential wait in milliseconds: 1000 at attempt
1, doubling up to 300000. `sleep(ms, signal?)` returns a promise that resolves
when the timer expires or the signal aborts; aborting does not reject. An
already aborted signal resolves without waiting.

```ts
import { backoff, sleep } from '@yaks/fp'
import { equal } from '@yaks/testing'

equal([1, 2, 3, 10].map(backoff), [1000, 2000, 4000, 300000])
let controller = new AbortController()
let waiting = sleep(300000, controller.signal)
controller.abort()
equal(await waiting, undefined)
equal(await sleep(300000, controller.signal), undefined)
```

## Limits

The package has no dependencies. `sleep` needs the runtime's timer APIs and uses
`AbortSignal` when one is supplied. Object copies are shallow, and these
functions do not enforce immutability of their inputs or of user functions.
