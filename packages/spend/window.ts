/**
 * Plan limits and the span of days a report covers: pure, for the page and
 * the report alike. A limit's pace is how much of its window is gone, which
 * is how much of it an even spend would have used by now.
 *
 * @module
 */
import type { Bundle, Eid } from '@yaks/graph'

/** A plan limit, as its `rate_limit` row reads, its provider named. */
export type Limit = {
  provider: string
  /** minutes: 10080 a week, 300 five hours */
  window: number
  /** percent used */
  used: number
  resets?: string
  at?: string
}

let WEEK = 7 * 864e5

let str = (v: unknown) => v == null ? '' : String(v)
let dayOf = (at: number) => new Date(at).toISOString().slice(0, 10)

/** The limits `rate_limit` rows hold, each provider's longest window first. */
export let limitsOf = (rows: Bundle[], names: Map<Eid, string>): Limit[] =>
  rows.flatMap((b): Limit[] => {
    let r = b.rate_limit as Record<string, unknown> | undefined
    if (!r) return []
    return [{
      provider: names.get(str(r.provider)) ?? str(r.provider),
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
 * let week = { provider: 'claude', window: 10080, used: 25, resets: '2026-10-27T11:00:00Z' }
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
 * let week = { provider: 'claude', window: 10080, used: 25, resets: '2026-10-27T11:00:00Z' }
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
