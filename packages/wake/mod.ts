/**
 * @yaks/wake — schedules as graph rows, shared by Deno, Workers and browsers.
 * A wake records when to come back to something; firing it writes `fired{at}`
 * on the same entity. The graph's rules decide what follows that write.
 *
 * - `wake{at, every, while, target, note}` — the next instant, optional
 *   recurrence, the conditions it recurs under, what it is about, and why.
 * - `fired{at}` — the most recent firing.
 *
 * ```ts
 * import { next, tick } from '@yaks/wake'
 *
 * let at = next('20 4 * * * America/Detroit', Date.now())
 * // await graph.apply([{ entity: { eid: 'cleanup' }, wake: { at }, sweep: {} }])
 * // await tick(graph, Date.now())
 * ```
 *
 * `tick` finds the due wakes and applies one transaction per wake, each with a
 * precondition on what it read: `fired` plus the next `wake.at`, or a cleared
 * `at` for a one-shot. One rejected transaction leaves that wake due and lets
 * the others fire. Occurrences missed during an outage collapse into one
 * firing, which then advances past now.
 *
 * A rule such as `.wake, *fired, .sweep` runs through the graph's own phases.
 * `produce` is the declarative case; `run` is code. `#Now` is the tick's
 * instant and `#Actor` is the actor of the write, as in every graph write.
 *
 * A duration (`30m`, `every 3 days`) keeps its original cadence. Five cron
 * fields (`0 9 * * 1-5`) or `@hourly`, `@daily`, `@weekly`, `@monthly` name
 * calendar positions. An optional trailing IANA time zone is stored in the same
 * property; with none, UTC is used. Croner uses Intl, with no build step.
 *
 * `while` makes a recurrence conditional: `{match, every}` in order, the first
 * whose query finds anything setting the cadence at each firing. A wake none
 * holds sleeps, and `rouse` arms it again once a write makes one hold.
 *
 * This module starts no timer and imports no platform API. The program running
 * it calls `tick` when its own clock fires, and `rouse` after its writes
 * commit.
 *
 * @module
 */

export * from './comp.ts'
export * from './every.ts'
export * from './due.ts'
export * from './plugin.ts'
export * from './tick.ts'
export * from './pace.ts'
