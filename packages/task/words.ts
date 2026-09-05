// The words this package spells, and the one list the status rule is read from.
//
// A task's STATUS is not a column somebody writes. It is read off the marks the
// task wears: a `cancelled` component means cancelled, a `completed` component
// means done, and a task wearing neither is open. That is the whole rule, and it
// lives here as DATA — an ordered list of marks — so the two evaluators that
// need it (a database through @yaks/sql, an array through @yaks/match) are built
// from one declaration rather than from two copies that drift.
//
// Order is the rule. The first mark the task wears wins, so a task that was
// cancelled after it was completed reads `cancelled`: calling work off is a
// later fact about it than finishing was.
//
// The ladder is EXTENSIBLE because status is: an application that leases its
// tasks adds a rung of its own — a held lease reads `wip`, and says
// `settled: false`, because somebody working on it has not finished it. Every
// door here takes a `marks` list; {@link MARKS} is the default.

/** What a task's status can be: the three the marks below spell, plus whatever
 * rung an application adds. It is a plain string on purpose — a closed union
 * would make an added rung a type error rather than a declaration. */
export type Status = string

/**
 * One rung of the status ladder: wearing `comp` means the task reads `status`.
 * A mark is a COMPONENT's presence, never a column's value, so marking a task
 * done is writing `completed{at, by}` — a fact with an author and a time — and
 * un-marking it is dropping that component.
 */
export type Mark = {
  /** what a task wearing this component reads as */
  status: Status
  /** the component whose presence is the mark */
  comp: string
  /** whether this status ends the work. Default `true` — a mark ordinarily
   * says the task is over; a rung that only says somebody is ON it (a lease)
   * declares `false`. */
  settled?: boolean
}

/** What a task with no mark on it reads. */
export let OPEN = 'open'

/**
 * The default ladder, most decisive first: cancelled outranks done, and a task
 * wearing neither is {@link OPEN}. Spread it into your own list to add a rung.
 *
 * ```ts
 * import { MARKS } from '@yaks/task'
 *
 * // a held lease means somebody is on it, and it is not finished
 * let mine = [...MARKS, { status: 'wip', comp: 'claim', settled: false }]
 * ```
 */
export let MARKS: Mark[] = [
  { status: 'cancelled', comp: 'cancelled' },
  { status: 'done', comp: 'completed' },
]

/** Every status a ladder can read, in ladder order with {@link OPEN} last —
 * the closed set a status filter is checked against. */
export let statuses = (marks: Mark[] = MARKS): Status[] => [
  ...marks.map((m) => m.status),
  OPEN,
]

/** Does this status mean the work is over? An open task is never settled, and a
 * rung that declared `settled: false` is not either. This is what
 * {@link https://jsr.io/@yaks/task/doc/~/openDeps | openDeps} counts by its
 * absence. */
export let settled = (status: Status, marks: Mark[] = MARKS): boolean =>
  status != OPEN &&
  marks.some((m) => m.status == status && m.settled !== false)
