// The computed status, written once and read by both evaluators.
//
// `task.status` is declared `computed: true` — there is no column holding it.
// Its value is the first mark the task carries (./words.ts), and that one list
// is what everything here is built from:
//
//   statusOf(bundle)   the value, for an entity already in hand
//   compute(marks)     the same rule as @yaks/match evaluates it, per bundle
//   derived(marks)     the same rule as @yaks/sql evaluates it, as SQL
//
// Two evaluators, one rule. A saved filter therefore selects the same tasks in
// a database and in a page, which is the property that makes a board portable
// at all — and the reason the rule is data here rather than a formula written
// out twice.
//
// The SQL is a `case` over `exists` per mark, in ladder order, and it opens
// with a null guard: an entity that is not a task reads NULL, not `open`, so
// `.status=open` cannot match a comment. That mirrors how a stored column reads
// through a left join, which is what every other column in the query does.
//
// The in-memory side behaves the same way: a bundle without a `task` component
// reads null. Its shape — a map from `comp.prop` to a function of the bundle —
// is what @yaks/match's `computed` hook expects, so
// `matcher(q, vocab, { computed: compute() })` selects the tasks the database
// selects.

import type { Bundle } from '@yaks/graph'
import {
  col,
  type DerivedProp,
  eq,
  exists,
  type Expr,
  isNull,
  lit,
  select,
  table,
  when,
} from '@yaks/sql'
import { type Mark, MARKS, OPEN, type Status, statuses } from './words.ts'
import { TASK } from './comp.ts'

/** Does this bundle carry this component? */
let wears = (b: Record<string, unknown>, name: string): boolean => {
  let c = b[name]
  return c != null && typeof c == 'object'
}

/** The status a store derived and the bundle carries, if it carries one. */
let carried = (b: Record<string, unknown>): Status | undefined => {
  let s = (b[TASK] as { status?: unknown }).status
  return typeof s == 'string' ? s : undefined
}

/**
 * A task's status: the first mark in ladder order the bundle carries, else the
 * `task.status` it carries, else `open`. An entity that is not a task has no
 * status at all and reads `null` — the same nothing a database reads for it.
 *
 * The carried status is what a store derived with its whole ladder, so it
 * holds where the marks are missing: a read answers the components it names,
 * and `.task` alone brings the status without the `completed` behind it. It
 * also knows rungs this caller's `marks` may not, such as a held claim's
 * `wip`. A mark the bundle does carry wins over it, because a mark written
 * here is newer evidence than the status read before it.
 *
 * ```ts
 * import { statusOf } from '@yaks/task'
 *
 * statusOf({ entity: { eid: 't1' }, task: {} }) // 'open'
 * statusOf({ entity: { eid: 't2' }, task: {}, completed: { at: '…' } }) // 'done'
 * statusOf({ entity: { eid: 't3' }, task: { status: 'done' } }) // 'done'
 * ```
 */
export let statusOf = (
  b: Record<string, unknown>,
  marks: Mark[] = MARKS,
): Status | null => {
  if (!wears(b, TASK)) return null
  return marks.find((m) => wears(b, m.comp))?.status ?? carried(b) ?? OPEN
}

/**
 * A computed property evaluated in memory: `comp.prop` → the value for one
 * bundle. The shape {@link https://jsr.io/@yaks/match | @yaks/match} expects
 * for a property a vocabulary declares but never stores.
 */
export type Compute = Record<string, (b: Bundle) => unknown>

/**
 * The status rule for the in-memory evaluator — `{'task.status': …}` — so a
 * page filtering `.status=open` over bundles it already holds gets the same
 * answer the database gives.
 *
 * ```ts
 * import { matcher } from '@yaks/match'
 * import { compute } from '@yaks/task'
 *
 * matcher('.status=open', vocab, { computed: compute() })(bundles)
 * ```
 */
export let compute = (marks: Mark[] = MARKS): Compute => ({
  [`${TASK}.status`]: (b) => statusOf(b, marks),
})

/**
 * The same rule for {@link https://jsr.io/@yaks/sql | @yaks/sql}'s `derived`
 * hook, so `.status=open` compiles into the statement and is answered through
 * the index instead of falling back to reading every row.
 *
 * ```ts
 * import { compile } from '@yaks/sql'
 * import { derived } from '@yaks/task'
 *
 * // compile(ast, vocab, { derived: derived() })
 * ```
 */
export let derived = (marks: Mark[] = MARKS): Record<string, DerivedProp> => ({
  [`${TASK}.status`]: {
    tag: 'enum',
    values: statuses(marks),
    expr: (owner) =>
      when(
        [
          [isNull(owner), lit(null)],
          ...marks.map((m): [Expr, Expr] => [
            exists(select({
              cols: [lit(1)],
              from: table(m.comp, '__s'),
              where: eq(col('entity', '__s'), owner),
            })),
            lit(m.status),
          ]),
        ],
        lit(OPEN),
      ),
  },
})
