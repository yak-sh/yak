// The whole scheduling rule, as two nearly pure functions over a graph. There
// is no timer here and no loop: this module computes which wakes are due and
// what firing one writes, and the program running it arranges to be called — a
// Deno tick, a Durable Object `alarm()`, a browser tab, a cron job hitting a
// route. Every one of them calls the same two functions, which is the point.
//
// The rule is one predicate: a wake is due when its `at` has passed. That is
// all, and it holds no matter how long the process was down, because `at` is a
// stored property and not a running process's memory of when to come back.
//
// Firing one moves that row forward, and how it moves is what separates a
// cadence from a one-shot:
//
//   recurring   `at` becomes the next instant, so it stops being due
//   one-shot    `at` is cleared, so it can never be due again
//
// Both write `fired`. Neither deletes anything: that a wake fired is worth
// keeping, and an application that wants it gone deletes the entity itself.
// Clearing `at` rather than deleting the entity also means a finished wake can
// be set again by writing a new `at` — the same alarm clock, wound back up.
//
// Nothing here reads a clock it was not given. `now` is a parameter everywhere,
// which is why the tests take microseconds, and why two processes reading the
// same graph at the same instant agree.

import type { Bundle, Comp, Entity, Storage } from '@yaks/graph'
import { then } from '@yaks/graph'
import { FIRED, WAKE, type Wake } from './comp.ts'
import { after } from './every.ts'

/** How a schedule is read: the time zone a cron line is interpreted in. */
export type Clock = {
  /** the time zone a cron `every` is read in (default `UTC`) */
  tz?: string
}

let iso = (t: number): string => new Date(t).toISOString()

/** The wake a bundle carries, or `undefined`. */
export let wakeOf = (b: Bundle): Wake | undefined =>
  (b[WAKE] ?? undefined) as Wake | undefined

/**
 * The wakes due at `now`, oldest first — every entity whose `wake.at` has
 * passed, as whole bundles.
 *
 * This is the only read the package makes, and it is an ordinary query, so an
 * application that would rather run its own (a narrower filter, a page at a
 * time) can: `.wake.at<=<instant>`.
 *
 * ```ts
 * import { due, ring } from '@yaks/wake'
 *
 * let now = Date.now()
 * // let owed = due(storage, now)
 * // for (let w of owed) graph.apply([ring(w, now)])
 * ```
 *
 * It follows @yaks/graph's synchronous pass-through: over a synchronous storage
 * it returns the bundles, and over an asynchronous one a promise for them.
 */
export let due = (
  storage: Pick<Storage, 'read'>,
  now: number = Date.now(),
): Bundle[] | Promise<Bundle[]> =>
  storage.read(`.${WAKE}.at<=${iso(now)}&.order=${WAKE}.at`, { now })

/**
 * The next ISO instant after `now`, computed from a recurrence string or from a
 * wake — `null` for a one-shot, or for a recurrence this package cannot parse.
 * Given a string, a duration is counted from `now`; given a wake, the cadence
 * keeps its original phase.
 *
 * A duration is counted from the wake's own `at`, so a cadence keeps its phase;
 * a cron line is evaluated against the calendar. See
 * {@link https://jsr.io/@yaks/wake/doc/~/after | after}.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { next } from '@yaks/wake'
 *
 * let from = Date.parse('2026-01-01T09:00:00Z')
 * assertEquals(next('1d', from), '2026-01-02T09:00:00.000Z')
 * assertEquals(next('@daily', from, 'America/Detroit'), '2026-01-02T05:00:00.000Z')
 * assertEquals(next({ at: '2026-01-01T09:00:00Z' }, from), null)
 * ```
 */
export let next = (
  wake: Wake | string,
  now: number = Date.now(),
  clock: Clock | string = {},
): string | null => {
  let tz = typeof clock == 'string' ? clock : clock.tz
  if (typeof wake == 'string') {
    let at = after(wake, now, now, tz)
    return at == null ? null : iso(at)
  }
  if (!wake.every || !wake.at) return null
  let from = Date.parse(wake.at)
  if (Number.isNaN(from)) return null
  let at = after(wake.every, from, now, tz)
  return at == null ? null : iso(at)
}

/**
 * The patch that fires a due wake: the `fired` value, plus its `at` moved on to
 * the next instant — or cleared, when there is no next one. `every` is the
 * cadence it goes on at, its own by default; `tick` passes the one its
 * `while` chose.
 *
 * It returns a bundle rather than applying it. `tick` applies one such bundle
 * per wake, and the graph's rules react to that write in their own phases.
 *
 * ```ts
 * // let owed = due(storage, now)
 * // for (let w of owed) graph.apply([ring(w, now)])
 * ```
 */
export let ring = (
  b: Bundle,
  now: number = Date.now(),
  clock: Clock = {},
  every: string | null | undefined = wakeOf(b)?.every,
): Bundle => ({
  entity: b.entity,
  [WAKE]: { at: next({ ...wakeOf(b), every }, now, clock) } as Comp,
  [FIRED]: { at: iso(now) } as Comp,
})

/**
 * The instant the scheduler should next run — the earliest `at` still in the
 * future, or `null` when nothing is pending. This is what a Durable Object
 * passes to `setAlarm()`, and what a server passes to `setTimeout`.
 *
 * An application may equally ignore this and poll on a fixed cadence; it is
 * here so that one able to sleep until an exact instant does not have to poll.
 */
export let soonest = (
  storage: Pick<Storage, 'read'>,
  now: number = Date.now(),
): number | null | Promise<number | null> =>
  then(
    storage.read(`.${WAKE}.at>${iso(now)}&.order=${WAKE}.at&.limit=1`, { now }),
    ([b]) => {
      let at = wakeOf(b ?? { entity: {} as Entity })?.at
      return at ? Date.parse(at) : null
    },
  )
