// The derived status, said ONCE and read by both evaluators.
//
// `task.status` is declared `persist: false` — there is no column holding it.
// Its value is the first mark the task wears (./words.ts), and that one list is
// what everything here is built from:
//
//   statusOf(bundle)   the value, for an entity already in hand
//   compute(marks)     the same rule as @yaks/match reads it, per bundle
//   derived(marks)     the same rule as @yaks/sql reads it, as SQL
//
// Two evaluators, one rule. A saved filter therefore selects the same tasks in a
// database and in a page, which is the property that makes a board portable at
// all — and the reason the rule is data here rather than a formula written out
// twice.
//
// The SQL is a `case` over `exists` per mark, in ladder order, and it opens with
// a null guard: an entity that is not a task reads NULL, not `open`, so
// `.status=open` cannot match a comment. That mirrors how a stored column reads
// through a LEFT join, which is what every other column in the query does.
//
// The in-memory side answers the same way: a bundle not wearing `task` reads
// null. Its shape — a map from `comp.prop` to a function of the bundle — is what
// @yaks/match's computed-column hook takes; until that hook lands (T-33611) this
// export is the rule waiting for its second reader, and `matcher()` declines a
// status filter rather than answering it almost-right.

import type { Bundle } from '@yaks/graph'
import type { DerivedCol } from '@yaks/sql'
import { type Mark, MARKS, OPEN, type Status, statuses } from './words.ts'
import { TASK } from './comp.ts'

/** Does this bundle wear this component? */
let wears = (b: Bundle, name: string): boolean => {
  let c = b[name]
  return c != null && typeof c == 'object'
}

/**
 * A task's status, read off the marks it wears: the first mark in ladder order
 * wins, and a task wearing none is `open`. An entity that is not a task has no
 * status at all and reads `null` — the same nothing a database reads for it.
 *
 * ```ts
 * import { statusOf } from '@yaks/task'
 *
 * statusOf({ entity: { eid: 't1' }, task: {} }) // 'open'
 * statusOf({ entity: { eid: 't2' }, task: {}, completed: { at: '…' } }) // 'done'
 * ```
 */
export let statusOf = (b: Bundle, marks: Mark[] = MARKS): Status | null => {
  if (!wears(b, TASK)) return null
  return marks.find((m) => wears(b, m.comp))?.status ?? OPEN
}

/**
 * A computed column read in memory: `comp.prop` → the value for one bundle.
 * The shape {@link https://jsr.io/@yaks/match | @yaks/match} takes for a column
 * a vocabulary declares but never stores.
 */
export type Compute = Record<string, (b: Bundle) => unknown>

/**
 * The status rule for the in-memory evaluator — `{'task.status': …}` — so a
 * page filtering `.status=open` over bundles it already holds answers the way
 * the database does.
 *
 * Hand it to @yaks/match's computed-column hook once that hook exists
 * (T-33611); today it is the rule in the shape that hook takes, and the in-memory
 * side declines a status filter rather than guessing.
 */
export let compute = (marks: Mark[] = MARKS): Compute => ({
  [`${TASK}.status`]: (b) => statusOf(b, marks),
})

/**
 * The same rule for {@link https://jsr.io/@yaks/sql | @yaks/sql}'s `derived`
 * hook, so `.status=open` compiles into the statement and answers through the
 * index instead of falling back to reading every row.
 *
 * ```ts
 * import { compile } from '@yaks/sql'
 * import { derived } from '@yaks/task'
 *
 * // compile(ast, vocab, { derived: derived() })
 * ```
 */
export let derived = (marks: Mark[] = MARKS): Record<string, DerivedCol> => ({
  [`${TASK}.status`]: {
    tag: 'enum',
    values: statuses(marks),
    expr: (owner) =>
      `(case when ${owner} is null then null` +
      marks.map((m) =>
        ` when exists(select 1 from "${m.comp}" __s` +
        ` where __s."entity" = ${owner}) then '${m.status}'`
      ).join('') +
      ` else '${OPEN}' end)`,
  },
})
