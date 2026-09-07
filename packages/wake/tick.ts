// Firing is a write on the wake itself. The graph's rules decide what follows
// it, so a host needs no registry of handlers and a schedule names no code.
// Each wake gets its own batch: a refusal leaves that occurrence due without
// rolling back the others. The guard makes two readers of one occurrence
// compete at the graph's transaction boundary instead of both firing it.

import { type Bundle, type Graph, token } from '@yaks/graph'
import { due, ring, wakeOf } from './due.ts'

/** The graph surface a driver needs, also satisfied by a remote graph door. */
export type Driver = Pick<Graph, 'read' | 'apply'>

/** A committed firing and a refused attempt are separate outcomes. Effect
 * failures belong to the graph's reporter: their writes already committed. */
export type Ticked = {
  /** the applied wake bundles, including what the graph's rules produced */
  fired: Bundle[]
  /** the wakes left due, with the reason each batch was refused */
  refused: { wake: Bundle; error: unknown }[]
}

/**
 * Consume the due wakes, one guarded batch per wake. `now` is epoch
 * milliseconds and becomes both `fired.at` and the graph's `#Now` resource.
 * Missed occurrences coalesce into one firing; recurrence advances past now.
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
    try {
      let applied = await graph.apply([{
        ...ring(wake, now),
        $was: {
          wake: {
            at: token(wakeOf(wake)?.at),
            every: token(wakeOf(wake)?.every),
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
