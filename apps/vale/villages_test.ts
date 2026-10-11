// Village lookups name the same nearest fire and keep the radius's edge out.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { hearthNear, villagesNear } from './terrain.ts'

let villages = villagesNear(0, 0, Infinity)
let boxes = [[128, 128], [0, 0], [-256, 256], [256, 0]].flatMap(([x, z]) =>
  [0, -1, NaN, 0.1, 16, 41.4, 128, 256, Infinity].map((r) => {
    let distance = ({ at }: typeof villages[number]) =>
      (x - at[0]) ** 2 + (z - at[1]) ** 2
    let expected = villages.filter((v) => distance(v) < (r > 0 ? r * r : 0))
      .sort((a, b) => distance(a) - distance(b))
    return { x, z, r, expected }
  })
)

test('bounded village lookups keep exact distances across cells and radii', () => {
  for (let { x, z, r, expected } of boxes) {
    assertEquals(villagesNear(x, z, r), expected)
    assertEquals(hearthNear(x, z, r), expected[0]?.at ?? null)
  }
})

test('the nearest village fire agrees with the ordered villages', () => {
  for (let [x, z] of [[128, 128], [0, 0], [-400, 200], [1000, -800]]) {
    let nearest = villagesNear(x, z, Infinity)[0]
    let radius = Math.hypot(x - nearest.at[0], z - nearest.at[1])
    assertEquals(hearthNear(x, z), nearest.at)
    assertEquals(hearthNear(x, z, radius - 0.01), null)
    assertEquals(hearthNear(x, z, radius + 0.01), nearest.at)
    assertEquals(villagesNear(x, z, radius - 0.01), [])
  }
})
