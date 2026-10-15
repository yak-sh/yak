// A template stays shared while any visible chunk uses it, then leaves the GPU.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { instances } from './instances.ts'

test('ordinary geometry template is shared between chunks and disposed after both leave', async () => {
  let scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial()
  let calls = 0
  let shared = instances(
    scene,
    material,
    () => {
      calls++
      return Promise.resolve(
        new THREE.SphereGeometry(1, 4, 2),
      )
    },
    (kind, seed, turn, near) => `${kind}:${seed}:${turn}:${near}`,
    (kind) => kind.split('#')[0],
  )
  let placed = (x: number) => [{
    kind: 'wall#plaster',
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
  shared.invalidate(new Set(['wall']))
  let c = shared.prepare(placed(96), true)
  await c.ready
  c.draw('c')
  c.release()
  assertEquals(calls, 2)
  shared.drop('c')
  shared.dispose()
  material.dispose()
})

test('a template finishing after disposal releases its geometry without drawing', async () => {
  let scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial()
  let finish!: (geometry: THREE.BufferGeometry) => void
  let pending = new Promise<THREE.BufferGeometry>((resolve) => finish = resolve)
  let shared = instances(
    scene,
    material,
    () => pending,
    (kind) => kind,
    (kind) => kind,
  )
  let prepared = shared.prepare([{
    kind: 'sphere',
    seed: 0,
    turn: 0,
    at: [0, 0, 0],
  }], true)
  shared.dispose()
  let geometry = new THREE.SphereGeometry(1, 4, 2), disposed = 0
  geometry.addEventListener('dispose', () => disposed++)
  finish(geometry)
  await prepared.ready
  prepared.draw('late')
  prepared.release()
  assertEquals(disposed, 1)
  assertEquals(scene.children.length, 0)
  material.dispose()
})
