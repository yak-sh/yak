// The camera's depth follows the fog when the hero crosses a biome border.
import { assertEquals } from '@std/assert'
import * as THREE from 'three'
import { depth, NEAR } from './cam.ts'

Deno.test('the camera sees to the changing edge of the fog', () => {
  let camera = new THREE.PerspectiveCamera()
  let fog = new THREE.Fog(0xffffff, 40, 110)
  depth(camera, fog)
  assertEquals([camera.near, camera.far], [NEAR, 110])
  fog.far = 137.5
  depth(camera, fog)
  assertEquals(camera.far, 137.5)
})
