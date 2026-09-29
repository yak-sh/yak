// Terms, and unifying them. A term is any value: a variable, a scalar, or a
// list or object holding terms. An env is a plain object from a variable's name
// to its value, and it is never changed in place: binding a variable answers a
// copy (`set`). Unifying two terms answers the env that makes them equal, or
// null when none does. A `splat` in a list stands for a run of its items, so
// `[x, splat(y)]` is a list's head and its tail.
import { beget, tap, typeOf } from '@yaks/fp'
import type { Env } from './goal.ts'

/** A name for a slot in an env: a variable, or a relation keeping its facts. */
export type Slot = { isVar: boolean; toString(): string }

/** Any value: a variable, a scalar, or a list or object holding terms. */
// deno-lint-ignore no-explicit-any -- a term is whatever it is bound to
export type Term = any

/**
 * A logic variable. A named one is one variable wherever the name is written,
 * so `lvar('x') === lvar('x')`; a fresh one has a name of its own.
 */
export class Var {
  name: string
  constructor(name: string) {
    this.name = name
  }
  get isVar(): boolean {
    return true
  }
  toString(): string {
    return this.name
  }
  /** The variable named for this one's part `name`: `x.var('a')` is `x.a`. */
  var(name: string): Var {
    return lvar(`${this}.${name}`)
  }
}

let named = new Map<string, Var>()
let fresh = 0

/// lvar() ~> Var
/// lvar('x') -> lvar('x')
/// lvar() == lvar() -> false
/** The variable `name`, or a fresh one. */
export let lvar = (name?: string): Var =>
  name == null
    ? new Var(`~.${fresh++}`)
    : named.get(name) ?? tap((v: Var) => named.set(name, v))(new Var(name))

/// nvars(3) ~> [Var, Var, Var]
/** `length` fresh variables. */
export let nvars = (length: number): Var[] =>
  Array.from({ length }, () => lvar())

/// lvars.x -> lvar('x')
/** Every named variable, by its name: `let { a, b } = lvars`. */
export let lvars: Record<string, Var> = new Proxy({}, {
  get: (_, name) => typeof name == 'string' ? lvar(name) : undefined,
})

export let x: Var = lvar('x')
export let y: Var = lvar('y')
export let z: Var = lvar('z')

/// isVar(x) -> true
/// isVar(1) -> false
/** Whether a term names a slot in an env: a variable, or a relation's facts. */
export let isVar = (x: Term): boolean => Boolean(x?.isVar)

/** `_` unifies with any value, and never binds. */
export let _: Var = lvar('_')

/** `...value` inside a list: a run of the list's items. */
export class Splat {
  value: Term
  constructor(value: Term) {
    this.value = value
  }
}

/// splat([1]) ~> Splat
/** `...value` inside a list pattern or literal. */
export let splat = (value: Term): Splat => new Splat(value)

/// isSplat(splat(x)) -> true
/// isSplat(x) -> false
export let isSplat = (x: Term): x is Splat => x instanceof Splat

/// get(x)({ x: 1 }) -> 1
/// get(y, 0)({}) -> 0
/** What `key` is bound to, or `def`. */
export let get = (key: Term, def?: Term) => (env: Env): Term => env[key] ?? def

/// set(x, 1)({}) -> { x: 1 }
/// set(_, 1)({}) -> {}
/** The env with `key` bound to `value`; `_` binds nothing. */
export let set = (key: Term, value: Term) => (env: Env): Env =>
  key === _ || value === _ ? env : beget(env, (e) => e[key] = value)

/// update(x, (n = 0) => n + 1)({ x: 1 }) -> { x: 2 }
/** The env with `key` bound to `fn` of what it was. */
export let update = (key: Term, fn: (v: Term) => Term) => (env: Env): Env =>
  set(key, fn(env[key]))(env)

/// walk(x, { x: 1 }) -> 1
/// walk(x, { x: y, y: 1 }) -> 1
/// walk(x, {}) -> x
/** A variable's value, followed through the variables it is bound to. */
export let walk = (x: Term, env: Env): Term => {
  if (!isVar(x)) return x
  let val = env[x]
  return val === undefined ? x : walk(val, env)
}

/// walkAll({ x: 1, y: 2 }, [x, y]) -> [1, 2]
export let walkAll = (env: Env, xs: Term[]): Term[] =>
  xs.map((x) => walk(x, env))

let plain = (x: Term): boolean =>
  typeOf(x) == 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x))

