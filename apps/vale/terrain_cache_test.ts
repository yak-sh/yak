// A grown chunk may replace a column already read from procedural ground.
import { assertEquals } from '@std/assert'
import { adopt, flat, floorUnder } from './terrain.ts'

Deno.test('an adopted patch changes a previously read floor', () => {
  let v = flat(5, [], [], 1)
  assertEquals(floorUnder(v, 2, 10, 2), 5)
  let patch = v.grow(0, 0)
  patch.layers[0][3 + 3 * patch.n] = 9
  adopt(v, patch)
  assertEquals(floorUnder(v, 2, 10, 2), 9)
})
