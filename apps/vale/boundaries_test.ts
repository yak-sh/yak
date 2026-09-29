// Region borders shape the land without closing the roads between villages.
import { assert, assertEquals } from '@std/assert'
import { blend, borderOf } from './regions.ts'
import { CHUNK, rise, vale, WATER } from './terrain.ts'
import { roadsOf } from './ways.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

let crossing = (from: string, to: string) => {
  let pair = [from, to].sort().join('/')
  let road = roadsOf(from).find((r) => [r.from, r.to].sort().join('/') == pair)!
  let at = Array.from(road.c.xs.keys()).find((i) => {
    let b = blend(road.c.xs[i], road.c.zs[i])
    return b.t < 0.505 && [b.a, b.b].sort().join('/') == pair
  })!
  return { road, at, x: road.c.xs[at], z: road.c.zs[at] }
}

Deno.test('a ridge has a road pass and a river has a dry ford', () => {
  let ridge = crossing('mossvale', 'reedmarsh')
  let river = crossing('clovermead', 'fernwood')
  assertEquals(borderOf(blend(ridge.x, ridge.z)).kind, 'ridge')
  assertEquals(borderOf(blend(river.x, river.z)).kind, 'river')
  for (let { road, at } of [ridge, river]) {
    let heights = Array.from(
      { length: 13 },
      (_, j) => rise(road.c.xs[at + j - 6], road.c.zs[at + j - 6]),
    )
    assert(
      heights.slice(1).every((h, i) => Math.abs(h - heights[i]) < 0.5),
      `${road.from} to ${road.to} stays walkable`,
    )
  }
  let { road, at, x, z } = ridge
  let dx = road.c.xs[at + 1] - x, dz = road.c.zs[at + 1] - z
  let length = Math.hypot(dx, dz)
  assert(rise(x - dz / length * 10, z + dx / length * 10) > rise(x, z) + 4)
  let ford = rise(river.x, river.z)
  assert(ford > WATER)
  let nx = river.road.c.zs[river.at + 1] - river.z
  let nz = river.road.c.xs[river.at + 1] - river.x
  let span = Math.hypot(nx, nz)
  assert(
    Math.min(
      rise(river.x - nx / span * 5, river.z + nz / span * 5),
      rise(river.x + nx / span * 5, river.z - nz / span * 5),
    ) < WATER,
  )
})

Deno.test('a boundary chunk agrees with the next chunk at the seam', () => {
  let { x, z } = crossing('mossvale', 'reedmarsh')
  let ci = Math.floor(x / CHUNK), ck = Math.floor(z / CHUNK)
  let v = vale(0.5), left = v.grow(ci, ck), right = v.grow(ci + 1, ck)
  for (let k = 0; k < left.n; k++) {
    assertEquals(
      left.layers[0][left.n - 2 + k * left.n],
      right.layers[0][k * right.n],
    )
  }
})
