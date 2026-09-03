// A TypeScript port of the owner's own fp library. The original is plain JS at
// https://yak.sh/lib/fp.js — this is that vocabulary carried across, not a new
// one invented here, so the names, the currying (config first, data last) and
// the `///` doctests all come from there and a reader who knows that file
// already knows this one. Only what this repo uses is ported: the Proxy-backed
// pieces (`prop`, `has`, `match`) fight TypeScript and are deliberately absent
// until something needs them.
//
// Two of `pipe`'s semantics are the reason it is worth having, and both are the
// original's. It SHORT-CIRCUITS ON NIL, so a composition whose contract is
// "exactness or nothing" (sql.ts) declines by answering nothing rather than by
// branching at every step. And it AWAITS TRANSPARENTLY, so a step that becomes
// async later makes the whole composition async without one caller changing —
// which is what makes D-33198's store seam cheap, and why nothing here is
// async today.
//
// The doctests are the spec; fp_test.ts runs them as assertions, since this
// repo has no doctest runner. They are spelled as TypeScript, which is the one
// place the port departs from the original: a generic is fixed at the FIRST
// call, so where the config alone does not name the target type it is written
// out (`set<Rel>({…})`, `pipe<number | null>(…)`) instead of inferred.

// A transform over a value: the shape every step in a pipe has, which is why
// `pipe` needs no overloads.
export type Step<T> = (x: T) => T

// What may flow through a pipe: the value, nothing, or the promise of either.
export type Piped<T> = T | null | undefined | Promise<T | null | undefined>

/// pipe(inc, inc)(2) -> 4
/// pipe(inc, inc)(null) -> null
/// pipe<number | null>(id, always(null), inc)(3) -> null
/// pipe(inc, inc)(promise(2)) -> promise(4)
// The one cast in this file: the fold is typed over everything that may flow
// (a value, a nil, a promise), while the caller gets back exactly the shape it
// put in — a Rel in, a Rel out.
export let pipe = <T>(...steps: Step<T>[]) => <X extends Piped<T>>(x: X): X =>
  steps.reduce<Piped<T>>(
    (v, f) =>
      v == null
        ? v
        : v instanceof Promise
        ? v.then((w) => (w == null ? w : f(w)))
        : f(v),
    x,
  ) as X

/// push('c')(['a', 'b']) -> ['a', 'b', 'c']
/// push('a')() -> ['a']
export let push = <T>(...added: T[]) => (existing: T[] = []): T[] => [
  ...existing,
  ...added,
]

/// set<{a: number; b: number}>({a: 1})({a: 0, b: 2}) -> {a: 1, b: 2}
export let set = <T>(...props: Partial<T>[]) => (obj: T): T =>
  Object.assign({}, obj, ...props)

/// update({a: inc, b: dec})({a: 1, b: 2}) -> {a: 2, b: 1}
export let update =
  <T>(props: { [K in keyof T]?: (v: T[K]) => T[K] }) => (obj: T): T => {
    let out = { ...obj }
    for (let k in props) out[k] = props[k]!(obj[k])
    return out
  }
