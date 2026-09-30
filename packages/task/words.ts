// What a task's status means once it is read.
//
// The status itself is computed, never stored. ./vocab.json declares it with
// the `status` keyword: a ladder over the marks a task wears, where `cancelled`
// reads cancelled, `completed` (@yaks/kernel's) done, and neither open.
// @yaks/sql and @yaks/match read it from that one declaration, so no code here
// writes the rule out. Order is the rule: a task cancelled after it was
// completed reads `cancelled`, since calling work off is a later fact about it
// than finishing was.
//
// The ladder is extensible because status is: a graph that leases its tasks
// adds a rung where it declares the lease, and @yaks/session reads a held claim
// as `wip`. Somebody working on a task has not finished it, which is why
// `settled` names the two statuses that end one rather than every rung.

import { statusOf as ladder } from '@yaks/match'
import type { Vocab } from '@yaks/vocab'
import { TASK } from './comp.ts'

/**
 * A task's status, read off the bundle through the ladder the vocabulary
 * declares: the first rung it wears, else the status its store read, else
 * `open`. An entity that is not a task has none, and reads `null`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { loadVocab } from '@yaks/vocab'
 * import { kernelDoc, kernelKeywords } from '@yaks/kernel'
 * import { statusOf, taskDoc } from '@yaks/task'
 *
 * let v = loadVocab([kernelDoc, taskDoc], [kernelKeywords])
 * let task = { entity: { eid: 't1' }, task: {} }
 * assertEquals(statusOf(v, task), 'open')
 * assertEquals(statusOf(v, { ...task, completed: {} }), 'done')
 * assertEquals(statusOf(v, { ...task, completed: {}, cancelled: {} }), 'cancelled')
 * assertEquals(statusOf(v, { entity: { eid: 'x' }, completed: {} }), null)
 * ```
 */
export let statusOf = (
  v: Vocab,
  b: Record<string, unknown>,
): string | null => ladder(v, TASK, b)

/** Does this status mean the work is over: finished, or called off? An open
 * task has not settled, and neither has one somebody is on (`wip`). This is
 * what {@link https://jsr.io/@yaks/task/doc/~/openDeps | openDeps} counts by
 * its absence. */
export let settled = (status?: string | null): boolean =>
  status == 'done' || status == 'cancelled'
