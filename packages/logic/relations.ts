// The relations: arithmetic, comparison, objects, lists, types, facts, and the
// two that reach the world. Each answers from whichever of its arguments are
// bound, so `add(x, 5, 7)` finds `x` as readily as `add(2, 5, x)` finds the
// sum, and one that cannot answer yet defers itself as a constraint until its
// variables are bound. Lists are built on `cons` the way miniKanren's are;
// `member` and `append` recur through fresh variables (`lets`), so a search
// grows only as far as it is read.
import { typeOf } from '@yaks/fp'
import {
  and,
  constraint,
  effect,
  eq,
  expect,
  fail,
  type Goal,
  lets,
  mode,
  or,
  type Rel,
  walked,
  yields,
} from './goal.ts'
import {
  _,
  get,
  isVar,
  lvar,
  splat,
  type Term,
  update,
  type Var,
} from './term.ts'

/// let { x, y, _, and, eq, run, race, ask, Var } = await import('./mod.ts')

/// run(x, add(x, 5, 7)) -> [2]
/// run(x, add(2, x, 7)) -> [5]
/// run(x, add(2, 5, x)) -> [7]
/// run(x, and(add(x, y, 3), eq(y, 1))) -> [2]
/** `a + b = c`. */
export let add: Rel = walked((a, b, c) => (unbound) => {
  if (unbound.length > 1) return constraint(add, a, b, c)
  switch (unbound[0]) {
    case a:
      return eq(a, c - b)
    case b:
      return eq(b, c - a)
    default:
      return eq(c, a + b)
  }
})

/// run(x, and(mul(2, 4, y), add(1, x, y))) -> [7]
/// run(x, mul(x, 4, 8)) -> [2]
/// run(x, mul(2, x, 8)) -> [4]
/// run(x, mul(2, 4, x)) -> [8]
/** `a * b = c`. */
export let mul: Rel = walked((a, b, c) => (unbound) => {
  if (unbound.length > 1) return constraint(mul, a, b, c)
  switch (unbound[0]) {
    case a:
      return eq(a, c / b)
    case b:
      return eq(b, c / a)
    default:
      return eq(c, a * b)
  }
})

/// run(x, pow(x, 2, 4)) -> [2, -2]
/// run(x, pow(x, 3, 8)) -> [2]
/// run(x, pow(x, 3, -8)) -> [-2]
/// run(x, pow(x, 4, 16)) -> [2, -2]
/// run(x, pow(x, 2, -4)) -> []
/// run(x, pow(2, 3, x)) -> [8]
/// run(x, and(pow(x, y, 8), eq(y, 3))) -> [2]
/** `a ** n = b`, for a whole `n` of at least one; roots are real. */
export let pow: Rel = walked((a, n, b) => (unbound) => {
  if (unbound.length > 1 || unbound[0] === n) return constraint(pow, a, n, b)
  if (!Number.isInteger(n) || n < 1) return fail
  if (unbound[0] !== a) return eq(a ** n, b)
  if (b < 0 && n % 2 == 0) return fail
  let root = b < 0 ? -((-b) ** (1 / n)) : b ** (1 / n)
  return n % 2 || root == 0 ? eq(a, root) : or(eq(a, root), eq(a, -root))
})

/// run(x, sq(x, 4)) -> [2, -2]
/** `a² = b`. */
export let sq = (a: Term, b: Term): Goal => pow(a, 2, b)

/// run(x, sub(x, 5, 2)) -> [7]
/** `a - b = c`. */
export let sub = (a: Term, b: Term, c: Term): Goal => add(b, c, a)

/// run(x, div(x, 4, 2)) -> [8]
/** `a / b = c`. */
export let div = (a: Term, b: Term, c: Term): Goal => mul(b, c, a)

/// run(_, lt(1, 2)) -> [_]
/// run(_, lt(2, 2)) -> []
/// run(_, lt(x, 2)) -> []
/// run(x, and(lt(x, 2), eq(x, 1))) -> [1]
/** `a < b`, once both are bound. */
export let lt: Rel = walked((a, b) => (unbound) =>
  unbound.length ? constraint(lt, a, b) : expect(a < b)
)

