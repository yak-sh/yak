// next() — the recurrence half of the time vocabulary (T-18724). Pure seam:
// interval phrases ride the epoch grid, cron resolves local, junk is null.
import { assertEquals } from '@std/assert'
import { next } from './time.ts'

// A local wall-clock moment, so cron assertions hold in any zone.
let at = (
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
  ms = 0,
) => +new Date(y, mo - 1, d, h, mi, s, ms)

Deno.test('every: epoch grid, at-or-after', () => {
  let q = 15 * 60_000
  assertEquals(next('every 15m', 7 * q), 7 * q) // on the grid = now
  assertEquals(next('every 15m', 7 * q + 1), 8 * q) // past it = the next line
  assertEquals(next('every 1h', 3_600_000 + 5), 7_200_000)
  assertEquals(next('every hour', 1), 3_600_000) // bare unit = 1
  assertEquals(next('EVERY  2H', 0), 0) // case and spacing are forgiven
  assertEquals(next('every 90m', 0), 0)
  assertEquals(next('every 90m', 1), 90 * 60_000)
})

Deno.test('every: fixed units only, positive only', () => {
  assertEquals(next('every 1mo', 0), null) // calendar cadence is cron's
  assertEquals(next('every 1y', 0), null)
  assertEquals(next('every 0m', 0), null)
  assertEquals(next('every 5 parsecs', 0), null)
})

Deno.test('cron: daily hour, today or tomorrow by the minute', () => {
  let nine = at(2026, 3, 10, 9, 0)
  assertEquals(next('0 9 * * *', at(2026, 3, 10, 8, 59)), nine)
  assertEquals(next('0 9 * * *', nine), nine) // exact boundary matches
  // A second past the boundary has missed it: tomorrow.
  assertEquals(
    next('0 9 * * *', at(2026, 3, 10, 9, 0, 0, 1)),
    at(2026, 3, 11, 9, 0),
  )
})

Deno.test('cron: lists, ranges, steps', () => {
  assertEquals(
    next('0,30 * * * *', at(2026, 1, 1, 5, 1)),
    at(2026, 1, 1, 5, 30),
  )
  assertEquals(
    next('*/20 * * * *', at(2026, 1, 1, 5, 21)),
    at(2026, 1, 1, 5, 40),
  )
  assertEquals(
    next('0 9-17 * * *', at(2026, 1, 1, 18, 0)),
    at(2026, 1, 2, 9, 0),
  )
  assertEquals(
    next('0 9-17/4 * * *', at(2026, 1, 1, 10, 0)),
    at(2026, 1, 1, 13, 0),
  )
})

Deno.test('cron: month ends and month fields', () => {
  // Jan 31 exists; the next 31st after Feb is March.
  assertEquals(next('0 0 31 * *', at(2026, 1, 31, 0, 0)), at(2026, 1, 31, 0, 0))
  assertEquals(next('0 0 31 * *', at(2026, 2, 1)), at(2026, 3, 31, 0, 0))
  // A named month waits for it.
  assertEquals(next('0 12 1 6 *', at(2026, 2, 1)), at(2026, 6, 1, 12, 0))
  // Leap day: from 2026 the next Feb 29 is 2028.
  assertEquals(next('0 0 29 2 *', at(2026, 3, 1)), at(2028, 2, 29, 0, 0))
})

Deno.test('cron: dow, 7 as Sunday, and the dom/dow OR rule', () => {
  // 2026-03-10 is a Tuesday (dow 2).
  assertEquals(next('0 9 * * 2', at(2026, 3, 9, 12, 0)), at(2026, 3, 10, 9, 0))
  assertEquals(next('0 9 * * 0', at(2026, 3, 10, 0, 0)), at(2026, 3, 15, 9, 0))
  assertEquals(next('0 9 * * 7', at(2026, 3, 10, 0, 0)), at(2026, 3, 15, 9, 0))
  // Both restricted: EITHER the 12th (Thursday) or Tuesday matches — Tuesday
  // the 10th comes first.
  assertEquals(next('0 9 12 * 2', at(2026, 3, 9, 12, 0)), at(2026, 3, 10, 9, 0))
})

Deno.test('cron: never-matching and malformed are null, not a hang', () => {
  assertEquals(next('0 9 30 2 *', 0), null) // Feb 30 never comes
  assertEquals(next('61 * * * *', 0), null)
  assertEquals(next('* * * *', 0), null) // 4 fields is not cron
  assertEquals(next('0 9 * * mon', 0), null) // names are not in the subset
  assertEquals(next('tomorrow', 0), null) // one-shot phrases are instant()'s
  assertEquals(next('', 0), null)
})
