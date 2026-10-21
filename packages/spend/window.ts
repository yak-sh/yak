/**
 * Plan limits and the span of days a report covers: pure, for the page and
 * the report alike. A limit's pace is how much of its window is gone, which
 * is how much of it an even spend would have used by now.
 *
 * @module
 */
import type { Bundle, Eid } from '@yaks/graph'
import type { Spend } from './tally.ts'

/** A plan limit, as its `rate_limit` row reads, its provider named. */
export type Limit = {
  provider: string
  /** the provider's eid */
  of: Eid
  /** minutes: 10080 a week, 300 five hours */
  window: number
  /** percent used */
  used: number
  resets?: string
  at?: string
}

let WEEK = 7 * 864e5

let str = (v: unknown) => v == null ? '' : String(v)

/** The UTC day after `day`, and `n` days from it. */
export let after = (day: string, n = 1): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString()
    .slice(0, 10)

/** The UTC day a moment falls on. */
export let dayOf = (at: number | string): string =>
  new Date(at).toISOString().slice(0, 10)

/** The limits `rate_limit` rows hold, each provider's longest window first. */
export let limitsOf = (rows: Bundle[], names: Map<Eid, string>): Limit[] =>
  rows.flatMap((b): Limit[] => {
    let r = b.rate_limit as Record<string, unknown> | undefined
    if (!r) return []
    return [{
      provider: names.get(str(r.provider)) ?? str(r.provider),
      of: str(r.provider),
      window: Number(r.window),
      used: Number(r.used ?? 0),
      ...r.resets ? { resets: str(r.resets) } : {},
      ...r.at ? { at: str(r.at) } : {},
    }]
  }).sort((a, b) =>
    a.provider == b.provider
      ? b.window - a.window
      : a.provider < b.provider
      ? -1
      : 1
  )

// When a window that reset at `resets` resets next, from `now`.
let next = (resets: number, window: number, now: number) =>
  resets > now ? resets : resets + Math.ceil((now - resets) / window) * window

/**
 * How much of a limit's window is gone at `now`, 0 to 1: what an even spend
 * would have used by now.
 *
 * ```ts
 * import { paceOf } from './window.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'claude', of: 'c', window: 10080, used: 25,
 *   resets: '2026-10-27T11:00:00Z' }
 * equal(paceOf(week, Date.parse('2026-10-23T23:00:00Z')), 0.5)
 * ```
 */
export let paceOf = (l: Limit, now: number): number => {
  if (!l.resets) return 0
  let window = l.window * 60_000
  let left = next(Date.parse(l.resets), window, now) - now
  return Math.min(1, Math.max(0, 1 - left / window))
}

/** Whether a reading is of the window now running: one taken before the
 * window last reset says nothing of this one. */
export let current = (l: Limit, now: number): boolean =>
  !l.resets || Date.parse(l.resets) > now

/**
 * The days a report covers: from `since`, else the UTC day the Claude plan's
 * week began, else six days before; to `until`, else today.
 *
 * ```ts
 * import { span } from './window.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'claude', of: 'c', window: 10080, used: 25,
 *   resets: '2026-10-27T11:00:00Z' }
 * let now = Date.parse('2026-10-21T12:00:00Z')
 * equal(span([week], now), ['2026-10-20', '2026-10-21'])
 * equal(span([], now), ['2026-10-15', '2026-10-21'])
 * ```
 */
export let span = (
  limits: Limit[],
  now: number,
  since?: string,
  until?: string,
): [string, string] => {
  let to = until ?? dayOf(now)
  if (since) return [since, to]
  let week = limits.find((l) =>
    l.provider == 'claude' && l.window == 10080 && l.resets
  )
  let start = week
    ? next(Date.parse(week.resets!), WEEK, now) - WEEK
    : Date.parse(`${to}T00:00:00Z`) - 6 * 864e5
  return [dayOf(start), to]
}

/**
 * What a dollar of each plan is worth in its weekly limit: the percent of
 * the week its latest reading says is used, over the dollars its requests
 * ran up at list price from the day the week began to the day of the
 * reading, by the provider's eid. An estimate: the days are whole UTC days,
 * and the dollars are what the tokens would cost bought one by one. A plan
 * with no reading of this week, or no dollars in it, has none.
 *
 * ```ts
 * import { rates } from './window.ts'
 * import { empty } from './tally.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'claude', of: 'c', window: 10080, used: 30,
 *   resets: '2026-10-27T11:00:00Z', at: '2026-10-21T12:00:00Z' }
 * let day = (d: string, dollars: number) => ({ ...empty(d),
 *   plans: { c: { dollars, parts: {}, sessions: {}, tasks: {}, models: {}, entries: {} } } })
 * let days = [day('2026-10-19', 900), day('2026-10-20', 100), day('2026-10-21', 200)]
 * equal(rates([week], days, Date.parse('2026-10-21T13:00:00Z')).get('c'), 0.1)
 * ```
 */
export let rates = (
  limits: Limit[],
  days: Spend[],
  now: number,
): Map<Eid, number> =>
  new Map(limits.flatMap((l): [Eid, number][] => {
    let dollars = weekDays(l, days, now)?.reduce(
      (n, d) => n + (d.plans?.[l.of]?.dollars ?? 0),
      0,
    )
    return dollars ? [[l.of, l.used / dollars]] : []
  }))

// The days a plan's weekly reading counts, where it has a current one.
let weekDays = (l: Limit, days: Spend[], now: number): Spend[] | undefined => {
  if (l.window != 10080 || !l.resets || !current(l, now)) return
  let from = dayOf(Date.parse(l.resets) - WEEK)
  let to = l.at ? l.at.slice(0, 10) : dayOf(now)
  return days.filter((d) => d.day >= from && d.day <= to)
}

/**
 * The models a plan's weekly rate was built without a price for, by the
 * provider's eid: their requests are in the week's dollars as nothing, so the
 * rate reads too low. A plan whose week holds none has no entry.
 *
 * ```ts
 * import { unpricedRates } from './window.ts'
 * import { empty } from './tally.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { provider: 'codex', of: 'c', window: 10080, used: 30,
 *   resets: '2026-10-27T11:00:00Z', at: '2026-10-21T12:00:00Z' }
 * let plan = { dollars: 1, unpriced: ['m'], parts: {}, sessions: {}, tasks: {}, models: {}, entries: {} }
 * let days = [{ ...empty('2026-10-20'), plans: { c: plan } }]
 * equal(unpricedRates([week], days, Date.parse('2026-10-21T13:00:00Z')).get('c'), ['m'])
 * ```
 */
export let unpricedRates = (
  limits: Limit[],
  days: Spend[],
  now: number,
): Map<Eid, Eid[]> =>
  new Map(limits.flatMap((l): [Eid, Eid[]][] => {
    let models = [
      ...new Set(
        weekDays(l, days, now)?.flatMap((d) => d.plans?.[l.of]?.unpriced ?? []),
      ),
    ]
    return models.length ? [[l.of, models]] : []
  }))
