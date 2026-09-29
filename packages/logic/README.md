# @yaks/logic

A relational runtime in the miniKanren manner. A goal answers every env in which
it holds, a relation answers from whichever of its arguments are bound, what
cannot answer yet waits as a constraint, and what needs the world is recorded as
an effect and performed by a separate pass. Every word is a small function over
plain values, its examples are the `///` lines above it, and those lines run as
its tests.

```ts
import { add, and, eq, lt, lvars, member, run } from '@yaks/logic'

let { x, y } = lvars
run(x, add(x, 5, 7)) // [2]
run(x, and(lt(x, 3), member(x, [1, 2, 3]))) // [1, 2]
run([x, y], eq([x, 2], [1, y])) // [{ x: 1, y: 2 }]
```

## Terms (`term.ts`)

A term is any value: a variable, a scalar, or a list or object holding terms.
`lvar('x')` is the variable `x` wherever it is written, `lvar()` a fresh one,
`lvars.x` reads as `lvar('x')`, and `_` matches anything and binds nothing. An
env maps a variable's name to its value, and binding one answers a copy (`set`).
`unify(a, b, env)` answers the env that makes two terms equal, or null: lists
unify item by item, objects key by key, and `splat(xs)` inside a list stands for
a run of its items (`[x, splat(rest)]`). `deepwalk` reads a term back out with
its variables replaced.

## Goals (`goal.ts`)

A goal is `(env) => Iterable<Env>`. `ok` holds once, `fail` never, `eq(a, b)`
where they unify, `and` where every goal holds, `or` where any does, and
`oneOf(out, ...values)`. `lets(fn)` gives a goal as many fresh variables as `fn`
takes, which is how a relation recurs without building its whole search first.

`run(vars, goal)` answers every answer for `vars`: a variable's value, or an
object of each variable's value. `find` answers the first and searches no
further; `solutions` is the lazy stream both are made of.

A relation that cannot answer yet, `lt(x, 1)` before `x` is bound, defers itself
into the env as a constraint, tried again after each `eq`. The order goals are
written in never decides whether they hold, and an answer still holding a
constraint is not an answer. `walked(fn)` builds such a relation: `fn` gets its
arguments walked and the list of those still unbound.

## Relations (`relations.ts`)

- Arithmetic, solving for any one unknown: `add`, `sub`, `mul`, `div`, `pow`
  (real roots, both signs for an even power), `sq`.
- Order: `lt`, `lte`, `gt`, `gte`.
- Objects: `prop(obj, key, value)`, `merge(a, b, out)` for
  `{ ...a, ...b } = out` in any direction, `assign`, `json`.
- Lists: `cons`, `first`, `rest`, `empty`, `member`, `length`, `append`, `take`.
- Types: `type(t, x)` over @yaks/fp's `typeOf`, `number`, `string`, `boolean`,
  `array`, `object`, `isNull`, and `is(x, klass)`.
- Facts: `facts(...rows)` holds for each row. `relation(name)` keeps its facts
  in the env: a call said (`say`, the default) adds one, a call asked (`ask`)
  holds for each said before.

## Effects

A goal that needs the world records the function and its arguments in the env
(`effect`) instead of calling it. `run` leaves such an answer out. `race` is the
pass that performs the effects, each resolving to a goal that goes on from
there, and it answers asynchronously as the results arrive, a fast answer before
a slow one. `request(req, res)` fetches, `response.ok(res)` holds for a response
that succeeded, and `delay(ms, goal)` waits.

## Compatibility

Pure functions over plain values; @yaks/fp is its one dependency. `request` uses
`fetch` and `delay` uses `setTimeout`, only when `race` performs them: any
JavaScript runtime with the web platform's timers and fetch.