/// run(_, lte(2, 2)) -> [_]
/** `a <= b`, once both are bound. */
export let lte: Rel = walked((a, b) => (unbound) =>
  unbound.length ? constraint(lte, a, b) : expect(a <= b)
)

/// run(_, gt(2, 1)) -> [_]
/** `a > b`, once both are bound. */
export let gt = (a: Term, b: Term): Goal => lt(b, a)

/// run(_, gte(1, 2)) -> []
/** `a >= b`, once both are bound. */
export let gte = (a: Term, b: Term): Goal => lte(b, a)

/// run(x, prop({ a: 1 }, 'a', x)) -> [1]
/// run(x, prop(x, 'a', 1)) -> [{ a: 1 }]
/// run(x, prop({ a: 1, b: 1 }, x, 1)) -> ['a', 'b']
/** `obj[key] = value`. */
export let prop: Rel = walked((obj, key, value) => (unbound) => {
  if (unbound.length > 1) return constraint(prop, obj, key, value)
  switch (unbound[0]) {
    case obj:
      return eq(obj, { [key]: value })
    case key:
      return or(
        ...Object.keys(obj).map((k) => and(eq(obj[k], value), eq(key, k))),
      )
    default:
      return eq(obj[key], value)
  }
})

let objectLike = (x: Term) => isVar(x) || typeOf(x) == 'object'

/// run(x, merge({ a: 1 }, { b: 2 }, x)) -> [{ a: 1, b: 2 }]
/// run(x, merge({ a: 1 }, x, { a: 1, b: 2 })) -> [{ b: 2 }, { a: 1, b: 2 }]
/// run(x, merge(x, { b: 2 }, { a: 1, b: 2 })) -> [{ a: 1 }]
/// run(x, merge({ a: 1 }, x, { a: 2 })) -> [{ a: 2 }]
/// run([x, y], merge({ a: y }, x, { a: 1, b: 2 })) -> [{ x: { b: 2 }, y: 1 }, { x: { a: 1, b: 2 }, y }]
/// run(x, merge(1, x, {})) -> []
/**
 * `{ ...a, ...b } = out`. Given `out` and `a`, a key `a` shares with `out` may
 * have come from either side, so `b` answers each way.
 */
export let merge: Rel = walked((a, b, out) => (unbound) => {
  if (unbound.length > 1) return constraint(merge, a, b, out)
  if (![a, b, out].every(objectLike)) return fail
  if (isVar(a)) {
    let rest = Object.fromEntries(
      Object.entries(out).filter(([k]) => !(k in b)),
    )
    return and(...Object.keys(b).map((k) => eq(out[k], b[k])), eq(a, rest))
  }
  if (isVar(b)) return split(a, b, out)
  return eq(out, { ...a, ...b })
})

// `b` of `{ ...a, ...b } = out`: every key of `out` that `a` lacks, and each
// key they share either taken from `a`, where it agrees, or given to `b`.
let split = (a: Term, b: Var, out: Term): Goal => {
  let own = Object.keys(out).filter((k) => !(k in a))
  let shared = Object.keys(out).filter((k) => k in a)
  let choose = (i: number, kept: Term): Goal => {
    let k = shared[i]
    if (k == null) {
      let given = {
        ...kept,
        ...Object.fromEntries(own.map((k) => [k, out[k]])),
      }
      return and(eq(b, given), eq({ ...a, ...given }, out))
    }
    return or(
      and(eq(a[k], out[k]), choose(i + 1, kept)),
      choose(i + 1, { ...kept, [k]: out[k] }),
    )
  }
  return choose(0, {})
}

