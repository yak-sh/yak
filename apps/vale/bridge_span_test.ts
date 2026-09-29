// A bridge uses the terrain layers for both the walkable deck and the river
// below it; its meshed sides stay open to the water.
import { seedBuildings } from './buildings_fixture.ts'
import { assert, assertEquals } from '@std/assert'
import * as THREE from 'three'
import { chunk } from './chunks.ts'
import { groundChunk } from './ground.ts'
import { fights, out } from './mesh.ts'
import { boundaryAt } from './regions.ts'
import { fits } from './sim.ts'
import {
  adopt,
  chunkOf,
  floorUnder,
  groundAt,
  rise,
  roofOver,
  vale,
  VOXELS,
  WATER,
} from './terrain.ts'
import { roadsOf } from './ways.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

let crossing = () => {
  let road = roadsOf('clovermead').find((r) =>
    [r.from, r.to].sort().join('/') == 'clovermead/fernwood'
  )!
  let i = Array.from(road.c.xs.keys()).find((j) =>
    boundaryAt(road.c.xs[j], road.c.zs[j]).river > 0.98
  )!
  return { road, i, x: road.c.xs[i], z: road.c.zs[i] }
}

seedBuildings()

Deno.test('a bridge has a dry deck over the river in cold and grown ground', () => {
  let { road, i, x, z } = crossing()
  let v = vale(0.5)
  let read = () => [
    groundAt(v, x, z),
    floorUnder(v, x, 8, z),
    floorUnder(v, x, WATER, z),
    roofOver(v, x, WATER, z),
  ]
  let before = read()
  assert(before[0] > WATER + 1)
  assertEquals(before[0], before[1])
  assert(before[2] < WATER)
  assert(before[3] > WATER && before[3] < before[0])
  assert(fits(v, x, z, before[0]))
  let dx = road.c.xs[i + 1] - road.c.xs[i - 1]
  let dz = road.c.zs[i + 1] - road.c.zs[i - 1]
  let len = Math.hypot(dx, dz)
  let bank: [number, number] = [x + dz / len * 5.5, z - dx / len * 5.5]
  let bankBefore = groundAt(v, ...bank)
  for (let side of [-1, 1]) {
    assert(rise(x - side * dz / len * 4, z + side * dx / len * 4) < WATER)
  }
  adopt(v, v.grow(chunkOf(x), chunkOf(z)))
  assertEquals(read(), before)
  assertEquals(groundAt(v, ...bank), bankBefore)
})

Deno.test('a bridge retains water clearance at every terrain detail', () => {
  let { x, z } = crossing()
  for (let voxel of VOXELS) {
    let v = vale(voxel)
    let read = () => [
      floorUnder(v, x, 8, z),
      floorUnder(v, x, WATER, z),
      roofOver(v, x, WATER, z),
    ]
    let before = read()
    assert(before[0] > WATER)
    assert(before[1] < WATER)
    assert(before[2] > WATER && before[2] < before[0])
    adopt(v, v.grow(chunkOf(x), chunkOf(z)))
    assertEquals(read(), before)
  }
})

Deno.test('a bridge span meshes with an open side and matching chunk seams', () => {
  let { road, i, x, z } = crossing()
  let ci = chunkOf(x), ck = chunkOf(z)
  let dx = road.c.xs[i + 1] - road.c.xs[i - 1]
  let dz = road.c.zs[i + 1] - road.c.zs[i - 1]
  let len = Math.hypot(dx, dz)
  for (let voxel of [0.5, 2]) {
    let v = vale(voxel)
    let c = chunk(v, ci, ck, false)
    let p = c.patch, N = p.n
    let j = Math.floor(x / p.voxel) - ci * (N - 2) + 1 +
      (Math.floor(z / p.voxel) - ck * (N - 2) + 1) * N
    assert((p.span?.[j] ?? 0) > 0)
    assertEquals(c.roof, null)
    assertEquals(fights(c.solid), [])

    let ground = groundChunk(p, out(), out())
    let geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(ground.pos, 3),
    )
    geometry.setIndex(ground.idx)
    let mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    )
    let ray = new THREE.Raycaster(
      new THREE.Vector3(x - ci * 16, WATER + 0.4, z - ck * 16),
      new THREE.Vector3(dz / len, 0, -dx / len),
      0,
      4,
    )
    assertEquals(ray.intersectObject(mesh), [])
  }

  let v = vale(0.5)
  let left = v.grow(-2, ck), right = v.grow(-1, ck)
  let N = left.n
  for (let k = 0; k < N; k++) {
    for (let a = 0; a < left.layers.length; a++) {
      assertEquals(
        left.layers[a][N - 2 + k * N],
        right.layers[a][k * N],
      )
    }
    assertEquals(left.span?.[N - 2 + k * N], right.span?.[k * N])
  }
})
