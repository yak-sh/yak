// The vector arithmetic: a round trip through bytes, and what cosine says about
// same, unrelated, opposed, and a space that moved.

import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import { cosine, pack, unit, unpack } from './vector.ts'

let v = (...xs: number[]) => new Float32Array(xs)

Deno.test('a vector survives the round trip through its bytes', () => {
  let out = unpack(pack(v(1, -0.5, 0.25)))
  assertEquals([...out], [1, -0.5, 0.25])
})

Deno.test('unpacking copies, so an unaligned blob is still readable', () => {
  let bytes = new Uint8Array(pack(v(1, 2)).byteLength + 1)
  bytes.set(pack(v(1, 2)), 0)
  assertEquals([...unpack(bytes.subarray(0, 8))], [1, 2])
})

Deno.test('unit leaves a direction and gives it length 1', () => {
  let u = unit(v(3, 4))
  assertAlmostEquals(Math.hypot(u[0], u[1]), 1)
  assertAlmostEquals(cosine(u, v(3, 4)), 1)
  // a zero vector has no direction to keep
  assertEquals([...unit(v(0, 0))], [0, 0])
})

Deno.test('cosine reads same, unrelated, opposed', () => {
  assertAlmostEquals(cosine(v(1, 0), v(2, 0)), 1)
  assertEquals(cosine(v(1, 0), v(0, 1)), 0)
  assertAlmostEquals(cosine(v(1, 0), v(-1, 0)), -1)
  assertEquals(cosine(v(0, 0), v(1, 1)), 0)
})

Deno.test('a vector from another space scores 0, never almost-right', () => {
  assert(cosine(v(1, 0, 0), v(1, 0)) == 0)
})
