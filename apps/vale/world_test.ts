// Buildings stream as placements of one shared shape; a departing chunk lets
// the shape go when no other chunk is drawing it.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { assert, assertEquals } from '@std/assert'
import type { Chunk } from './chunks.ts'
import { cuboid, out, pack, type Packed } from './mesh.ts'
import { flat } from './terrain.ts'
import { world } from './world.ts'

let canvas = () => ({
  width: 0,
  height: 0,
  getContext: () => ({
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {},
  }),
})

Deno.test('visible buildings share one mesh and release it when they leave', async () => {
  let document = globalThis.document
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: canvas },
  })
  try {
    let v = flat(5), empty = pack(out())
    let calls = 0
    let reveal: (p: Packed) => void = () => {}
    let held = new Promise<Packed>((done) => reveal = done)
    let placed: Chunk['buildings'] = [64, 68].map((x) => ({
      kind: 'smithy.plaster',
      seed: 0,
      turn: 0,
      at: [x, 5, 64],
    }))
    let w = world(v, {
      chunk: (ci, ck): Promise<Chunk> =>
        Promise.resolve({
          ci,
          ck,
          solid: empty,
          small: null,
          buildings: ci == 4 && ck == 4 ? placed : [],
          patch: {
            ci,
            ck,
            voxel: 1,
            n: 0,
            layers: [],
            top: new Uint8Array(),
            hue: new Float32Array(),
            region: new Uint8Array(),
            other: new Uint8Array(),
            share: new Uint8Array(),
            regions: [],
          },
        }),
      template: () => {
        calls++
        return held
      },
    })
    let done = false
    let near = w.near().then(() => done = true)
    for (let i = 0; i < 20 && !calls; i++) await Promise.resolve()
    assertEquals(calls, 1)
    assertEquals(done, false)
    reveal(pack(cuboid(out(), [0, 0, 0], [1, 1, 1], 0x807060)))
    await near
    let meshes = w.scene.children.filter((o): o is THREE.InstancedMesh =>
      o instanceof THREE.InstancedMesh
    )
    let buildingMesh = meshes.find((m) => m.count == 2)
    assert(buildingMesh)
    let at = new THREE.Matrix4()
    buildingMesh.getMatrixAt(0, at)
    assertEquals(at.elements[12], 64)
    buildingMesh.getMatrixAt(1, at)
    assertEquals(at.elements[12], 68)
    let shown = buildingMesh.geometry
    let disposed = 0
    shown.addEventListener('dispose', () => disposed++)
    w.focus.set(1000, 5, 1000)
    w.tick(0, 0)
    assertEquals(disposed, 1)
    w.dispose()
  } finally {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: document,
    })
  }
})
