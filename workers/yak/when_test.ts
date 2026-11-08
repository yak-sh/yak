// When a message was sent, in a few quiet words (public/when.js).

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { pretty, when } from './public/when.js'

let now = Date.parse('2026-11-05T12:00:00Z')
let ago = (ms: number) => when(new Date(now - ms).toISOString(), now)

test('a message under a day old says how long ago, an older one its day', () => {
  assertEquals(
    [ago(20_000), ago(60_000), ago(59 * 60_000), ago(3 * 3600_000)],
    ['just now', '1m ago', '59m ago', '3h ago'],
  )
  assertEquals(ago(24 * 3600_000), '4 Nov')
  assertEquals(when('2025-12-31T12:00:00Z', now), '31 Dec 2025')
  assertEquals(when('soon', now), '')
})

test('a message says when it was sent in full, for its tooltip', () => {
  assertEquals(pretty('soon'), '')
  assertEquals(pretty('2026-11-05T12:00:00Z').includes('5 November 2026'), true)
})
