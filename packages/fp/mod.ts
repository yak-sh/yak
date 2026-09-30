// A vocabulary of small curried functions, each word made of the words above
// it. A value is never changed in place: a change is a copy, tweaked and
// returned (`beget`). A `pipe` stops at the first nil, so a check is a
// function that answers nothing (`guard`), and it goes async only when a
// value on the way is a promise.

/** A function of any shape: the vocabulary composes whatever it is given. */
// deno-lint-ignore no-explicit-any -- words take and answer anything
export type Fn = (...args: any[]) => any

/** A dispatch table for `when`: a function per tag, `_` the default. */
export type Table = { [tag: string]: Fn }

/// id(1) -> 1
/** The value itself. */
export let id = <T>(x: T): T => x

/// always(1)() -> 1
/** A function answering `x`, whatever it is given. */
export let always = <T>(x: T) => (): T => x

/// tap(inc)(1) -> 1
/** Calls `f` for what it does, and answers the value it was given. */
export let tap =
  <T, R extends unknown[]>(f: (x: T, ...rest: R) => unknown) =>
  (x: T, ...rest: R): T => (f(x, ...rest), x)

/// typeOf(null) -> 'null'
/// typeOf([]) -> 'array'
/// typeOf(/a/) -> 'regex'
/// typeOf(new Map()) -> 'map'
/// typeOf(1) -> 'number'
/** `typeof`, telling null, arrays, regexes, promises, maps and sets apart. */
export let typeOf = (x: unknown): string =>
  x === null
    ? 'null'
    : Array.isArray(x)
    ? 'array'
    : x instanceof RegExp
    ? 'regex'
    : x instanceof Promise
    ? 'promise'
    : x instanceof Map
    ? 'map'
    : x instanceof Set
    ? 'set'
    : typeof x

/// isNil(null) -> true
/// isNil(0) -> false
/** Whether `x` is null or undefined. */
export let isNil = (x: unknown): x is null | undefined => x == null

/// not(0) -> true
/** The opposite of a value's truth. */
export let not = (x: unknown): boolean => !x

let of = (f: Fn, g: Fn): Fn => (...xs) => f(g(...xs))

/// compose(String, inc, inc)(5) -> '7'
/// compose(compose(String), add)(7)(2) -> '9'
/**
 * Functions applied right to left: `compose(f, g)(x)` is `f(g(x))`. Given
 * only `f`, it waits for the function to go under it.
 */
export let compose = (f: Fn, ...fs: Fn[]): Fn =>
  fs.length ? fs.reduce(of, f) : (g: Fn) => of(f, g)

/// negate(isNil)(null) -> false
/** A predicate's opposite. */
export let negate: (f: Fn) => Fn = compose(not)

// Staying synchronous when nothing forces a promise. An interface may answer
// now or later: a storage adapter over an embedded database returns
// immediately, one over a network returns a promise, and the same pipeline
// has to serve both. So instead of making everything `async` (which would turn
// every embedded write into a promise, and every caller into an `await`), each
// step goes through `after`: a promise is awaited, a plain value passes
// straight through.
//
// The rule that falls out: a pipeline built only from synchronous parts stays
// synchronous end to end, and the first asynchronous part turns the rest of
// that one run into a promise chain. Nothing in between needs to know which.

/// isPromise(Promise.resolve(1)) -> true
/// isPromise({ then: id }) -> true
/// isPromise(1) -> false
/// isPromise(null) -> false
/** Whether a value is thenable: the test `after` and `each` branch on. */
export let isPromise = <T>(v: T | Promise<T>): v is Promise<T> =>
  !!v && typeof (v as Promise<T>).then == 'function'

/// after(1, inc) -> 2
/// after(Promise.resolve(1), inc) ~> 2
/**
 * `f` applied to a value that may still be in flight: a promise is awaited, a
 * plain value is passed straight in, and the answer is a promise only when
 * the value was one.
 */
export let after = <A, B>(
  v: A | Promise<A>,
  f: (a: A) => B,
): B | Promise<Awaited<B>> =>
  isPromise(v)
    ? v.then(f) as Promise<Awaited<B>>
    : f(v) as B | Promise<Awaited<B>>

/// each(['a', 'b', 'c'], '', (s, c) => s + c) -> 'abc'
/// each(['a', 'b', 'c'], '', (s, c) =>
///   c == 'b' ? Promise.resolve(s + c) : s + c) ~> 'abc'
/**
 * `items` folded one at a time from `seed`, a step awaited only when it
 * answers a promise. While every step is synchronous this is a plain loop;
 * the first promise moves the items left into a promise chain, so a long
 * synchronous run never grows the stack.
 */
