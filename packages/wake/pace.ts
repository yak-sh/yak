// A wake that repeats only while something holds. `wake.while` is an ordered
// list of `{match, every}`: a query over the whole graph, and the cadence it
// asks for while that query finds anything. The first that finds anything
// sets the cadence; when none does, the wake's own `every` does, and a wake
// without one sleeps — `at` cleared, nothing owed, no timer anywhere.
//
// Two moments decide it, and each is a function over a graph:
//
//   a firing   `tick` asks `pace` which cadence the next instant is counted
//              in, so a world somebody is in keeps coming back, and one
//              nobody is in fires its last and sleeps
//   a write    `rouse` arms a wake whose condition a write made hold, when
//              that brings it sooner than the instant it holds — a player
//              arriving is a write, so arriving is what wakes the world
//
// Neither reads a clock it was not given. The program holding the graph calls
// `rouse` once its writes commit, the way it calls `tick` when its own clock
// goes off.

import {
  type Bundle,
  type Hook,
  over,
  type Query,
  Stale,
  then,
  token,
  type Tx,
} from '@yaks/graph'
import { and, limit, parse } from '@yaks/query'
import { WAKE, type Wake } from './comp.ts'
import { wakeOf } from './due.ts'
import { after } from './every.ts'
import type { Driver } from './tick.ts'

let iso = (t: number): string => new Date(t).toISOString()

// A condition asks only whether anything matches, so it is read one row deep.
let probe = (match: string): Query => {
  let q = parse(match)
  return and(...q.clauses.filter((c) => c.kind != 'limit'), limit(1))
}

/**
 * The cadence a wake's conditions ask for at `now`: the `every` of the first
 * `while` entry whose query finds anything, or `null` when none does.
 *
 * ```ts
 * import { pace } from '@yaks/wake'
 *
 * // await pace(graph, { while: [{ match: '.player', every: '5m' }] }, now)
 * ```
 */
export let pace = async (
  graph: Pick<Driver, 'read'>,
  wake: Wake,
  now: number,
): Promise<string | null> => {
  for (let { match, every } of wake.while ?? []) {
    if ((await graph.read(probe(match), { now })).length) return every
  }
  return null
}

/** What a pass of {@link rouse} did: the wakes it armed, and the ones it
 * could not, each with why. */
export type Roused = {
  /** the applied wake bundles */
  roused: Bundle[]
  /** the wakes whose conditions could not be read or whose write was refused */
  refused: { wake: Bundle; error: unknown }[]
}

/**
 * Arm each wake whose conditions now hold at the first instant its cadence
 * owes, when that is sooner than the instant it holds: a sleeping wake is
 * woken, and one on a slow cadence is brought forward when a faster
 * condition starts to hold. A wake whose `at` moved while this ran keeps the
 * other writer's instant.
 *
 * ```ts
 * import { rouse } from '@yaks/wake'
 *
 * // after a write commits: await rouse(graph, Date.now())
 * ```
 */
export let rouse = async (
  graph: Driver,
  now: number = Date.now(),
): Promise<Roused> => {
  let result: Roused = { roused: [], refused: [] }
  for (let wake of await graph.read(`.${WAKE}.while`, { now })) {
    let w = wakeOf(wake) ?? {}
    try {
      let every = await pace(graph, w, now)
      let at = every == null ? null : after(every, now, now)
      if (at == null || (w.at && Date.parse(w.at) <= at)) continue
      let applied = await graph.apply([{
        entity: wake.entity,
        [WAKE]: { at: iso(at) },
        $was: { [WAKE]: { at: token(w.at) } },
      }], { now: iso(now) })
      result.roused.push(
        ...applied.filter((b) => b.entity.eid == wake.entity.eid),
      )
    } catch (error) {
      // Another writer moved `at` first; its instant stands.
      if (!(error instanceof Stale)) result.refused.push({ wake, error })
    }
  }
  return result
}

// One `while` entry, refused unless it is a query this graph can answer and a
// cadence `every` can read.
let entry = (tx: Tx, e: unknown, i: number): unknown => {
  let { match, every } = (e ?? {}) as { match?: unknown; every?: unknown }
  if (typeof match != 'string' || typeof every != 'string') {
    throw new TypeError(
      `wake.while[${i}] is {match, every}: a query and a cadence`,
    )
  }
  if (after(every, 0, 0) == null) {
    throw new TypeError(`wake.while[${i}].every: no cadence in "${every}"`)
  }
  return tx.read(probe(match))
}

/**
 * The `precondition` hook: each `while` a write gives is read once, so a
 * condition that does not parse, or names a word this graph does not speak,
 * is refused with the reader's own reason when it is written, not at every
 * firing after.
 */
export let conditions: Hook = (bundles, tx) =>
  then(
    over(
      bundles.flatMap((b) =>
        (wakeOf(b)?.while ?? []).map((e, i) => [e, i] as const)
      ),
      ([e, i]) => entry(tx, e, i),
    ),
    () => bundles,
  )
