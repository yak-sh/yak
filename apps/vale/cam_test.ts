// The camera holds its orbit and fits its depth to the current fog.
import { assertAlmostEquals, assertEquals } from '@std/assert'
import * as THREE from 'three'
import { depth, NEAR, steer } from './cam.ts'
import type { Intent } from './input.ts'

Deno.test('the camera sees to the changing edge of the fog', () => {
  let camera = new THREE.PerspectiveCamera()
  let fog = new THREE.Fog(0xffffff, 40, 110)
  depth(camera, fog)
  assertEquals([camera.near, camera.far], [NEAR, 110])
  fog.far = 137.5
  depth(camera, fog)
  assertEquals(camera.far, 137.5)
})

Deno.test('a mouse orbit holds its angle until steering or explicit snap', () => {
  let cam = {
    yaw: 0,
    pitch: 0.4,
    dist: 9,
    reach: 9,
    x: 0,
    y: 0,
    z: 0,
    shake: 0,
    snap: false,
    lift: 0,
  }
  let still: Intent = {
    move: [0, 0],
    turn: 0,
    faceMove: false,
    jump: false,
    strike: false,
    ability: 0,
    dodge: false,
    talk: false,
    gather: false,
    drink: false,
    snap: false,
    mic: false,
    orbit: [0, 0],
    look: false,
    zoom: 0,
  }
  steer(cam, { ...still, orbit: [0.8, 0], look: true }, Math.PI, 0.016)
  for (let n = 0; n < 240; n++) steer(cam, still, Math.PI, 1 / 60)
  assertAlmostEquals(cam.yaw, 0.8)

  steer(cam, { ...still, turn: 6 }, Math.PI, 0.1)
  assertAlmostEquals(cam.yaw, 0.2)
  for (let n = 0; n < 120; n++) steer(cam, still, Math.PI, 1 / 60)
  assertAlmostEquals(cam.yaw, 0.2)

  steer(cam, { ...still, snap: true }, Math.PI, 1 / 60)
  for (let n = 0; n < 120; n++) steer(cam, still, Math.PI, 1 / 60)
  assertAlmostEquals(cam.yaw, 0, 1e-9)
  assertEquals(cam.snap, false)
})
