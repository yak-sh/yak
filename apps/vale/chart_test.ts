import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { chart } from './chart.ts'
import { flat, vale } from './terrain.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

test('a chart grows each chunk once even when larger than the terrain cache', () => {
  let v = vale(16), old = { grow: v.grow, plant: v.plant, patches: v.patches }
  let ground = flat(16, [], [], 16), visits = new Map<string, number>()
  v.patches = new Map()
  v.plant = () => []
  v.grow = (ci, ck) => {
    let key = `${ci},${ck}`
    visits.set(key, (visits.get(key) ?? 0) + 1)
    return ground.grow(ci, ck)
  }
  try {
    let px = chart(0, 0, 240, 16)
    assertEquals(px.length, 15 * 15 * 4)
    assertEquals([...visits.values()].every((n) => n == 1), true)
  } finally {
    Object.assign(v, old)
  }
})
