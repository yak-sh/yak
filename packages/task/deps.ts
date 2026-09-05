// The two questions a task list asks about a task that is not finished: is
// anything in the way, and how much of it is left.
//
// They are deliberately different questions with different answers, because
// conflating them is what makes a board shout.
//
// GATED is the alarm. `blocked{on}` says something OUTSIDE the graph has stopped
// this — a vendor, a decision, a person who has not replied. Nobody here can
// move it, so it is worth a mark on the row.
//
// OPEN DEPS is not an alarm. A task with three unfinished `requires` children is
// a task with three unfinished children: ordinary work, in progress, exactly as
// it should be. It is a COUNT — "3 left" — and zero renders nothing at all.
// Showing it in red would mean flagging every plan the moment somebody made one.
//
// A child that is not a task cannot settle, so it counts as open: a task waiting
// on a document is waiting until somebody removes the link.
//
// Sync in, sync out: over a storage that answers immediately (a Map, an embedded
// database) so does this, while an asynchronous one turns it into a promise.
// Nothing in between has to know which.

import type { Bundle, Eid, Storage, Tx } from '@yaks/graph'
import { detached, each, then } from '@yaks/graph'
import { and, eq, present } from '@yaks/query'
import { EDGE } from '@yaks/edge'
import { type Mark, MARKS, settled } from './words.ts'
import { statusOf } from './status.ts'
import { BLOCKED, CONTAINS, REQUIRES } from './comp.ts'

/**
 * Is something outside the graph in the way? Reads the `blocked` facet, which is
 * never a status — a blocked task is still open work, and still shows up in
 * every query for open work.
 *
 * ```ts
 * import { gated } from '@yaks/task'
 *
 * gated({ entity: { eid: 't1' }, task: {}, blocked: { on: 'legal' } }) // true
 * ```
 */
export let gated = (b: Bundle): boolean => {
  let c = b[BLOCKED]
  return c != null && typeof c == 'object'
}

/** Which links count as work this task is waiting on, and which ladder reads a
 * child's status. */
export type DepOpts = {
  /** the relation tags to follow. Default: `requires` and `contains`. */
  relations?: string[]
  /** the status ladder a child is read with. Default: {@link MARKS}. */
  marks?: Mark[]
}

// The far ends of every edge of these relations leading away from `eid`,
// deduplicated. An edge is a component, so "the links out of t1" is an ordinary
// query — one per relation, folded so a synchronous storage stays synchronous.
let kidsOf = (tx: Tx, eid: Eid, rels: string[]): Eid[] | Promise<Eid[]> => {
  let seen = new Set<Eid>()
  return then(
    each(rels, null, (_, rel) =>
      then(
        tx.read(and(eq(`${EDGE}.from`, eid), present(rel))),
        (bundles) => {
          for (let b of bundles) {
            let to = (b[EDGE] as Record<string, unknown> | undefined)?.to
            if (typeof to == 'string') seen.add(to)
          }
          return null
        },
      )),
    () => [...seen],
  ) as Eid[] | Promise<Eid[]>
}

/**
 * How many of this task's children are still unfinished — the calm "3 left"
 * count, never an alarm. Follows `requires` and `contains` out of the task and
 * counts the far ends that have not settled; a child that is not a task cannot
 * settle and so counts as open. Zero is the ordinary answer, and renders as
 * nothing.
 *
 * ```ts
 * import { openDeps } from '@yaks/task'
 *
 * // openDeps(storage, 't1') // → 2
 * ```
 */
export let openDeps = (
  storage: Storage,
  eid: Eid,
  opts: DepOpts = {},
): number | Promise<number> => {
  let marks = opts.marks ?? MARKS
  let tx = detached(storage)
  return then(
    kidsOf(tx, eid, opts.relations ?? [REQUIRES, CONTAINS]),
    (kids) =>
      kids.length == 0 ? 0 : then(tx.get(kids), (bundles) => {
        // Counted by what HAS settled, so a child the storage does not hold —
        // and therefore cannot be shown to have finished — stays counted.
        let done = bundles.filter((b) => {
          let s = statusOf(b, marks)
          return s != null && settled(s, marks)
        }).length
        return kids.length - done
      }),
  ) as number | Promise<number>
}
