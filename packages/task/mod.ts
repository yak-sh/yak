/**
 * @yaks/task — a to-do list as a set of components for a
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}.
 *
 * Say a team keeps a list of what it has to do. Four things come up, and this
 * package is the four answers:
 *
 * - **What is on the list?** An entity with a `task{}` component is a to-do
 *   item. `task` is one component among the entity's others, not a record type
 *   of its own: the same entity also carries your `doc`, your `estimate`,
 *   anything else it is — adding `task` to something makes it something to do
 *   without making it stop being what it was. @yaks/project's optional
 *   `filed{project, priority, domain, assignee}` places it in a portfolio.
 * - **Where does it stand?** No column holds the answer. A task with a
 *   `completed` component is done, one with `cancelled` is cancelled, and one
 *   with neither is open. `status` is computed from those components, so
 *   finishing something records when and by whom instead of overwriting a
 *   value, and reopening it means removing a component rather than guessing
 *   what the status used to be.
 * - **How do you look at the list?** A `board{query}` is a saved filter. Its
 *   membership is never stored — no row records that a task is on a board — so
 *   a board is always current, and a task that starts matching the query is on
 *   it. The empty query selects nothing, on purpose.
 * - **What is it waiting for?** `requires` and `contains` relate one task to
 *   another through {@link https://jsr.io/@yaks/edge | @yaks/edge}, and
 *   `blocked{on}` records that something outside the graph is in the way.
 *
 * ## Blocked is not a status
 * There is no `blocked` status, and that is a decision rather than an omission.
 * A blocked task is still open work: rolling it into the status would hide it
 * from every query for open work exactly when somebody needs to see it. So
 * `blocked` is a component read by {@link gated}, and unfinished children are
 * an ordinary count read by {@link openDeps} — "3 left", never an alarm.
 *
 * ## The status rule is written once
 * ```ts
 * import { compute, derived, statusOf } from '@yaks/task'
 *
 * statusOf(bundle)  // for an entity in hand
 * derived()         // the same rule as SQL, for @yaks/sql
 * compute()         // the same rule per bundle, for @yaks/match
 * ```
 * All three are built from one ordered list of marks ({@link MARKS}), so a
 * saved filter selects the same tasks in a database and in a page. Add a rung
 * and every reader learns it at once — a graph that leases its tasks reads a
 * held lease as `wip` by passing
 * `[...MARKS, { status: 'wip', comp: 'claim', settled: false }]`.
 *
 * ## Use
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { edgeDoc, edgeKeywords } from '@yaks/edge'
 * import { taskDoc } from '@yaks/task'
 *
 * let vocab = loadVocab([edgeDoc, taskDoc, mine], [edgeKeywords])
 * // let g = graph({ storage, vocab, plugins: [edges(vocab), tasks()] })
 * ```
 *
 * It imports no platform API, so the same list runs on a server, in a worker,
 * and in a browser tab.
 *
 * @module
 */

export * from './words.ts'
export * from './comp.ts'
export * from './status.ts'
export * from './deps.ts'
export * from './plugin.ts'
