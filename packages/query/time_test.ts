// The generic time-literal recognizer: it resolves the literal grammar against
// a fixed clock and declines a plain word. Interpreting whether a given field
// is time-typed (and so should be read through here) stays downstream.

import { assertEquals } from '@std/assert'
import { isTimeLiteral, timeInstant, timeSpan } from './mod.ts'

let at = (...a: number[]) =>
  new Date(a[0], a[1], a[2], a[3] ?? 0, a[4] ?? 0).getTime()

// A fixed clock so ranges are deterministic: 2026-09-02T12:00 local.
let NOW = +new Date(2026, 8, 2, 12, 0, 0)

Deno.test('today names a midnight-to-midnight range', () => {
  let s = timeSpan('today', NOW)!
  assertEquals(s.start, +new Date(2026, 8, 2))
  assertEquals(s.end, +new Date(2026, 8, 3))
})

Deno.test('relative and forward phrases', () => {
  assertEquals(timeSpan('1 hour ago', NOW)!.end, NOW)
  assertEquals(timeSpan('1 hour ago', NOW)!.start, NOW - 3_600_000)
  let fwd = timeSpan('in 5m', NOW)!
  assertEquals(fwd.forward, true)
  assertEquals(fwd.end, NOW + 5 * 60_000)
  // A forward phrase reads its end as the instant; a plain phrase its start.
  assertEquals(timeInstant('in 5m', NOW), NOW + 5 * 60_000)
  assertEquals(timeInstant('today', NOW), +new Date(2026, 8, 2))
})

Deno.test('an ISO stamp and a clock time', () => {
  assertEquals(timeSpan('2026-07-25', NOW)!.start, +new Date(2026, 6, 25))
  assertEquals(timeSpan('9am', NOW)!.start, +new Date(2026, 8, 2, 9, 0))
  assertEquals(timeSpan('noon', NOW)!.start, +new Date(2026, 8, 2, 12, 0))
})

Deno.test('a plain word is no time literal', () => {
  assertEquals(timeSpan('open', NOW), null)
  assertEquals(isTimeLiteral('open', NOW), false)
  assertEquals(isTimeLiteral('yesterday', NOW), true)
})

// ---- the phrase tables, one per family ----

// A fixed clock: Wed 2026-07-15 14:30 local. Spans come back in epoch ms.
let THEN = new Date(2026, 6, 15, 14, 30).getTime()

let spans: [string, number, number, boolean?][] = [
  ['today', at(2026, 6, 15), at(2026, 6, 16)],
  ['yesterday', at(2026, 6, 14), at(2026, 6, 15)],
  ['tomorrow', at(2026, 6, 16), at(2026, 6, 17)],
  ['now', THEN, THEN],
  ['2026-07-04', at(2026, 6, 4), at(2026, 6, 5)],
  ['this week', at(2026, 6, 13), at(2026, 6, 20)], // Monday start
  ['last week', at(2026, 6, 6), at(2026, 6, 13)],
  ['this month', at(2026, 6, 1), at(2026, 7, 1)],
  ['next month', at(2026, 7, 1), at(2026, 8, 1)],
  ['this year', at(2026, 0, 1), at(2027, 0, 1)],
  ['this hour', at(2026, 6, 15, 14), at(2026, 6, 15, 15)],
  ['5 minutes ago', THEN - 300_000, THEN],
  ['1 hour ago', THEN - 3_600_000, THEN],
  ['2 days ago', THEN - 2 * 86_400_000, THEN],
  ['1 month ago', at(2026, 5, 15, 14, 30), THEN],
  ['in 2 hours', THEN, THEN + 7_200_000, true],
  ['1-hour-ago', THEN - 3_600_000, THEN], // glue for quoteless boxes
  ['1_hour_ago', THEN - 3_600_000, THEN],
  // short units — what a hand types
  ['in 60m', THEN, THEN + 3_600_000, true],
  ['after 8h', THEN, THEN + 8 * 3_600_000, true],
  ['after 8 hours', THEN, THEN + 8 * 3_600_000, true],
  ['in 2d', THEN, THEN + 2 * 86_400_000, true],
  ['30 mins ago', THEN - 1_800_000, THEN],
  // clock times: an hour named alone spans its hour, a minute its minute
  ['9am', at(2026, 6, 15, 9), at(2026, 6, 15, 10)],
  ['8pm', at(2026, 6, 15, 20), at(2026, 6, 15, 21)],
  ['12am', at(2026, 6, 15, 0), at(2026, 6, 15, 1)],
  ['12pm', at(2026, 6, 15, 12), at(2026, 6, 15, 13)],
  ['9:30am', at(2026, 6, 15, 9, 30), at(2026, 6, 15, 9, 31)],
  ['14:00', at(2026, 6, 15, 14), at(2026, 6, 15, 14, 1)],
  ['noon', at(2026, 6, 15, 12), at(2026, 6, 15, 12, 1)],
  // …on today, unless a day word leads or trails
  ['9am tomorrow', at(2026, 6, 16, 9), at(2026, 6, 16, 10)],
  ['tomorrow 9am', at(2026, 6, 16, 9), at(2026, 6, 16, 10)],
  ['9am yesterday', at(2026, 6, 14, 9), at(2026, 6, 14, 10)],
  // an ISO stamp is that moment, its precision wide
  ['2026-07-25T09:00', at(2026, 6, 25, 9), at(2026, 6, 25, 9, 1)],
]
for (let [phrase, start, end, forward] of spans) {
  // Only a forward phrase carries the flag timeInstant() reads its end by.
  Deno.test(`span: ${phrase}`, () =>
    assertEquals(
      timeSpan(phrase, THEN),
      forward ? { start, end, forward } : { start, end },
    ))
}
Deno.test('span: a zoned stamp keeps its own zone', () =>
  assertEquals(timeSpan('2026-07-25T09:00:00.000Z', THEN), {
    start: Date.parse('2026-07-25T09:00:00.000Z'),
    end: Date.parse('2026-07-25T09:00:00.000Z') + 1000,
  }))
Deno.test('span: not phrases', () => {
  for (let s of ['Ops', 'open', '1..3', 'a,b', '', 'todayish', '25:00']) {
    assertEquals(timeSpan(s, THEN), null)
  }
})

// One moment, for the callers that schedule rather than filter (a wake):
// the range's start, except the forward phrases that begin at now.
let moments: [string, number][] = [
  ['in 60m', THEN + 3_600_000],
  ['after 8 hours', THEN + 8 * 3_600_000],
  ['in 2 days', THEN + 2 * 86_400_000],
  ['9am', at(2026, 6, 15, 9)],
  ['8pm', at(2026, 6, 15, 20)],
  ['9am tomorrow', at(2026, 6, 16, 9)],
  ['tomorrow', at(2026, 6, 16)],
  ['2026-07-25T09:00', at(2026, 6, 25, 9)],
  ['5 minutes ago', THEN - 300_000], // a past ask is past, not rolled
  ['now', THEN],
]
for (let [phrase, moment] of moments) {
  Deno.test(`instant: ${phrase}`, () =>
    assertEquals(timeInstant(phrase, THEN), moment))
}
Deno.test('instant: an ISO stamp resolves to itself', () => {
  let iso = new Date(at(2026, 6, 25, 9)).toISOString()
  assertEquals(timeInstant(iso, THEN), at(2026, 6, 25, 9))
})
Deno.test('instant: nonsense is null, never a guess', () =>
  assertEquals(timeInstant('whenever', THEN), null))