/// run(x, assign(x, { a: 1 }, { b: 2 })) -> [{ a: 1, b: 2 }]
/// run(x, assign(x)) -> [{}]
/** `Object.assign({}, ...objs) = out`. */
export let assign = (out: Term, ...objs: Term[]): Goal =>
  !objs.length ? eq(out, {}) : objs.length == 1 ? eq(out, objs[0]) : lets(
    (tail) => and(assign(tail, ...objs.slice(1)), merge(objs[0], tail, out)),
  )

/// run(x, json({ a: 1 }, x)) -> ['{"a":1}']
/// run(x, json(x, '{"a":1}')) -> [{ a: 1 }]
/** `JSON.stringify(obj) = str`. */
export let json: Rel = walked((obj, str) => (unbound) =>
  unbound.length > 1
    ? constraint(json, obj, str)
    : unbound[0] === obj
    ? eq(obj, JSON.parse(str))
    : eq(JSON.stringify(obj), str)
)

/// run(x, cons(1, [2, 3], x)) -> [[1, 2, 3]]
/// run(x, cons(x, [2, 3], [1, 2, 3])) -> [1]
/// run(x, cons(1, x, [1, 2, 3])) -> [[2, 3]]
/// run(x, cons(x, _, [])) -> []
/// run(_, cons(1, [], [1])) -> [_]
/** `[first, ...rest] = out`. */
export let cons = (first: Term, rest: Term, out: Term): Goal =>
  isVar(rest) ? eq([first, splat(rest)], out) : eq(out, [first, ...rest])

/// run(x, first(x, [1, 2, 3])) -> [1]
/// run(x, first(x, [])) -> []
/** `out[0] = head`. */
export let first = (head: Term, out: Term): Goal => cons(head, _, out)

/// run(x, rest(x, [1, 2, 3])) -> [[2, 3]]
/// run(x, rest(x, [])) -> []
/** `out.slice(1) = tail`, for a list with a first item. */
export let rest = (tail: Term, out: Term): Goal => cons(_, tail, out)

/// run(x, empty(x)) -> [[]]
/** `x = []`. */
export let empty = (x: Term): Goal => eq(x, [])

/// run(x, member(x, [1, 2])) -> [1, 2]
/// run(x, member(1, [x, 2, 3])) -> [1]
/// run(_, member(1, [1, 2])) -> [_]
/// run(_, member(3, [1, 2])) -> []
/// run(x, member([1, x], [[1, 2], [1, 3]])) -> [2, 3]
/** `x` is an item of `list`. */
export let member = (x: Term, list: Term): Goal =>
  or(
    first(x, list),
    lets((tail) => and(rest(tail, list), member(x, tail))),
  )

/// run(x, length([1, 2, 3], x)) -> [3]
/// run(x, length(x, 3)) ~> [[Var, Var, Var]]
/** `list.length = n`; given `n`, a list of fresh variables. */
export let length: Rel = walked((list, n) => (unbound) =>
  unbound.length > 1
    ? constraint(length, list, n)
    : unbound[0] === list
    ? eq(list, Array.from({ length: n }, () => lvar()))
    : eq(list.length, n)
)

/// run(x, append([], [1, 2], x)) -> [[1, 2]]
/// run(x, append([1], [], x)) -> [[1]]
/// run(x, append([1, 2], x, [1, 2, 3, 4])) -> [[3, 4]]
// / run(x, append(x, [3, 4], [1, 2, 3, 4])) -> [[1, 2]]
/** `[...a, ...b] = out`. */
export let append = (a: Term, b: Term, out: Term): Goal =>
  or(
    and(empty(a), eq(b, out)),
    lets((head, tail, rec) =>
      and(cons(head, tail, a), cons(head, rec, out), append(tail, b, rec))
    ),
  )

/// run(x, take(2, [1, 2, 3], x)) -> [[1, 2]]
/** `list.slice(0, n) = out`. */
export let take = (n: Term, list: Term, out: Term): Goal =>
  and(length(out, n), append(out, _, list))

/// run(x, type(x, 1)) -> ['number']
/** `typeOf(x) = t` (@yaks/fp's `typeOf`), once `x` is bound. */
export let type: Rel = walked((t, x) => () =>
  isVar(x) ? constraint(type, t, x) : eq(typeOf(x), t)
)

