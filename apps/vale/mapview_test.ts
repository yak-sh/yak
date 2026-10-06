// Nearby and world map gestures share one world-coordinate viewport.
import { test } from '@yaks/testing'
import { assertAlmostEquals, assertEquals } from '@std/assert'
import { LEVELS, SIZE } from './levels.ts'
import {
  cover,
  NEAR,
  pan,
  pinch,
  place,
  reopen,
  under,
  view,
  WORLD,
  zoom,
} from './mapview.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

test('the map opens near the hero and zooms out around their position', () => {
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

test('panning and anchored zoom keep places aligned', () => {
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

test('pinch keeps ground beneath the moving midpoint', () => {
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

test('reopening nearby reuses the chart until the hero leaves its middle', () => {
  let first = reopen([100, 120], null)
  assertEquals(place(first, [100, 120]), [0.5, 0.5])
  assertEquals(reopen([101, 120], first), first)
  assertEquals(reopen([180, 120], first), first)
  let moved = reopen([181, 120], first)
  assertEquals(place(moved, [181, 120]), [0.5, 0.5])
})

test('a panel of any shape shows the view whole and the ground beyond it', () => {
  let box = view([100, 120])
  for (let [wide, tall] of [[600, 400], [390, 560], [500, 500]]) {
    // The ground under the panel's corners, by the pointer's reckoning.
    let ground = (x: number, y: number): [number, number] => {
      let [u, v] = under([x, y], wide, tall)
      return [box[0] + u * box[2], box[1] + v * box[2]]
    }
    let [x0, z0] = ground(0, 0), [x1, z1] = ground(wide, tall)
    assertAlmostEquals((x1 - x0) / wide, (z1 - z0) / tall)
    assertAlmostEquals(Math.min(x1 - x0, z1 - z0), box[2])
    assertEquals(place(box, ground(wide / 2, tall / 2)), [0.5, 0.5])
    // The square drawn over the panel spans its longer side, about the same
    // middle.
    let [cx, cz, side] = cover(box, wide, tall)
    assertAlmostEquals(side, Math.max(x1 - x0, z1 - z0))
    assertAlmostEquals(cx + side / 2, (x0 + x1) / 2)
    assertAlmostEquals(cz + side / 2, (z0 + z1) / 2)
  }
})
