// Claude's plan limits, as the CLI's stream reports them. Its own module
// (`@yaks/claude/limits`) so a reader of the stream's lines (@yaks/session)
// reads them as the model does, without loading the model.

import type { Limit } from '@yaks/model'

// Claude's plan windows a reading is kept of, in minutes.
let WINDOWS: Record<string, number> = { five_hour: 300, seven_day: 10080 }

type Info = Record<string, unknown>
let obj = (v: unknown): Info =>
  v && typeof v == 'object' && !Array.isArray(v) ? v as Info : {}
let count = (v: unknown): number | undefined => {
  if (v == null) return undefined
  let n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/**
 * The readings in a `rate_limit_event`'s `rate_limit_info`: each window's
 * fraction used and when it resets (`unifiedWindows`), whatever the status;
 * where an older CLI sends none, the one window the event is about, which
 * says how much is used only past a warning.
 *
 * ```ts
 * import { metered } from './limits.ts'
 * import { equal } from '@yaks/testing'
 *
 * let week = { utilization: 0.25, resetsAt: 1794913200 }
 * equal(metered({ status: 'allowed', unifiedWindows: { seven_day: week } }), [
 *   { provider: 'claude', window: 10080, used: 25, resets: '2026-11-17T11:00:00.000Z' },
 * ])
 * equal(metered({ rateLimitType: 'five_hour', utilization: 0.9 }), [
 *   { provider: 'claude', window: 300, used: 90 },
 * ])
 * equal(metered({ status: 'allowed', rateLimitType: 'five_hour' }), [])
 * ```
 */
export let metered = (info: Info): Limit[] => {
  let each = obj(info.unifiedWindows)
  let windows = Object.keys(each).length
    ? each
    : { [String(info.rateLimitType ?? '')]: info }
  return Object.entries(WINDOWS).flatMap(([name, window]) => {
    let w = obj(windows[name])
    return count(w.utilization) == null ? [] : [{
      provider: 'claude',
      window,
      used: Math.round(Number(w.utilization) * 100),
      ...count(w.resetsAt) == null
        ? {}
        : { resets: new Date(Number(w.resetsAt) * 1000).toISOString() },
    }]
  })
}
