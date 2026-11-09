// When a message was sent, in a few quiet words (public/when.js).

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { pretty, when } from './when.ts'

let now = Date.parse('2026-11-05T12:00:00Z')
let ago = (ms: number) => when(new Date(now - ms).toISOString(), now)

test('messages keep saying how long ago after a day and a year', () => {
  assertEquals(
    [ago(20_000), ago(60_000), ago(59 * 60_000), ago(3 * 3600_000)],
    ['just now', '1 minute ago', '59 minutes ago', '3 hours ago'],
  )
  assertEquals(ago(24 * 3600_000), '1 day ago')
  assertEquals(when('2025-12-31T12:00:00Z', now), '10 months ago')
  assertEquals(when('soon', now), '')
})

test('a message says when it was sent in full, for its tooltip', () => {
  assertEquals(pretty('soon'), '')
  assertEquals(pretty('2026-11-05T12:00:00Z').includes('Nov 5th, 2026'), true)
})
