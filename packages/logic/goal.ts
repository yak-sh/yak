// Goals, and running them. A goal takes an env and answers every env in which
// it holds: none when it fails, several when it has several answers, lazily
// wherever it searches. `and` threads each answer of one goal through the
// next, `or` answers each goal's answers in turn, and `eq` unifies.
//
// A goal that cannot answer yet defers itself as a constraint: `lt(x, 1)` with
// `x` unbound is kept in the env and tried again after each `eq`, so the order
// goals are written in does not decide whether they hold. An answer that still
// holds a constraint is not an answer, and `run` leaves it out.
//
// Effects are data too. A goal that needs the world (a fetch, a timer) records
// the function and its arguments in the env and answers at once; `run` leaves
// such an answer out, and `race` is the separate pass that performs the
// effects, each resolving to a goal that goes on from there, and answers as the
// results arrive.
import { compose } from '@yaks/fp'
import {
  deepwalk,
  get,
  isVar,
  lvar,
  nvars,
  set,
  type Slot,
  type Term,
  unify,
  update,
  type Var,
  walkAll,
} from './term.ts'

/// let { x, y, z, _, splat, set, lt, add, delay } = await import('./mod.ts')

/**
 * What each variable's name is bound to, and what is kept beside the
 * bindings: the constraints and effects waiting, the facts said. `Env` is the
 * one to start from.
 */
export type Env = Record<string, Term>

/** Every env in which something holds. */
export type Goal = (env: Env) => Iterable<Env>

/** A relation: its arguments, as a goal. */
export type Rel = (...args: Term[]) => Goal

/**
 * A function and its arguments, called later: a constraint's relation, or an
 * effect's function, which answers the goal to go on with.
 */
export type Deferred<G = Goal> = [(...args: Term[]) => G, ...Term[]]

/// [...ok({})] -> [{}]
/** Holds, once. */
export let ok: Goal = (env) => [env]

/// [...fail({})] -> []
/** Never holds. */
export let fail: Goal = () => []

/** `ok` when `cond` holds, `fail` when not. */
export let expect = (cond: unknown): Goal => cond ? ok : fail

/// [...yields(set(x, 1))({})] -> [{ x: 1 }]
/** A goal of an env's change: it holds once, in the changed env. */
export let yields = (fn: (env: Env) => Env | null): Goal => (env) => {
  let next = fn(env)
  return next ? [next] : []
}

let push = (...added: Term[]) => (xs: Term[] = []) => [...xs, ...added]

/** Where an env keeps what it defers until its variables are bound. */
export let constraints: Var = lvar('~.constraints')

/** Where an env keeps the effects a separate pass performs. */
export let effects: Var = lvar('~.effects')

/** Whether a relation's call says a fact or asks for one. */
export let mode: Var = lvar('~.mode')

/** The env to start from: saying facts, with nothing deferred. */
export let Env: Env = compose(
  set(mode, 'say'),
  set(constraints, []),
  set(effects, []),
)({})

/** A goal that defers `fn(...args)` until its variables are bound. */
export let constraint = (...con: Deferred): Goal =>
  yields(update(constraints, push(con)))

/** A goal that records `fn(...args)` for `race` to perform. */
export let effect = (...eff: Deferred<Goal | Promise<Goal>>): Goal =>
  yields(update(effects, push(eff)))

export let wipeConstraints: (env: Env) => Env = update(constraints, () => [])
export let wipeEffects: (env: Env) => Env = update(effects, () => [])
export let hasConstraints = (env: Env): boolean =>
  get(constraints, [])(env).length > 0
export let hasEffects = (env: Env): boolean => get(effects, [])(env).length > 0

/// let _x
/// [...lets((x) => (env) => [_x = x])({})] -> [_x]
/** A goal of as many fresh variables as `fn` takes. */
export let lets = (fn: (...vars: Var[]) => Goal): Goal => (env) =>
  fn(...nvars(fn.length))(env)