export let each = <T, A>(
  items: T[],
  seed: A,
  step: (acc: A, item: T) => A | Promise<A>,
): A | Promise<A> => {
  let acc: A | Promise<A> = seed
  for (let i = 0; i < items.length; i++) {
    if (isPromise(acc)) {
      let rest = items.slice(i)
      return acc.then((a) => each(rest, a, step))
    }
    acc = step(acc, items[i])
  }
  return acc
}

/// let seen: string[] = []
/// over(['a', 'b'], (s) => seen.push(s)) -> null
/// seen -> ['a', 'b']
/// over([1], (n) => Promise.resolve(n)) ~> null
/** `fn` run over each item in order, for what it does: `each` with no sum. */
export let over = <T>(
  items: T[],
  fn: (item: T) => unknown,
): null | Promise<null> =>
  each(items, null, (_, item) => after(fn(item), always(null)))

let step = (x: unknown, f: Fn): unknown => after(x, (v) => v == null ? v : f(v))

/// pipe(inc, inc)(2) -> 4
/// pipe(inc, inc)(null) -> null
/// pipe(inc, always(null), inc)(3) -> null
/// pipe(inc, (n) => Promise.resolve(n), inc)(3) ~> 5
/// pipe(inc, (n) => Promise.resolve(null), inc)(3) ~> null
/// pipe()(1) -> 1
/**
 * Functions applied left to right, stopping at the first nil. It goes async
 * only when a value on the way is a promise, and then answers one.
 */
export let pipe = (...fs: Fn[]): Fn => (x) => fs.reduce(step, x)

/// when(isNil, always(0))(null) -> 0
/// when(isNil, always(0))(5) -> 5
/// when(typeOf, { number: inc, _: String })(1) -> 2
/// when(typeOf, { number: inc, _: String })(true) -> 'true'
/// when(typeOf, { number: inc })('a') -> 'a'
/// when(null, { a: (x, tag) => tag + '!' })('a') -> 'a!'
/**
 * Dispatch on a tag: `test(x)`, or `x` itself without a test. Given a
 * function, it runs when the tag holds and `x` passes untouched when not;
 * given a table, the tag's entry runs, or `_`, or nothing does. Either is
 * called with `x` and the tag.
 */
export let when = (test: Fn | null, desc: Fn | Table): Fn => (x) => {
  let tag = test ? test(x) : x
  return typeof desc == 'function'
    ? tag ? desc(x, tag) : x
    : (desc[tag] ?? desc._ ?? id)(x, tag)
}

/// guard(Array.isArray)([1]) -> [1]
/// guard(Array.isArray)(1) -> undefined
/** The value when `pred` holds, and nothing otherwise: a `pipe` stops there. */
export let guard = <T>(pred: (x: T) => unknown) => (x: T): T | undefined =>
  pred(x) ? x : undefined

/// or(1)(null) -> 1
/// or(1)(2) -> 2
/** The value, or `def` in place of nil. */
export let or = <D>(def: D) => <T>(x: T): NonNullable<T> | D => x ?? def

/// prop('a')({ a: 1 }) -> 1
/// prop(inc)(1) -> 2
/** A key's reader: `prop(k)(o)` is `o[k]`. A function is its own reader. */
export let prop: (k: PropertyKey | Fn) => Fn = when(typeOf, {
  function: id,
  _: (k: PropertyKey) => (o: Record<PropertyKey, unknown>) => o[k],
})

/// let held = { a: 1 }
/// beget(held, (o) => o.a = 2) -> { a: 2 }
/// held -> { a: 1 }
/** A copy of `x`, tweaked by `fn`: the value it was made from is untouched. */
export let beget = <T extends object>(x: T, fn: (copy: T) => unknown = id): T =>
  tap(fn)({ ...x })

/// mapObj(inc)({ a: 1, b: 2 }) -> { a: 2, b: 3 }
/// mapObj((v, k) => k + v)({ a: 1 }) -> { a: 'a1' }
/// mapObj(inc)([{ a: 1, b: 1 }, { b: 2 }]) -> { a: 2, b: 3 }
/**
 * An object's values mapped, keys kept; `fn` gets each value and its key. A
 * list of objects is merged first, the last to name a key winning.
 */
export let mapObj =
  <V, W>(fn: (v: V, k: string) => W) =>
  (o: Record<string, V> | Record<string, V>[]): Record<string, W> =>
    Object.fromEntries(
      [o].flat().flatMap((x) => Object.entries(x))
        .map(([k, v]) => [k, fn(v, k)]),
    )

/// set({ a: 1 })({ a: 0, b: 2 }) -> { a: 1, b: 2 }
/** A copy of an object with `props` laid over it. */
export let set =
  <P extends object>(...props: P[]) => <T extends object>(o: T): T & P =>
    Object.assign({}, o, ...props)

/// update({ a: inc, b: dec })({ a: 1, b: 2 }) -> { a: 2, b: 1 }
/** A copy of an object with each named value passed through its function. */
export let update =
  (...fns: Table[]) => <T extends Record<string, unknown>>(o: T): T =>
    set(mapObj((f: Fn, k) => f(o[k]))(fns))(o)

