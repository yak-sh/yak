// Nearby and world map gestures share one world-coordinate viewport.
import { assertAlmostEquals, assertEquals } from '@std/assert'
import { LEVELS, SIZE } from './levels.ts'
import {
  NEAR,
  pan,
  pinch,
  place,
  reopen,
  view,
  WORLD,
  zoom,
} from './mapview.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

Deno.test('the map opens near the hero and zooms out around their position', () => {
  let near = view([100, 120])
  assertEquals(near[2], NEAR)
  assertEquals(place(near, [100, 120]), [0.5, 0.5])
  let whole = near
  for (let i = 0; i < 40; i++) whole = zoom(whole, 1.2)
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
  let changed = zoom(moved, 1.13, point)
  assertAlmostEquals(changed[2], moved[2] * 1.13)
  let [u, v] = place(changed, world)
  assertAlmostEquals(u, point[0])
  assertAlmostEquals(v, point[1])
  assertEquals(zoom(changed, 100)[2], WORLD[2])
  assertEquals(zoom(changed, 0.001)[2], NEAR)
})

Deno.test('pinch keeps ground beneath the moving midpoint', () => {
  let box = zoom(view([100, 120]), 2)
  let from: [number, number] = [0.3, 0.4]
  let to: [number, number] = [0.5, 0.6]
  let ground: [number, number] = [
    box[0] + from[0] * box[2],
    box[1] + from[1] * box[2],
  ]
  let next = pinch(box, from, to, 0.75)
  assertEquals(next[2], 480)
  let [u, v] = place(next, ground)
  assertAlmostEquals(u, to[0])
  assertAlmostEquals(v, to[1])
})

Deno.test('reopening nearby reuses the chart until the hero leaves its middle', () => {
  let first = reopen([100, 120], null)
  assertEquals(place(first, [100, 120]), [0.5, 0.5])
  assertEquals(reopen([101, 120], first), first)
  assertEquals(reopen([180, 120], first), first)
  let moved = reopen([181, 120], first)
  assertEquals(place(moved, [181, 120]), [0.5, 0.5])
})
