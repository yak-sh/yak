// A route cannot end above every supporting floor near its destination.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import type { Vec } from './mesh.ts'
import { adopt, flat, type Vale } from './terrain.ts'
import { fits } from './sim.ts'
import { walk } from './walk.ts'

let prepared = (v: Vale) => {
  adopt(v, v.grow(0, 0))
  return v
}
let floating = prepared(flat(5))
let queries = 0
let buildings = floating.buildings
floating.buildings = (...args) => {
  queries++
  return buildings(...args)
}
let low = prepared(flat(5)), high = prepared(flat(6))
let stepped = prepared(flat((x) => x >= 10.5 ? 5.5 : 5))
let blocked = prepared(flat(5, [{ x: 10, z: 10, r: 4, top: 5.9 }]))
let cave = flat(8), patch = cave.grow(0, 0)
patch.layers.push(
  new Int16Array(patch.layers[0].length).fill(7 / cave.voxel),
  new Int16Array(patch.layers[0].length).fill(5 / cave.voxel),
)
adopt(cave, patch)

test('a floating destination is refused without searching the whole ground', () => {
  let from: Vec = [10, 5, 10]
  for (let height of [5.5, 7]) {
    assertEquals(walk(floating, from, [11, height, 10]), [from])
  }
  assert(queries < 100)
})

test('the starting point can already satisfy a goal above its ground', () => {
  let from: Vec = [10, 6, 10], to: Vec = [10.25, 6.3, 10]
  assertEquals(walk(low, from, to), [from, to])
})

test('floors inside either edge of the goal height interval remain reachable', () => {
  for (let [v, y, goal] of [[low, 5, 5.499], [high, 6, 5.501]] as const) {
    let to: Vec = [11, goal, 10]
    assertEquals(walk(v, [10, y, 10], to).at(-1), to)
  }
})

test('a route can climb a step and end below a cave roof', () => {
  for (let [v, height] of [[stepped, 5.5], [cave, 5]] as const) {
    let to: Vec = [11, height, 10]
    let path = walk(v, [10, 5, 10], to)
    assertEquals(path.at(-1), to)
    assert(path.every(([x, y, z]) => fits(v, x, z, y)))
  }
})

test('higher support near the goal still needs a passable route', () => {
  let from: Vec = [10, 5, 10]
  assertEquals(walk(blocked, from, [11, 5, 10]), [from])
})
