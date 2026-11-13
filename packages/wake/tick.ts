// Firing a wake is a write on the wake's own entity. The graph's rules decide
// what follows it, so no registry of handlers is needed and a schedule names no
// code. Each wake is written in its own transaction: one rejection leaves that
// occurrence due without rolling back the others. The precondition makes two
// processes reading the same occurrence compete at the graph's transaction
// boundary instead of both firing it, and the one that loses reads the wake
// again rather than calling the other's write a failure.

import type { Bundle, Graph } from '@yaks/graph'
import { Stale } from '@yaks/graph/errors'
import { token } from '@yaks/graph/sha256'
import { WAKE } from './comp.ts'
import { due, next, owed, ring, wakeOf } from './due.ts'
import { cadence, matches } from './while.ts'
import { look, type Watching, watchOf } from './watch.ts'

/** The part of the graph API a driver needs, also satisfied by a client for a
 * remote graph over HTTP. */
export type Driver = Pick<Graph, 'read' | 'apply'>

// How many times a wake another writer keeps moving is read before it is
// left due and refused.
let TRIES = 3

/** A committed firing and a rejected attempt are separate outcomes. Effect
 * failures are reported through the graph's error reporter instead: their
 * writes have already committed. */
export type Ticked = {
  /** the applied wake bundles, including what the graph's rules produced */
  fired: Bundle[]
  /** the wakes left due, with the reason each transaction was rejected */
  refused: { wake: Bundle; error: unknown }[]
}

/** How `tick` reads what a wake watches (./watch.ts). */
export type TickOpts = {
  /** the rows a watched query answers for a wake; the graph's by default */
  watching?: Watching
}

/**
 * Fire the due wakes, one transaction per wake, each with a precondition on
 * what it read. A wake that watches a query (`watch`) is read again first and
 * fires only when its rows changed, with `watch.changes` saying how; a look
 * that finds nothing new moves `at` on without firing. `now` is in epoch milliseconds and becomes both `fired.at` and
 * the graph's `#Now` resource. Missed occurrences collapse into one firing, and
 * the recurrence advances past now — at the cadence of the first `while`
 * condition that holds at `now`, else its own `every`, else not at all.
 *
 * ```ts
 * import { tick } from '@yaks/wake'
 *
 * // let { fired, refused } = await tick(graph, Date.now())
 * ```
 */
export let tick = async (
  graph: Driver,
  now: number = Date.now(),
  opts: TickOpts = {},
): Promise<Ticked> => {
  let watching = opts.watching ??
    ((_: Bundle, w: { query: string }) => graph.read(w.query))
  let result: Ticked = { fired: [], refused: [] }
  let at = new Date(now).toISOString()
  let holds = matches(graph, now)
  let chosen: (
    | { wake: Bundle; every: string | null | undefined }
    | { wake: Bundle; error: unknown }
  )[] = []
  for (let wake of await due(graph, now)) {
    try {
      let w = wakeOf(wake) ?? {}
      let every = (await cadence(graph, w, now, holds)) ?? w.every
      chosen.push({ wake, every })
    } catch (error) {
      chosen.push({ wake, error })
    }
  }
  // A wake another writer moved since it was read is read again: still due,
  // it fires from what it holds now; no longer due, that writer's instant
  // stands. Only a wake that keeps moving under every read is refused.
  let fire = async (wake: Bundle, every: string | null | undefined) => {
    for (let tries = 1;; tries++) {
      try {
        return await once(wake, every)
      } catch (error) {
        if (!(error instanceof Stale) || tries == TRIES) throw error
      }
      let [fresh] = await graph.read(
        `.entity.eid=${wake.entity.eid}&${owed(now)}`,
        { now },
      )
      if (!fresh) return []
      wake = fresh
      every = (await cadence(graph, wakeOf(wake) ?? {}, now, holds)) ??
        wakeOf(wake)?.every
    }
  }
  let once = async (wake: Bundle, every: string | null | undefined) => {
    let w = wakeOf(wake) ?? {}
    let watch = watchOf(wake)
    let looked = watch &&
      await look(watch.seen ?? {}, await watching(wake, watch))
    let firing = looked && !looked.changes
      ? { entity: wake.entity, [WAKE]: { at: next({ ...w, every }, now) } }
      : { ...ring(wake, now, {}, every), ...looked ? { watch: looked } : {} }
    let applied = await graph.apply([{
      ...firing,
      $was: {
        wake: {
          at: token(w.at),
          every: token(w.every),
          while: token(w.while),
        },
      },
    }], { now: at })
    if (looked && !looked.changes) return []
    return applied.filter((b) => b.entity.eid == wake.entity.eid)
  }
  for (let choice of chosen) {
    let { wake } = choice
    if ('error' in choice) {
      result.refused.push({ wake, error: choice.error })
      continue
    }
    try {
      result.fired.push(...await fire(wake, choice.every))
    } catch (error) {
      result.refused.push({ wake, error })
    }
  }
  return result
}
