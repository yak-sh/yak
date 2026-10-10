import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { actionable } from './fault.ts'

test('a transient is not worth a task', () => {
  for (
    let m of [
      'fetch timed out',
      'resource temporarily unavailable',
      'ECONNRESET',
      'responses: HTTP 503',
      'responses: transport failed',
    ]
  ) assertEquals(actionable(m), false, m)
  assertEquals(actionable('no such table: bug'), true)
})
