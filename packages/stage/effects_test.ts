// Values drive the same scene effects for any caller, without world state.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { equal, test } from '@yaks/testing'
import { airOf } from './air.ts'
import { flames } from './flames.ts'

test('flames appear only for source values near the focus', () => {
  let scene = new THREE.Scene(), tick = flames(scene)
  let mesh = scene.children[0] as THREE.InstancedMesh
  equal(mesh.count, 0)
  tick(0, new THREE.Vector3(), [{ at: [1, 0, 0], size: 1 }])
  equal(mesh.count, 3)
  equal(mesh.visible, true)
  tick(1, new THREE.Vector3(300, 0, 0), [{ at: [1, 0, 0], size: 1 }])
  equal(mesh.visible, false)
})

test('air takes a caller catalogue and stops emitting after leaving its kind', () => {
  let scene = new THREE.Scene()
  let drift = airOf(scene, {
    arbitrary: {
      color: 0xffffff,
      rate: 20,
      spread: 1,
      low: 1,
      high: 2,
      speed: 0,
      up: 0,
      fall: 0,
      life: 10,
      size: 1,
    },
  })
  let at = new THREE.Vector3()
  drift.tick(at, 0.1, 'unknown')
  equal(scene.children.length, 0)
  drift.tick(at, 0.1, 'arbitrary')
  let mesh = scene.children[0] as THREE.InstancedMesh
  equal(mesh.count, 2)
  drift.tick(at, 0.1)
  equal(mesh.count, 2)
})
