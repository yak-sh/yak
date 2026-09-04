// The generic time-literal recognizer: it resolves the literal grammar against
// a fixed clock and declines a plain word. Interpreting whether a given field
// is time-typed (and so should be read through here) stays downstream.

import { assertEquals } from '@std/assert'
import { isTimeLiteral, timeInstant, timeSpan } from './mod.ts'

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
