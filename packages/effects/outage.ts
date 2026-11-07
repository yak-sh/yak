// The record of a failure that lasts, kept across the tries of whatever keeps
// failing, so it is told once and its end is logged.
//
// A remote that does not answer (an edge's tray, the platform tracker, a
// model) and a step that keeps failing by the same bug run the same course:
// the first failure starts an outage, the failures after it ride on in it, one
// that finds it has lasted the caller's limit reports it once, and the first
// answer ends it, saying how long it lasted. The record is a value, not a
// timer: a service keeps it in a variable between passes, a Durable Object in
// its storage between alarms. What is logged or reported, in what words, is
// the caller's.

/** A failure that lasts: since when, the cause it fails by where the caller
 * names one, and whether its lasting has been reported. */
export type Outage = { since: number; cause?: string; told?: true }

/** What one failure makes of the outage it met. */
export type Failing = {
  /** the outage it started or rides on in; the one it met while nothing
   * changed */
  outage: Outage
  /** it started the outage, or failed by a cause other than the one before */
  fresh: boolean
  /** how long the outage has lasted, the one time a failure finds it at
   * `limit` or past it */
  stayed?: number
}

/**
 * A failure at `now`. Met with no outage, it starts one; else it rides on in
 * it, keeping its `since`. A `cause` other than the outage's is fresh, as a
 * new bug is; without one, the outage keeps its own. An outage a failure
 * finds lasted `limit` (default: never) has `stayed`, once.
 *
 * ```ts
 * import { failing } from '@yaks/effects/outage'
 * import { equal } from '@yaks/testing'
 * let { outage } = failing(null, 0)
 * equal(failing(null, 0), { outage: { since: 0 }, fresh: true })
 * equal(failing(outage, 60_000, { limit: 300_000 }), { outage, fresh: false })
 * equal(failing(outage, 300_000, { limit: 300_000 }), {
 *   outage: { since: 0, told: true },
 *   fresh: false,
 *   stayed: 300_000,
 * })
 * equal(failing({ since: 0, cause: 'Error: a' }, 9, { cause: 'Error: b' }), {
 *   outage: { since: 0, cause: 'Error: b' },
 *   fresh: true,
 * })
 * ```
 */
export let failing = (
  outage: Outage | null | undefined,
  now: number,
  { cause, limit = Infinity }: { cause?: string; limit?: number } = {},
): Failing => {
  if (!outage) {
    return {
      outage: { since: now, ...cause == null ? {} : { cause } },
      fresh: true,
    }
  }
  let fresh = cause != null && cause != outage.cause
  let rides = fresh ? { ...outage, cause } : outage
  let lasted = now - outage.since
  if (rides.told || lasted < limit) return { outage: rides, fresh }
  return { outage: { ...rides, told: true }, fresh, stayed: lasted }
}

/**
 * An answer at `now`: how long the outage it ends had lasted, where it met
 * one.
 *
 * ```ts
 * import { answered } from '@yaks/effects/outage'
 * import { equal } from '@yaks/testing'
 * equal(answered({ since: 1_000 }, 91_000), 90_000)
 * equal(answered(null, 91_000), undefined)
 * ```
 */
export let answered = (
  outage: Outage | null | undefined,
  now: number,
): number | undefined => outage ? now - outage.since : undefined
