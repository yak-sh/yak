// The two questions a task list asks about a task that is not finished: is
// anything in the way, and how much of it is left.
//
// They are deliberately different questions with different answers, because
// conflating them is what makes a board shout.
//
// Gated is the alarm. `blocked{on}` records that something outside the graph
// has stopped this — a vendor, a decision, a person who has not replied. Nobody
// here can move it, so it is worth a mark on the row.
//
// Open deps is not an alarm. A task with three unfinished `requires` children
// is a task with three unfinished children: ordinary work, in progress, exactly
// as it should be. It is a count — "3 left" — and zero renders nothing at all.
// Showing it in red would mean flagging every plan the moment somebody made
// one.
//
// A child that is not a task cannot settle, so it counts as open: a task
// waiting on a document is waiting until somebody removes the link.
//
// Synchronous in, synchronous out: over a storage that answers immediately (a
// Map, an embedded database) so do these functions, while an asynchronous
// storage turns the answer into a promise. Nothing in between has to know
// which.

import type { Bundle, Eid, Graph, Tx } from '@yaks/graph'
import { after } from '@yaks/fp'
import { detached } from '@yaks/graph/storage'
import { and, eq, or, present } from '@yaks/query'
import { EDGE } from '@yaks/edge'
import { settled, statusOf } from './words.ts'
import { BLOCKED, CONTAINS, REQUIRES } from './comp.ts'

/**
 * Is something outside the graph in the way? Reads the `blocked` component,
 * which is never a status — a blocked task is still open work, and still shows
 * up in every query for open work.
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

/** Which links count as work this task is waiting on. */
export type DepOpts = {
  /** the relation tags to follow. Default: `requires` and `contains`. */
  relations?: string[]
}

// The other ends of every edge with any of these relations touching `eid` at
// `at`, deduplicated: `from` follows edges away from it, `to` edges into it.
// Read the matching edges together, so one end linked by two relations costs
// only one read.
let ends = (
  tx: Tx,
  eid: Eid,
  rels: string[],
  at: 'from' | 'to',
): Eid[] | Promise<Eid[]> => {
  if (!rels.length) return []
  let far = at == 'from' ? 'to' : 'from'
  return after(
    tx.read(and(eq(`${EDGE}.${at}`, eid), or(...rels.map(present)))),
    (bundles) => {
      let seen = new Set<Eid>()
      for (let b of bundles) {
        let end = (b[EDGE] as Record<string, unknown> | undefined)?.[far]
        if (typeof end == 'string') seen.add(end)
      }
      return [...seen]
    },
  )
}

/**
 * What this task waits on: the far ends of its `requires` and `contains`
 * edges, settled or not.
 *
 * ```ts
 * import { dependencies } from '@yaks/task'
 *
 * // dependencies(graph, 'p') // → ['a', 'b']
 * ```
 */
export let dependencies = (
  { storage }: Pick<Graph, 'storage'>,
  eid: Eid,
  opts: DepOpts = {},
): Eid[] | Promise<Eid[]> =>
  ends(detached(storage), eid, opts.relations ?? [REQUIRES, CONTAINS], 'from')

/**
 * What waits on this task: the near ends of the `requires` and `contains`
 * edges leading to it, the tasks its finishing may free.
 *
 * ```ts
 * import { dependents } from '@yaks/task'
 *
 * // dependents(graph, 'a') // → ['p']
 * ```
 */
export let dependents = (
  { storage }: Pick<Graph, 'storage'>,
  eid: Eid,
  opts: DepOpts = {},
): Eid[] | Promise<Eid[]> =>
  ends(detached(storage), eid, opts.relations ?? [REQUIRES, CONTAINS], 'to')

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
 * // openDeps(graph, 't1') // → 2
 * ```
 */
export let openDeps = (
  { storage, vocab }: Pick<Graph, 'storage' | 'vocab'>,
  eid: Eid,
  opts: DepOpts = {},
): number | Promise<number> => {
  let tx = detached(storage)
  return after(
    ends(tx, eid, opts.relations ?? [REQUIRES, CONTAINS], 'from'),
    (kids) =>
      kids.length == 0 ? 0 : after(tx.get(kids), (bundles) => {
        // Counted by what has settled, so a child the storage does not hold —
        // and which therefore cannot be shown to have finished — stays counted.
        let done = bundles.filter((b) => settled(statusOf(vocab, b))).length
        return kids.length - done
      }),
  ) as number | Promise<number>
}

/**
 * Has this task settled and finished its dependencies? Completion alone does
 * not release a parent while `requires` or `contains` children remain open.
 * Like {@link openDeps}, this counts direct far ends, not a recursive walk.
 * A missing entity, or an entity without a `task` component, is never done.
 *
 * Synchronous storage returns a boolean; asynchronous storage returns a
 * promise.
 */
export let done = (
  held: Pick<Graph, 'storage' | 'vocab'>,
  eid: Eid,
  opts: DepOpts = {},
): boolean | Promise<boolean> =>
  after(held.storage.get([eid]), (bundles) => {
    if (!bundles[0] || !settled(statusOf(held.vocab, bundles[0]))) return false
    return after(openDeps(held, eid, opts), (count) => count == 0)
  }) as boolean | Promise<boolean>
