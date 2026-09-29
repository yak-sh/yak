// The camera holds its orbit and fits its depth to the current fog.
import { test } from '@yaks/testing'
import { assert, assertAlmostEquals, assertEquals } from '@std/assert'
import * as THREE from 'three'
import { depth, moveLook, NEAR, steer } from './cam.ts'
import type { Intent } from './input.ts'
import { stride } from './stride.ts'
import { flat } from './terrain.ts'

let cameraState = () => ({
  yaw: 0,
  pitch: 0.4,
  dist: 9,
  reach: 9,
  x: 0,
  y: 0,
  z: 0,
  shake: 0,
  snap: false,
  orbiting: false,
  lift: 0,
})

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

test('the camera sees to the changing edge of the fog', () => {
  let camera = new THREE.PerspectiveCamera()
  let fog = new THREE.Fog(0xffffff, 40, 110)
  depth(camera, fog)
  assertEquals([camera.near, camera.far], [NEAR, 110])
  fog.far = 137.5
  depth(camera, fog)
  assertEquals(camera.far, 137.5)
})

test('a mouse orbit holds its angle until steering or explicit snap', () => {
  let cam = cameraState()
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

test('free orbit keeps keys and dodges on the hero heading', () => {
  let cam = cameraState()
  let yaw = Math.PI
  let pan = {
    ...still,
    orbit: [Math.PI / 2, 0] as [number, number],
    look: true,
  }
  steer(cam, pan, yaw, 0.1)
  assertEquals(cam.orbiting, true)
  assertAlmostEquals(moveLook(cam, { ...still, move: [0, 1] }, yaw, 0.1), 0)
  assertAlmostEquals(
    moveLook(cam, { ...still, move: [1, 0], dodge: true }, yaw, 0.1),
    0,
  )
  assertAlmostEquals(
    moveLook(cam, { ...still, move: [1, 0], faceMove: true }, yaw, 0.1),
    Math.PI / 2,
  )
  let body = { x: 20, y: 5, z: 20, vy: 0, yaw, speed: 0, gait: 'idle' as const }
  let v = flat(5)
  let forward = stride(v, body, [0, 1], moveLook(cam, still, yaw, 0.1), 0.1, 5)
  assertAlmostEquals(forward.x, body.x)
  assert(forward.z < body.z)
  assertAlmostEquals(forward.yaw, yaw)
  let left = stride(v, body, [-1, 0], moveLook(cam, still, yaw, 0.1), 0.1, 5)
  assert(left.x < body.x)
  assertAlmostEquals(left.z, body.z)
  assertAlmostEquals(left.yaw, yaw)

  let steered = cameraState()
  steer(steered, pan, yaw, 0.1)
  steer(steered, { ...still, orbit: [0.2, 0] }, yaw, 0.1)
  assertEquals(steered.orbiting, false)
  assertAlmostEquals(moveLook(steered, still, yaw, 0.1), steered.yaw)

  let turn = { ...still, turn: -6 }
  steer(cam, turn, yaw, 0.1)
  assertAlmostEquals(moveLook(cam, turn, yaw, 0.1), 0.6)
  yaw += 0.6
  assertEquals(cam.orbiting, true)
  assertAlmostEquals(moveLook(cam, still, yaw, 0.1), 0.6)

  steer(cam, { ...still, snap: true }, yaw, 0.1)
  for (let n = 0; n < 120; n++) steer(cam, still, yaw, 1 / 60)
  assertEquals(cam.orbiting, false)
  assertAlmostEquals(moveLook(cam, still, yaw, 0.1), cam.yaw)
})