/// deepwalk(x, { x: y, y: 1 }) -> 1
/// deepwalk([x, y], { x: y, y: 1 }) -> [1, 1]
/// deepwalk([x, splat([y])], { x: y, y: 1 }) -> [1, 1]
/// deepwalk({ a: [x] }, { x: 1 }) -> { a: [1] }
/**
 * A term with every variable inside it walked: a splat whose value is a list
 * becomes its items. A plain object is walked into; any other object, a
 * response or a date, is a value of its own.
 */
export let deepwalk = (x: Term, env: Env): Term => {
  if (isSplat(x)) return splat(deepwalk(x.value, env))
  if (plain(x)) {
    return Object.fromEntries(
      Object.entries(x).map(([k, v]) => [k, deepwalk(v, env)]),
    )
  }
  if (!Array.isArray(x)) {
    let y = walk(x, env)
    return x == y ? y : deepwalk(y, env)
  }
  return x.flatMap((v) => {
    if (!isSplat(v)) return [deepwalk(v, env)]
    let tail = deepwalk(v.value, env)
    return Array.isArray(tail) ? tail : [splat(tail)]
  })
}

/// occurs(x, [x], {}) -> true
/// occurs(x, { x }, {}) -> true
/// occurs(x, [y], {}) -> false
/** Whether `v` occurs inside `x`: binding `v` to `x` would never end. */
export let occurs = (v: Var, x: Term, env: Env): boolean => {
  x = walk(x, env)
  if (x === v) return true
  if (Array.isArray(x)) return x.some((item) => occurs(v, item, env))
  if (x && typeof x == 'object') {
    return Object.values(x).some((item) => occurs(v, item, env))
  }
  return false
}

/// unify(x, 1, {}) -> { x: 1 }
/// unify([x, 2], [1, y], {}) -> { x: 1, y: 2 }
/// unify({ a: x }, { b: 1 }, {}) -> null
/// unify(1, 2, {}) -> null
/**
 * The env that makes `a` and `b` equal, or null. A variable binds unless it
 * occurs in what it would be bound to; lists unify item by item, a splat
 * taking whatever run of items fits, and objects key by key.
 */
export let unify = (a: Term, b: Term, env: Env): Env | null => {
  a = walk(a, env)
  b = walk(b, env)

  if (a === b) return env
  if (isVar(a)) return occurs(a, b, env) ? null : set(a, b)(env)
  if (isVar(b)) return occurs(b, a, env) ? null : set(b, a)(env)
  if (typeOf(a) != typeOf(b)) return null
  if (Array.isArray(a)) return unifyArrays(a, b, env)
  if (typeOf(a) == 'object') return unifyObjects(a, b, env)
  return null
}

// Each pair unified in turn: the first that fails fails them all.
let pairs = (ps: Term[][], env: Env | null): Env | null =>
  ps.reduce((e, [a, b]) => e && unify(a, b, e), env)

/** Two lists unified item by item; a splat on either side takes a run. */
export let unifyArrays = (a: Term[], b: Term[], env: Env): Env | null =>
  a.some(isSplat) || b.some(isSplat)
    ? splats(a, b, env)
    : a.length == b.length
    ? pairs(a.map((x, i) => [x, b[i]]), env)
    : null

let splats = (a: Term[], b: Term[], env: Env, i = 0, j = 0): Env | null => {
  if (i >= a.length && j >= b.length) return env
  if (isSplat(a[i])) {
    return stretch(
      a[i].value,
      i + 1,
      b,
      j,
      env,
      (i, j, env) => splats(a, b, env, i, j),
    )
  }
  if (isSplat(b[j])) {
    return stretch(
      b[j].value,
      j + 1,
      a,
      i,
      env,
      (j, i, env) => splats(a, b, env, i, j),
    )
  }
  if (i >= a.length || j >= b.length) return null
  let next = unify(a[i], b[j], env)
  return next && splats(a, b, next, i + 1, j + 1)
}

// A splat unified with each run of the other side's items from `from` on,
// shortest first, until the rest of the lists unify too.
let stretch = (
  value: Term,
  after: number,
  other: Term[],
  from: number,
  env: Env,
  rest: (after: number, to: number, env: Env) => Env | null,
): Env | null => {
  for (let to = from; to <= other.length; to++) {
    let next = unify(value, other.slice(from, to), env)
    let done = next && rest(after, to, next)
    if (done) return done
  }
  return null
}

/** Two objects unified key by key: each has the keys the other has. */
export let unifyObjects = (a: Env, b: Env, env: Env): Env | null => {
  let keys = Object.keys(a)
  return keys.length == Object.keys(b).length &&
      keys.every((k) => Object.hasOwn(b, k))
    ? pairs(keys.map((k) => [a[k], b[k]]), env)
    : null
}
