// The expression and wake entry points read the same calendar, so callers can
// seed a schedule from an expression and later advance its stored wake.

import { assertEquals } from '@std/assert'
import { next } from './due.ts'

let T = Date.parse('2026-01-01T09:17:00Z')

Deno.test('next reads expressions and preserves the wake entry point', () => {
  let expected = '2026-01-01T14:00:00.000Z'
  assertEquals(next('0 9 * * *', T, 'America/New_York'), expected)
  assertEquals(next('0 9 * * * America/New_York', T), expected)
  assertEquals(
    next(
      { at: '2026-01-01T09:17:00Z', every: '0 9 * * * America/New_York' },
      T,
    ),
    expected,
  )
  assertEquals(next('2h', T), '2026-01-01T11:17:00.000Z')
  assertEquals(next('unreadable', T), null)
  assertEquals(next({ at: '2026-01-01T09:17:00Z' }, T), null)
})

Deno.test('next keeps the cron zone through a DST transition', () => {
  assertEquals(
    next('0 9 * * * America/New_York', Date.parse('2026-03-07T14:00:00Z')),
    '2026-03-08T13:00:00.000Z',
  )
})
