// A cave uses the same terrain for movement, camera clearance and meshes.
import { seedBuildings } from './buildings_fixture.ts'
import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import * as THREE from 'three'
import { aim } from './cam.ts'
import { chunk } from './chunks.ts'
import { fights } from './mesh.ts'
import { spotOf } from './regions.ts'
import { type Body, walk } from './sim.ts'
import {
  adopt,
  chunkOf,
  floorUnder,
  groundAt,
  roofOver,
  vale,
} from './terrain.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

seedBuildings()

Deno.test('the ridge cave is walkable from its mouth and back', () => {
  let [x, z] = spotOf('mossvale', 'ridge')!
  let v = vale(0.5)
  let start = z - 26
  let b: Body = {
    x,
    y: groundAt(v, x, start),
    z: start,
    vy: 0,
    yaw: 0,
    speed: 0,
    gait: 'idle',
  }
  let step = (way: number) => {
    for (let i = 0; i < 240; i++) {
      b = walk(v, b, { x: 0, z: way, jump: false }, 1 / 30, 4)
    }
  }
  step(1)
  assert(b.z > z + 5)
  assert(roofOver(v, b.x, b.y + 1, b.z) < Infinity)
  assertAlmostEquals(b.y, floorUnder(v, b.x, b.y + 1, b.z), 0.01)
  step(-1)
  assert(b.z < start + 1)
  assertEquals(roofOver(v, b.x, b.y + 1, b.z), Infinity)
})

Deno.test('the cave has matching cold and grown layers and a clear camera', () => {
  let [x, z] = spotOf('mossvale', 'ridge')!
  let v = vale(1)
  let points = [z - 20, z - 10, z]
  for (let at of points) {
    let before = [
      groundAt(v, x, at),
      floorUnder(v, x, 8, at),
      roofOver(v, x, 8, at),
    ]
    adopt(v, v.grow(chunkOf(x), chunkOf(at)))
    let after = [
      groundAt(v, x, at),
      floorUnder(v, x, 8, at),
      roofOver(v, x, 8, at),
    ]
    assertEquals(after, before)
  }
  let c = chunk(v, chunkOf(x), chunkOf(z), false)
  assert(c.roof)
  assertEquals(c.roof.nrm.length / 4, c.roof.pos.length / 3)
  assertEquals(fights(c.solid), [])
  assertEquals(fights(c.roof), [])

  let target = new THREE.Vector3(x, floorUnder(v, x, 8, z) + 1.5, z)
  let cam = {
    yaw: 0,
    pitch: 0.5,
    dist: 9,
    reach: 9,
    x,
    y: target.y,
    z,
    shake: 0,
    snap: false,
    lift: 0,
  }
  let camera = new THREE.PerspectiveCamera()
  aim(cam, camera, target, v, 1)
  assert(
    camera.position.y <
      roofOver(v, camera.position.x, target.y, camera.position.z),
  )
})