/// let one = walked((x) => (unbound) => unbound.length ? fail : ok)
/// run(_, one(1)) -> [_]
/// run(_, one(x)) -> []
/// one() throws 'Expected 1 arguments'
/**
 * A relation of `fn`, given its arguments walked and which of them are still
 * unbound, so it can answer from whichever it knows.
 */
export let walked =
  (fn: (...xs: Term[]) => (unbound: Var[]) => Goal): Rel => (...vars) => {
    if (vars.length != fn.length) {
      throw new Error(
        `Expected ${fn.length} arguments, received ${vars.length}`,
      )
    }
    return (env) => {
      let xs = walkAll(env, vars)
      return fn(...xs)(xs.filter(isVar))(env)
    }
  }

/// run(x, and(fail, ok)) -> []
/// run(x, and(ok, fail)) -> []
/// run(x, and(eq(y, 1), eq(x, y))) -> [1]
/** Holds where every goal holds, each answer of one going on to the next. */
export let and = (...goals: Goal[]): Goal =>
  function* conj(env: Env, [goal, ...rest] = goals): Generator<Env> {
    if (!goal) yield env
    else for (let e of goal(env)) yield* conj(e, rest)
  }

/// run(x, or(fail, eq(x, 1))) -> [1]
/// run(x, or(eq(x, 1), eq(x, 2))) -> [1, 2]
/** Holds where any goal holds: each one's answers in turn. */
export let or = (...goals: Goal[]): Goal =>
  function* (env: Env) {
    for (let goal of goals) yield* goal(env)
  }

/// let waiting = [...lt(x, 1)(Env)][0]
/// [...resolveConstraints(waiting)] ~> [{ [constraints]: [[lt, x, 1]] }]
/// [...resolveConstraints(set(x, 0)(waiting))] ~> [{ [constraints]: [], x: 0 }]
/// run(x, and(lt(x, 1), eq(x, 0))) -> [0]
/** Every deferred goal tried again: each defers itself anew while unbound. */
export let resolveConstraints = (env: Env): Iterable<Env> =>
  and(
    ...get(constraints, [])(env).map(([fn, ...args]: Deferred) => fn(...args)),
  )(wipeConstraints(env))

/// run(x, eq({ x }, { x: 1 })) -> [1]
/// run([x, y], eq([x, y, _], [1, 2, 3])) -> [{ x: 1, y: 2 }]
/// run(z, eq([[x, y], [y, x]], [[1, 2], z])) -> [[2, 1]]
/// run(x, eq(x, y)) -> [y]
/// run(x, eq(x, x)) -> [x]
/// run(_, eq(1, 1)) -> [_]
/// run(x, eq(x, [x])) -> []
/// run(x, eq({ x, y: _ }, { x: 1, y: 2 })) -> [1]
/// run([x, y], eq([splat(x), 3, splat(y)], [1, 2, 3, 4])) -> [{ x: [1, 2], y: [4] }]
/** Holds where `a` and `b` unify, once the constraints that wakes hold. */
export let eq = (a: Term, b: Term): Goal =>
  function* (env: Env) {
    let next = unify(a, b, env)
    if (next) yield* resolveConstraints(next)
  }

/// run(x, oneOf(x, 1, 2)) -> [1, 2]
/// run(x, and(add(1, 2, y), oneOf(x, 1, y))) -> [1, 3]
/** Holds where `out` is one of `values`. */
export let oneOf = (out: Term, ...values: Term[]): Goal =>
  or(...values.map((v) => eq(v, out)))

/** A goal whose relations say their facts. */
export let say = (goal: Goal): Goal => compose(goal, set(mode, 'say'))

/** A goal whose relations ask for facts already said. */
export let ask = (goal: Goal): Goal => compose(goal, set(mode, 'ask'))

/// reify(x)({ x: 1 }) -> 1
/// reify([x, y])({ x: 1 }) -> { x: 1, y }
/// reify(1) throws 'is not a variable'
/**
 * What an answer says of `vars`: one variable's value, or an object of each
 * variable's value by its name; no variables, the whole env.
 */
