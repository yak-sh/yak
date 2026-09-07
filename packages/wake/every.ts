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
// Cron is read in UTC unless its last word names an IANA zone, for example
// `0 9 * * 1-5 America/New_York`, or the caller supplies a default. The zone
// travels with `every`, without adding a fifth column to `wake`. Croner's
// calendar uses Intl, available in Deno and workerd without a build step.
// A stored schedule is read by a server, a Worker in another region, or a
// browser tab on a plane. A recurrence that answered a different instant per
// reader would not be one schedule.
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
 * import { assertEquals } from '@std/assert'
 * import { span } from './every.ts'
 *
 * assertEquals(span('30m'), 1800000)
 * assertEquals(span('every 2 hours'), 7200000)
 * assertEquals(span('0 9 * * 1-5'), null)
 * ```
 */
export let span = (every: string): number | null => {
  let m = every.trim().toLowerCase().replace(/\s+/g, ' ').match(DURATION)
  if (!m) return null
  let unit = MS[m[2]] ?? MS[WORDS[m[2]]]
  let n = m[1] == null ? 1 : +m[1]
  let ms = unit * n
  return ms > 0 && Number.isFinite(ms) ? ms : null
}

// Five calendar fields (or a nickname), optionally followed by a zone. Croner
// also accepts seconds, years and ISO instants; those are not `every` spellings.
// In particular, a sixth numeric field must never masquerade as a zone.
let cron = (every: string, tz: string): Cron | null => {
  let fields = every.trim().split(/\s+/)
  let count = fields[0].startsWith('@') ? 1 : 5
  if (fields.length === count + 1) tz = fields.pop()!
  if (fields.length !== count || !/[a-z]/i.test(tz)) return null
  if (count === 1 && !/^@[a-z]+$/i.test(fields[0])) return null
  try {
    return new Cron(fields.join(' '), { timezone: tz })
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
 * import { assertEquals } from '@std/assert'
 * import { after } from './every.ts'
 *
 * let t = Date.parse('2026-01-01T09:17:00Z')
 * // two hours on from 09:17, skipping the ticks a six-hour outage missed
 * assertEquals(after('2h', t, t + 6 * 3600_000), Date.parse('2026-01-01T17:17:00Z'))
 * assertEquals(after('@hourly', t, t), Date.parse('2026-01-01T10:00:00Z'))
 * ```
 *
 * Cron follows the named zone's calendar. At a spring DST gap, a missing
 * local time moves forward by the gap; a repeated fall time occurs once,
 * at its first occurrence. These are Croner's existing calendar semantics.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { after } from './every.ts'
 *
 * let t = Date.parse('2026-03-08T05:00:00Z')
 * assertEquals(
 *   after('30 2 * * * America/New_York', t, t),
 *   Date.parse('2026-03-08T07:30:00Z'), // 03:30, because 02:30 is missing
 * )
 * ```
 *
 * @param every the recurrence: a duration, a cron line, or a `@` shorthand
 * @param from the instant a duration counts from (a cron line ignores it)
 * @param now the moment to land past
 * @param tz the default zone for a cron line without a trailing zone (`UTC`)
 * @returns the instant, in epoch milliseconds, or `null` if `every` is
 * unreadable
 */
export let after = (
  every: string,
  from: number,
  now: number,
  tz = 'UTC',
): number | null => {
  if (!Number.isFinite(from) || !Number.isFinite(now)) return null
  let ms = span(every)
  if (ms != null) {
    let at = from + Math.max(Math.floor((now - from) / ms) + 1, 0) * ms
    return Number.isNaN(new Date(at).getTime()) ? null : at
  }
  try {
    return cron(every, tz)?.nextRun(new Date(now))?.getTime() ?? null
  } catch {
    return null
  }
}
