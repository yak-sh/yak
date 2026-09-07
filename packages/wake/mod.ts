/**
 * @yaks/wake — schedules as graph rows, shared by Deno, Workers and browsers.
 * A wake says when to return; firing it writes `fired{at}` on the same entity.
 * The graph's rules decide what follows that write.
 *
 * - `wake{at, every, target, note}` — the next instant, optional recurrence,
 *   what it is about, and why.
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
 * `tick` finds the due wakes and applies one guarded batch per wake: `fired`
 * plus the next `wake.at`, or a cleared `at` for a one-shot. One refusal leaves
 * that wake due and lets the others fire. An outage coalesces missed ticks
 * into one firing, then advances beyond now.
 *
 * A rule such as `.wake, *fired, .sweep` runs through the graph's own phases.
 * `produce` is the declarative case; `run` is code. `#Now` is the tick's instant
 * and `#Actor` is the actor of the batch, as with every graph write.
 *
 * A duration (`30m`, `every 3 days`) keeps its original cadence. Five cron
 * fields (`0 9 * * 1-5`) or `@hourly`, `@daily`, `@weekly`, `@monthly` name
 * calendar positions. An optional trailing IANA zone travels with the row;
 * absent one, UTC is the default. Croner uses Intl, with no build step.
 *
 * The core starts no timer and imports no platform API. Hosts call `tick`
 * when their own clock comes due.
 *
 * @module
 */

export * from './comp.ts'
export * from './every.ts'
export * from './due.ts'
export * from './plugin.ts'
export * from './tick.ts'
