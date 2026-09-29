// A template stays shared while any visible chunk uses it, then leaves the GPU.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { cuboids } from './boxes.ts'
import { instances } from './instances.ts'
import { out, pack } from './mesh.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

test('building template is shared between chunks and disposed after both leave', async () => {
  let scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial()
  let calls = 0
  let shared = instances(scene, material, () => {
    calls++
    return Promise.resolve(
      pack(cuboids(out(), [[[0, 0, 0], [1, 1, 1], 0x807060]])),
    )
  })
  let placed = (x: number) => [{
    kind: 'smithy.plaster',
    seed: 0,
    turn: 0,
    at: [x, 5, 64] as [number, number, number],
  }]
  let a = shared.prepare(placed(64), true)
  let b = shared.prepare(placed(80), true)
  await Promise.all([a.ready, b.ready])
  a.draw('a')
  b.draw('b')
  a.release()
  b.release()
  assertEquals(calls, 1)
  let mesh = scene.children[0] as THREE.InstancedMesh
  assertEquals(mesh.count, 2)
  let disposed = 0
  mesh.geometry.addEventListener('dispose', () => disposed++)
  shared.drop('a')
  assertEquals(mesh.count, 1)
  assertEquals(disposed, 0)
  shared.drop('b')
  assertEquals(scene.children.length, 0)
  assertEquals(disposed, 1)
  shared.dispose()
  material.dispose()
})
