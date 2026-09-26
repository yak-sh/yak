// Firing a wake is a write on the wake's own entity. The graph's rules decide
// what follows it, so no registry of handlers is needed and a schedule names no
// code. Each wake is written in its own transaction: one rejection leaves that
// occurrence due without rolling back the others. The precondition makes two
// processes reading the same occurrence compete at the graph's transaction
// boundary instead of both firing it.

import { type Bundle, type Graph, token } from '@yaks/graph'
import { due, ring, wakeOf } from './due.ts'
import { pace } from './pace.ts'

/** The part of the graph API a driver needs, also satisfied by a client for a
 * remote graph over HTTP. */
export type Driver = Pick<Graph, 'read' | 'apply'>

/** A committed firing and a rejected attempt are separate outcomes. Effect
 * failures are reported through the graph's error reporter instead: their
 * writes have already committed. */
export type Ticked = {
  /** the applied wake bundles, including what the graph's rules produced */
  fired: Bundle[]
  /** the wakes left due, with the reason each transaction was rejected */
  refused: { wake: Bundle; error: unknown }[]
}

/**
 * Fire the due wakes, one transaction per wake, each with a precondition on
 * what it read. `now` is in epoch milliseconds and becomes both `fired.at` and
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
): Promise<Ticked> => {
  let result: Ticked = { fired: [], refused: [] }
  let at = new Date(now).toISOString()
  for (let wake of await due(graph, now)) {
    let w = wakeOf(wake) ?? {}
    try {
      let every = (await pace(graph, w, now)) ?? w.every
      let applied = await graph.apply([{
        ...ring(wake, now, {}, every),
        $was: {
          wake: {
            at: token(w.at),
            every: token(w.every),
            while: token(w.while),
          },
        },
      }], { now: at })
      result.fired.push(
        ...applied.filter((b) => b.entity.eid == wake.entity.eid),
      )
    } catch (error) {
      result.refused.push({ wake, error })
    }
  }
  return result
}
