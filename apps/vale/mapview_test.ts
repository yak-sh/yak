// Nearby and world map gestures share one world-coordinate viewport.
import { assertEquals } from '@std/assert'
import { LEVELS, SIZE } from './levels.ts'
import { pan, place, view, WORLD, zoom, ZOOMS } from './mapview.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

Deno.test('the map opens near the hero and zooms out around their position', () => {
  let near = view([100, 120])
  assertEquals(near[2], ZOOMS[0])
  assertEquals(place(near, [100, 120]), [0.5, 0.5])
  let whole = near
  for (let i = 1; i < ZOOMS.length; i++) whole = zoom(whole, 1)
  assertEquals(whole[2], WORLD[2])
  assertEquals(place(whole, [100, 120]), [0.5, 0.5])
  for (let lv of Object.values(LEVELS)) {
    let [x, z] = lv.cell.map((n) => n * SIZE)
    let [u, v] = place(WORLD, [x, z])
    assertEquals(u >= 0 && u + SIZE / WORLD[2] <= 1, true)
    assertEquals(v >= 0 && v + SIZE / WORLD[2] <= 1, true)
  }
})

Deno.test('panning and anchored zoom keep places aligned', () => {
  let near = view([100, 120])
  let moved = pan(near, 0.25, -0.25)
  assertEquals(place(moved, [100, 120]), [0.75, 0.25])
  let point: [number, number] = [0.3, 0.7]
  let world: [number, number] = [
    moved[0] + point[0] * moved[2],
    moved[1] + point[1] * moved[2],
  ]
  assertEquals(place(zoom(moved, 1, point), world), point)
})
