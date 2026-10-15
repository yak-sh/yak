// A template stays shared while any visible chunk uses it, then leaves the GPU.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { instances } from './instances.ts'

// Instances over a scene of their own, counting the templates they ask for.
let walls = () => {
  let scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial()
  let asked = { calls: 0 }
  let shared = instances(
    scene,
    material,
    () => {
      asked.calls++
      return Promise.resolve(new THREE.SphereGeometry(1, 4, 2))
    },
    (kind, seed, turn, near) => `${kind}:${seed}:${turn}:${near}`,
    (kind) => kind.split('#')[0],
  )
  return { scene, shared, asked }
}

let placed = (x: number) => [{
  kind: 'wall#plaster',
  seed: 0,
  turn: 0,
  at: [x, 5, 64] as [number, number, number],
}]

test('ordinary geometry template is shared between chunks and disposed after both leave', async () => {
  let { scene, shared, asked } = walls()
  let a = shared.prepare(placed(64), true)
  let b = shared.prepare(placed(80), true)
  await Promise.all([a.ready, b.ready])
  a.draw('a')
  b.draw('b')
  a.release()
  b.release()
  assertEquals(asked.calls, 1)
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
})

test('an invalidated family asks for its template again while a chunk still draws it', async () => {
  let { shared, asked } = walls()
  let a = shared.prepare(placed(64), true)
  await a.ready
  a.draw('a')
  a.release()
  shared.invalidate(new Set(['wall']))
  let c = shared.prepare(placed(96), true)
  await c.ready
  assertEquals(asked.calls, 2)
  shared.dispose()
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
