// How a wake recurs, read from one string. Two grammars, because people mean
// two different things by "again":
//
//   A DURATION — "every two hours", `2h`, `30m`, `1w`. It counts FROM the last
//   instant, so a wake set at 09:17 keeps landing at :17. Nobody who says
//   "remind me every two hours" means "on the even hours".
//
//   A CRON LINE — `0 9 * * 1-5`, `@daily`. It names positions on a calendar,
//   so it lands at nine whatever time you wrote it. Parsed by croner, which is
//   dependency-free and runs unchanged in a browser, a Worker and a server —
//   the one thing here worth not hand-rolling, since a cron parser is all
//   edges (step ranges, day-of-week vs day-of-month, month names).
//
// Cron is read in UTC unless the caller names a zone. A schedule stored in a
// graph is read back by whoever is running — a server, a Worker in another
// region, a browser tab on a plane — and a recurrence that answered a
// different instant per reader would not be one schedule.
//
// A recurrence that cannot be read is `null`, never a throw and never a
// guess: a wake with an unreadable `every` still fires once, on its `at`, and
// then stops. Loud beats silent, and stopped beats a storm.

import { Cron } from 'croner'

// Milliseconds per unit the duration grammar knows. Nothing longer than a
// week: a month and a year are calendar positions, not durations, and that is
// what the cron half is for (`@monthly`).
let MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

// The spelled-out units, folded onto the same letters.
let WORDS: Record<string, string> = {
  sec: 's',
  secs: 's',
  second: 's',
  seconds: 's',
  min: 'm',
  mins: 'm',
  minute: 'm',
  minutes: 'm',
  hr: 'h',
  hrs: 'h',
  hour: 'h',
  hours: 'h',
  day: 'd',
  days: 'd',
  week: 'w',
  weeks: 'w',
}

// `2h`, `every 2 hours`, `hourly`-free: a count and a unit, or a bare unit
// meaning one of them.
let DURATION = /^(?:every\s+)?(\d+)?\s*([a-z]+)$/

/**
 * A recurrence read as a fixed length of time, in milliseconds — `null` when
 * it is a cron line, or nothing this grammar knows.
 *
 * ```ts
 * span('30m') // 1800000
 * span('every 2 hours') // 7200000
 * span('0 9 * * 1-5') // null
 * ```
 */
export let span = (every: string): number | null => {
  let m = every.trim().toLowerCase().replace(/\s+/g, ' ').match(DURATION)
  if (!m) return null
  let unit = MS[m[2]] ?? MS[WORDS[m[2]]]
  let n = m[1] == null ? 1 : +m[1]
  return unit && n > 0 ? unit * n : null
}

// A cron line, compiled — `null` when croner refuses it, which is how an
// unreadable recurrence stays unreadable instead of becoming an exception in
// somebody's alarm loop.
let cron = (every: string, tz: string): Cron | null => {
  try {
    return new Cron(every.trim(), { timezone: tz })
  } catch {
    return null
  }
}

/**
 * The first instant a recurrence lands on strictly after `now`, counting a
 * duration from `from`.
 *
 * The two moments are different clocks on purpose. A CRON line ignores `from`
 * — nine in the morning is nine in the morning. A DURATION counts from
 * `from`, the last instant the wake was due, so a cadence keeps its phase and
 * a long outage catches up in ONE step instead of firing once per missed tick.
 *
 * ```ts
 * let t = Date.parse('2026-01-01T09:17:00Z')
 * // two hours on from 09:17, skipping the ticks a six-hour outage missed
 * after('2h', t, t + 6 * 3600_000) // 2026-01-01T17:17:00Z
 * ```
 *
 * @param every the recurrence: a duration, a cron line, or a `@` shorthand
 * @param from the instant a duration counts from (a cron line ignores it)
 * @param now the moment to land past
 * @param tz the zone a cron line is read in (default `UTC`)
 * @returns the instant, in epoch milliseconds, or `null` if `every` is
 * unreadable
 */
export let after = (
  every: string,
  from: number,
  now: number,
  tz = 'UTC',
): number | null => {
  let ms = span(every)
  if (ms != null) {
    return from + Math.max(Math.floor((now - from) / ms) + 1, 0) * ms
  }
  return cron(every, tz)?.nextRun(new Date(now))?.getTime() ?? null
}