/// run(x, number(x)) -> []
/// run(x, and(number(x), eq(x, 1))) -> [1]
/// run(_, string(1)) -> []
export let number = (x: Term): Goal => type('number', x)
export let string = (x: Term): Goal => type('string', x)
export let boolean = (x: Term): Goal => type('boolean', x)
export let array = (x: Term): Goal => type('array', x)
export let object = (x: Term): Goal => type('object', x)
export let isNull = (x: Term): Goal => type('null', x)

// `instanceof`, with a primitive an instance of its wrapper's class.
let instance = (x: Term, klass: Term) =>
  typeof klass == 'function' &&
  (x instanceof klass || typeof x == klass.name.toLowerCase())

/// run(_, is(1, Number)) -> [_]
/// run(_, is(1, String)) -> []
/// run(x, is(1, x)) -> [Number]
/// run(x, is(x, Number)) -> []
/// run(x, and(is(x, Number), eq(x, 1))) -> [1]
/** `x` is an instance of `klass`: given `x`, its class. */
export let is: Rel = walked((x, klass) => () =>
  isVar(x)
    ? constraint(is, x, klass)
    : isVar(klass)
    ? eq(klass, x?.constructor ?? null)
    : expect(instance(x, klass))
)

/// let edge = facts(['a', 'b'], ['b', 'c'])
/// run(x, edge('a', x)) -> ['b']
/// run([x, y], edge(x, y)) -> [{ x: 'a', y: 'b' }, { x: 'b', y: 'c' }]
/** A relation holding for each of `rows`, and nothing else. */
export let facts = (...rows: Term[][]): Rel => (...args) =>
  or(...rows.map((row) => eq(row, args)))

/// let parent = relation('parent')
/// run(parent, parent('a', 'b')) -> [[['a', 'b']]]
/// run(_, ask(parent('a', 'b'))) -> []
/// run(x, and(parent('a', 'b'), ask(parent('a', x)))) -> ['b']
/**
 * A relation whose facts live in the env under its name: said, a call adds
 * its arguments as a fact; asked, it holds for each fact said before.
 */
export let relation = (name: string): Rel & { isVar: boolean } => {
  let fact: Rel = (...args) => (env) =>
    get(mode)(env) == 'ask'
      ? member(args, get(name, [])(env))(env)
      : yields(update(name, (said: Term[] = []) => [...said, args]))(env)
  return Object.assign(fact, { isVar: true, toString: () => name })
}

let fetched = async (req: Term, res: Term): Promise<Goal> =>
  eq(await fetch(req), res)

/// let okData = 'data:text/plain,ok'
/// await Array.fromAsync(race(x, request(okData, x))).then(([res]) => res.text()) -> 'ok'
/// await Array.fromAsync(race(x, request(x, _))) -> []
/** `fetch(req)` answers `res`: an effect, performed by `race`. */
export let request: Rel = walked((req, res) => (unbound) =>
  unbound[0] === req ? constraint(request, req, res) : effect(fetched, req, res)
)

/** Relations about a response. */
export let response: { ok: Rel } = {
  /// await Array.fromAsync(race(x, and(request(okData, x), response.ok(x)))) ~> [{ ok: true }]
  /** The response succeeded. */
  ok: walked((res) => (unbound) =>
    unbound.length ? constraint(response.ok, res) : expect(res.ok)
  ),
}

let slept = (ms: number, goal: Goal): Promise<Goal> =>
  new Promise((done) => setTimeout(() => done(goal), ms))

/// await Array.fromAsync(race(x, delay(10, eq(x, 1)))) -> [1]
/// run(x, delay(0, eq(x, 1))) -> []
/** `goal`, after `ms` milliseconds: an effect, performed by `race`. */
export let delay: Rel = walked((ms, goal) => () =>
  isVar(ms) ? constraint(delay, ms, goal) : effect(slept, ms, goal)
)
