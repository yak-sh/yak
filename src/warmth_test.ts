// hot: the decay rank behind `.order=hot`; sunk/warm: the retirement damper.
import { assert, assertEquals } from '@std/assert'
import { hot, SUNK, sunk, warm } from './warmth.ts'

let T0 = Date.parse('2026-07-20T12:00:00Z')
let H = 3_600_000
let D = 24 * H
let ago = (ms: number) => new Date(T0 - ms).toISOString()
let recalled = (count: number, firstAgo: number, lastAgo: number) =>
  hot({ recall: { count, first_at: ago(firstAgo), last_at: ago(lastAgo) } }, T0)

Deno.test('hot: hours top of mind, days recallable, months rings a bell', () => {
  assert(recalled(1, 2 * H, 2 * H) > 0.9) // just touched
  assert(recalled(1, 5 * D, 5 * D) < 0.05) // one touch, days ago: faded
  assert(recalled(20, 200 * D, 7 * D) > 0.6) // a habit stays warm across weeks
})

Deno.test('hot: recalled often decays slower than recalled once', () => {
  assert(recalled(10, 30 * D, 5 * D) > recalled(1, 5 * D, 5 * D))
})

Deno.test('hot: spaced recalls outlast crammed ones at equal count', () => {
  assert(recalled(10, 90 * D, 10 * D) > recalled(10, 10 * D + H, 10 * D))
})

Deno.test('hot: no recalls yet — the last touch counts as a single touch', () => {
  assert(hot({ created: { at: ago(H) } }, T0) > 0.9)
  assert(hot({ created: { at: ago(10 * D) } }, T0) < 0.01)
  assertEquals(hot({}, T0), 0)
})

// ---- retirement: the damper that sinks a dead venture ----

Deno.test('sunk: own stamp, or the project the task is filed under', () => {
  let P = 'p-eid'
  let look = (eid: string) =>
    eid == P ? { project: {}, archived: { at: '2026-01-01' } } : undefined
  assertEquals(sunk({ project: {}, archived: { at: 'x' } }), true)
  assertEquals(sunk({ project: {} }), false)
  assertEquals(sunk({ archived: { at: 'x' } }), false)
  assertEquals(sunk({ task: {}, filed: { project: P } }, look), true)
  assertEquals(sunk({ task: {}, filed: { project: 'live' } }, look), false)
  assertEquals(sunk({ task: {} }, look), false)
})

Deno.test('warm: retirement damps the rank, never zeroes it', () => {
  let c = { created: { at: ago(H) }, project: {}, archived: { at: 'x' } }
  assert(warm(c, T0) > 0) // sunk, not erased
  assertEquals(warm(c, T0), hot(c, T0) * SUNK)
  // fresh-but-retired sinks beneath merely-idle live work
  assert(warm(c, T0) < hot({ created: { at: ago(2 * D) } }, T0))
})