export let reify = (vars: Slot | Slot[]): (env: Env) => Term => {
  for (let v of [vars].flat()) {
    if (!isVar(v)) throw new Error(`${v} is not a variable`)
  }
  return !Array.isArray(vars)
    ? (env) => deepwalk(vars, env)
    : !vars.length
    ? (env) => env
    : (env) =>
      Object.fromEntries(vars.map((v) => [String(v), deepwalk(v, env)]))
}

/** Each answer of `goal` for `vars`, lazily, leaving out any still waiting. */
export function* solutions(
  vars: Slot | Slot[],
  goal: Goal,
  env: Env = Env,
): Generator<Term> {
  let result = reify(vars)
  for (let e of goal(env)) {
    if (!hasConstraints(e) && !hasEffects(e)) yield result(e)
  }
}

/// run(x, eq(x, 1)) -> [1]
/// run([x], eq(x, 1)) -> [{ x: 1 }]
/// run(_, ok) -> [_]
/// run([], ok) ~> [Object]
/// run(x, lt(x, 2)) -> []
/** Every answer of `goal` for `vars`. */
export let run = (vars: Slot | Slot[], goal: Goal, env: Env = Env): Term[] => [
  ...solutions(vars, goal, env),
]

/// find(x, or(eq(x, 1), eq(x, 2))) -> 1
/// find(x, fail) -> undefined
/** The first answer of `goal` for `vars`, and no more of its search. */
export let find = (vars: Slot | Slot[], goal: Goal, env: Env = Env): Term =>
  solutions(vars, goal, env).next().value

// The values of every stream, each as it arrives: they all run at once, so a
// slow one never holds up a fast one.
async function* merge<T>(streams: Iterable<AsyncIterable<T>>) {
  type Step = [AsyncIterator<T>, IteratorResult<T>]
  let pending = new Map<AsyncIterator<T>, Promise<Step>>()
  let pull = (it: AsyncIterator<T>) =>
    pending.set(it, it.next().then((r): Step => [it, r]))
  for (let s of streams) pull(s[Symbol.asyncIterator]())
  while (pending.size) {
    let [it, r] = await Promise.race(pending.values())
    if (r.done) pending.delete(it)
    else {
      pull(it)
      yield r.value
    }
  }
}

function* each<A, B>(fn: (a: A) => B, xs: Iterable<A>) {
  for (let x of xs) yield fn(x)
}

// An answer once its effects are performed: each resolves to a goal, and the
// answers of those, performed in turn, are this answer's.
async function* settle(env: Env): AsyncGenerator<Env> {
  if (hasEffects(env)) {
    let goals = await Promise.all(
      get(effects)(env).map((
        [fn, ...args]: Deferred<Goal | Promise<Goal>>,
      ) => fn(...args)),
    )
    yield* merge(each(settle, and(...goals)(wipeEffects(env))))
  } else if (!hasConstraints(env)) yield env
}

/// await Array.fromAsync(race(x, delay(0, eq(x, 1)))) -> [1]
/// await Array.fromAsync(race(x, or(delay(20, eq(x, 1)), delay(0, eq(x, 2))))) -> [2, 1]
/// await Array.fromAsync(race(x, and(lt(x, 2), delay(0, eq(x, 1))))) -> [1]
/// await Array.fromAsync(race(x, and(lt(x, 1), delay(0, eq(x, 1))))) -> []
/// await Array.fromAsync(race([x, y], and(delay(20, eq(x, 1)), delay(0, eq(y, 2))))) -> [{ x: 1, y: 2 }]
/**
 * Every answer of `goal` for `vars` with its effects performed, as each
 * arrives: the pass that does what the goals only recorded.
 */
export async function* race(
  vars: Slot | Slot[],
  goal: Goal,
  env: Env = Env,
): AsyncGenerator<Term> {
  let result = reify(vars)
  for await (let e of merge(each(settle, goal(env)))) yield result(e)
}
