// The status values this package defines, and the one list every reading of a
// task's status is computed from.
//
// A task's status is not a stored property somebody writes. It is computed from
// the components the task carries, independently of any optional `filed`
// component: `cancelled` means cancelled, `completed` means done, and a task
// with neither is open. That is the whole rule, and it lives here as data — an
// ordered list of marks — so that the two evaluators which need it (a database
// through @yaks/sql, an array through @yaks/match) are built from one
// declaration rather than from two copies that drift.
//
// Order is the rule. The first mark the task has wins, so a task that was
// cancelled after it was completed reads `cancelled`: calling work off is a
// later fact about it than finishing was.
//
// The ladder is extensible because status is: an application that leases its
// tasks adds a rung of its own — a held lease reads `wip`, and declares
// `settled: false`, because somebody working on it has not finished it. Every
// function here accepts a `marks` list; {@link MARKS} is the default.

/** What a task's status can be: the three the marks below define, plus whatever
 * rung an application adds. It is a plain string on purpose — a closed union
 * would make an added rung a type error rather than a declaration. */
export type Status = string

/**
 * One rung of the status ladder: a task carrying `comp` reads as `status`.
 * A mark is a component's presence, never a property's value, so marking a task
 * done means writing `completed{at, by}` — a fact with an author and a time —
 * and un-marking it means removing that component.
 */
export type Mark = {
  /** what a task carrying this component reads as */
  status: Status
  /** the component whose presence is the mark */
  comp: string
  /** whether this status ends the work. Default `true` — a mark ordinarily
   * means the task is over; a rung that only means somebody is on it (a lease)
   * declares `false`. */
  settled?: boolean
}

/** What a task with no mark on it reads as. */
export let OPEN = 'open'

/**
 * The default ladder, most decisive first: cancelled outranks done, and a task
 * with neither is {@link OPEN}. Spread it into your own list to add a rung.
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

/** Every status a ladder can produce, in ladder order with {@link OPEN} last —
 * the closed set a status filter is checked against. */
export let statuses = (marks: Mark[] = MARKS): Status[] => [
  ...marks.map((m) => m.status),
  OPEN,
]

/**
 * The closed set a vocabulary declares: the `statuses` enum this package
 * ships, which names every rung a task's status can read as — the three the
 * default ladder defines, and the one a graph that leases its tasks adds, since
 * the set of values is the same wherever the marks come from. Code that checks
 * a status without being handed a marks list reads this, so a board filtering
 * on `wip` is routed rather than refused; a vocabulary without the enum reads
 * as the default ladder.
 */
export let declared = (
  vocab: { docs: { $defs?: Record<string, unknown> }[] },
): Status[] => {
  for (let doc of vocab.docs) {
    let said = doc.$defs?.statuses as { enum?: unknown } | undefined
    if (Array.isArray(said?.enum)) return said.enum as Status[]
  }
  return statuses()
}

/** Does this status mean the work is over? An open task is never settled, and a
 * rung that declared `settled: false` is not either. This is what
 * {@link https://jsr.io/@yaks/task/doc/~/openDeps | openDeps} counts by its
 * absence. */
export let settled = (status: Status, marks: Mark[] = MARKS): boolean =>
  status != OPEN &&
  marks.some((m) => m.status == status && m.settled !== false)
