// A halo fades to transparency and can be made without a browser document.
import { assert, assertEquals } from '@std/assert'
import { halo } from './halo.ts'

Deno.test('one radial halo serves every light without a DOM', () => {
  let map = halo()
  let { data, width } = map.image
  assert(data)
  let alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3]
  assertEquals(halo(), map)
  assertEquals(alpha(0, 0), 0)
  assertEquals(alpha(31, 31) > alpha(20, 31), true)
  assertEquals(alpha(20, 31) > alpha(0, 31), true)
})
