import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { wanted } from './stream.ts'

test('chunk selection accepts a game’s chunk size and negative coordinates', () => {
  let chunks = wanted(32, -16, -16, 1, () => undefined)
  assertEquals(chunks, [{ ci: -1, ck: -1, lod: 0, d: 0 }])
  assertEquals(wanted(32, -16, -16, 1, () => undefined, 8), [])
})

test('detail and sight retain drawn chunks through their hysteresis margin', () => {
  // Chunk (2, 0) lies 43 m off, just past the first ring.
  let fresh = wanted(32, 21, 16, 110, () => undefined)
  let kept = wanted(32, 21, 16, 110, () => 0)
  assertEquals(fresh.find((c) => c.ci == 2 && c.ck == 0)?.lod, 1)
  assertEquals(kept.find((c) => c.ci == 2 && c.ck == 0)?.lod, 0)
  let old = wanted(32, 21, 16, 40, () => 0)
  assert(old.some((c) => c.d >= 40 && c.d < 46))
  assert(old.every((c) => c.d < 46))
  assert(fresh.every((c, i) => !i || fresh[i - 1].d <= c.d))
})
