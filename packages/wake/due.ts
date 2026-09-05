// The whole scheduling rule, as two pure-ish functions over a graph. There is
// no timer here and no loop: this package answers WHICH wakes are owed and
// WHAT consuming one writes, and the host arranges the coming back — a Deno
// tick, a Durable Object `alarm()`, a browser tab, a cron job hitting a route.
// Every one of them runs the same two functions, which is the point.
//
// The rule is one predicate: a wake is DUE when its `at` has passed. That is
// all, and it holds no matter how long the host was away, because `at` is a
// row and not a process's memory of when to come back.
//
// Consuming one moves that row forward, and the shape of the move is what
// separates a cadence from a one-shot:
//
//   recurring   `at` becomes the next instant, so it stops being due
//   one-shot    `at` is cleared, so it can never be due again
//
// Both stamp `fired`. Neither deletes anything: a fired wake is a fact worth
// keeping, and a host that wants it gone deletes the entity itself. Clearing
// `at` rather than tombstoning also means a finished wake can be set again by
// writing a new `at` — the same alarm clock, wound back up.
//
// Nothing here reads a clock it was not handed. `now` is a parameter
// everywhere, which is why the tests take microseconds and why two hosts
// reading the same graph at the same instant agree.

import type { Bundle, Comp, Entity, Storage } from '@yaks/graph'
import { then } from '@yaks/graph'
import { FIRED, WAKE, type Wake } from './comp.ts'
import { after } from './every.ts'

/** How a schedule is read: the zone a cron line means. */
export type Clock = {
  /** the zone a cron `every` is read in (default `UTC`) */
  tz?: string
}

let iso = (t: number): string => new Date(t).toISOString()

/** The wake a bundle carries, or `undefined`. */
export let wakeOf = (b: Bundle): Wake | undefined =>
  (b[WAKE] ?? undefined) as Wake | undefined

/**
 * The wakes owed at `now`, oldest first — every entity whose `wake.at` has
 * passed, as whole bundles.
 *
 * This is the only read the package makes, and it is an ordinary query, so a
 * host that would rather ask its own way (a narrower filter, a page at a time)
 * can: `.wake.at<=<instant>`.
 *
 * ```ts
 * import { due, ring } from '@yaks/wake'
 *
 * let now = Date.now()
 * // let owed = due(storage, now)
 * // for (let w of owed) graph.apply([ring(w, now)])
 * ```
 *
 * It threads @yaks/graph's sync pass-through: over a synchronous storage it
 * returns the bundles, over an asynchronous one a promise for them.
 */
export let due = (
  storage: Storage,
  now: number = Date.now(),
): Bundle[] | Promise<Bundle[]> =>
  storage.read(`.${WAKE}.at<=${iso(now)}&.order=${WAKE}.at`, { now })

/**
 * When a wake is next due after `now`, as an ISO instant — `null` when it is
 * finished: a one-shot, or a recurrence this package cannot read.
 *
 * A duration counts from the wake's own `at`, so a cadence keeps its phase;
 * a cron line is read against the calendar. See
 * {@link https://jsr.io/@yaks/wake/doc/~/after | after}.
 *
 * ```ts
 * next({ at: '2026-01-01T09:00:00Z', every: '1d' }, Date.parse('2026-01-01T09:00:00Z'))
 * // '2026-01-02T09:00:00.000Z'
 * next({ at: '2026-01-01T09:00:00Z' }, Date.now()) // null — a one-shot
 * ```
 */
export let next = (
  wake: Wake,
  now: number = Date.now(),
  clock: Clock = {},
): string | null => {
  if (!wake.every || !wake.at) return null
  let from = Date.parse(wake.at)
  if (Number.isNaN(from)) return null
  let at = after(wake.every, from, now, clock.tz)
  return at == null ? null : iso(at)
}

/**
 * The patch that CONSUMES a due wake: the `fired` stamp, plus its `at` moved
 * on to the next instant — or cleared, when there is no next one.
 *
 * It is a bundle rather than a write, so the host decides how it lands: in the
 * same batch as whatever the wake was for (one transaction, so a wake is never
 * marked fired without the work it named), or on its own.
 *
 * ```ts
 * // let owed = due(storage, now)
 * // graph.apply(owed.flatMap((w) => [...doTheThing(w), ring(w, now)]))
 * ```
 */
export let ring = (
  b: Bundle,
  now: number = Date.now(),
  clock: Clock = {},
): Bundle => ({
  entity: b.entity,
  [WAKE]: { at: next(wakeOf(b) ?? {}, now, clock) } as Comp,
  [FIRED]: { at: iso(now) } as Comp,
})

/**
 * The instant a host should next come back — the earliest `at` still in the
 * future, or `null` when nothing is pending. What a Durable Object hands to
 * `setAlarm()`, and what a server hands to `setTimeout`.
 *
 * A host may equally ignore this and sweep on a fixed cadence; it is here so
 * that one that can sleep until an exact instant does not have to.
 */
export let soonest = (
  storage: Storage,
  now: number = Date.now(),
): number | null | Promise<number | null> =>
  then(
    storage.read(`.${WAKE}.at>${iso(now)}&.order=${WAKE}.at&.limit=1`, { now }),
    ([b]) => {
      let at = wakeOf(b ?? { entity: {} as Entity })?.at
      return at ? Date.parse(at) : null
    },
  )
