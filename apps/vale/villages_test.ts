// Village lookups name the same nearest fire and keep the radius's edge out.
import { assertEquals } from '@std/assert'
import { hearthNear, villagesNear } from './terrain.ts'

Deno.test('the nearest village fire agrees with the ordered villages', () => {
  for (let [x, z] of [[128, 128], [0, 0], [-400, 200], [1000, -800]]) {
    let nearest = villagesNear(x, z, Infinity)[0]
    let radius = Math.hypot(x - nearest.at[0], z - nearest.at[1])
    assertEquals(hearthNear(x, z), nearest.at)
    assertEquals(hearthNear(x, z, radius - 0.01), null)
    assertEquals(hearthNear(x, z, radius + 0.01), nearest.at)
    assertEquals(villagesNear(x, z, radius - 0.01), [])
  }
})