/// defaults({ a: 'def', b: 1 })({ a: 'orig' }) -> { a: 'orig', b: 1 }
/// defaults({ a: 1 })({ a: null }) -> { a: 1 }
/** A copy of an object with each nil value `props` names filled from it. */
export let defaults = (
  ...props: Record<string, unknown>[]
): <T extends Record<string, unknown>>(o: T) => T => update(mapObj(or)(props))

/// add(1)(2) -> 3
/** `a + b`, `b` given first. */
export let add = (b: number) => (a: number): number => a + b

/// inc(1) -> 2
export let inc: (a: number) => number = add(1)

/// dec(1) -> 0
export let dec: (a: number) => number = add(-1)

/// fold(add, 0)([1, 2, 3]) -> 6
/// fold((x) => (xs) => [x, ...xs], [])([1, 2]) -> [2, 1]
/**
 * A list folded into one value from `init`. Each item comes first, so a
 * curried word is already a step: `fn(x, i)(acc)`.
 */
export let fold =
  <X, A>(fn: (x: X, i: number) => (acc: A) => A, init: A) =>
  (xs: readonly X[]): A => xs.reduce((acc, x, i) => fn(x, i)(acc), init)

/// incProp('a')({ a: 1 }) -> { a: 2 }
/// incProp('a')({}) -> { a: 1 }
/** A copy of an object with one count raised, from 0 where it is absent. */
export let incProp = (
  k: string,
): (o: Record<string, number>) => Record<string, number> =>
  compose(update({ [k]: inc }), defaults({ [k]: 0 }))

let none: Record<string, number> = {}

/// tally('a')([{ a: 'b' }, { a: 'b' }, { a: 'c' }]) -> { b: 2, c: 1 }
/// tally((n) => n % 2 ? 'odd' : 'even')([1, 2, 3]) -> { odd: 2, even: 1 }
/** How many items share each key: a property's name, or a function. */
export let tally = (
  key: PropertyKey | Fn,
): (xs: readonly unknown[]) => Record<string, number> =>
  fold(compose(incProp, prop(key)), none)

/// map(inc)([1, 2]) -> [2, 3]
/** A list's items mapped. */
export let map =
  <X, Y>(fn: (x: X, i: number) => Y) => (xs: readonly X[]): Y[] => xs.map(fn)

/// filter(isNil)([1, null]) -> [null]
/** The items `pred` holds for. */
export let filter =
  <X>(pred: (x: X, i: number) => unknown) => (xs: readonly X[]): X[] =>
    xs.filter(pred)

/// reject(isNil)([1, null]) -> [1]
/** The items `pred` does not hold for. */
export let reject: <X>(
  pred: (x: X, i: number) => unknown,
) => (xs: readonly X[]) => X[] = compose(filter, negate)

/// cmp(1, 2) -> -1
/// cmp('b', 'a') -> 1
/// cmp(2, 2) -> 0
/// cmp([1, 'b'], [1, 'a']) -> 1
/// cmp([1], [1, 0]) -> -1
/// cmp(1, '1') -> -1
/// cmp({ cmp: () => 1 }, 0) -> 1
/// [10, 9, 1].sort(cmp) -> [1, 9, 10]
/**
 * A three-way comparison, for `sort`: -1, 0 or 1. Lists compare item by
 * item, a value with a `cmp` method compares itself, and values of two types
 * order by the type's name, so a mixed list still sorts one way.
 */
export let cmp = <T>(a: T, b: T): number =>
  typeof a == 'object' && a != null && 'cmp' in a && typeof a.cmp == 'function'
    ? a.cmp(b)
    : typeOf(a) != typeOf(b)
    ? cmp(typeOf(a), typeOf(b))
    : Array.isArray(a) && Array.isArray(b)
    ? a.slice(0, b.length).reduce((c, x, i) => c || cmp(x, b[i]), 0) ||
      cmp(a.length, b.length)
    : a < b
    ? -1
    : a > b
    ? 1
    : 0

/// bsearch(3)([1, 2, 4]) -> 2
/// bsearch(2)([1, 2, 2, 4]) -> 3
/// bsearch(0)([1]) -> 0
/// bsearch(5)([]) -> 0
/**
 * Where `x` goes in a list sorted by `cmp`: after every item that is not
 * greater, so inserting there keeps the list sorted and equal items in the
 * order they came.
 */
export let bsearch = <T>(x: T) => (xs: readonly T[]): number => {
  let lo = 0, hi = xs.length
  while (lo < hi) {
    let mid = (lo + hi) >> 1
    if (cmp(x, xs[mid]) < 0) hi = mid
    else lo = mid + 1
  }
  return lo
}
