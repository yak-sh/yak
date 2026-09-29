// Buildings stream as placements of one shared shape; a departing chunk lets
// the shape go when no other chunk is drawing it.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { assert, assertEquals } from '@std/assert'
import { seedBuildings } from './buildings_fixture.ts'
import { cuboids } from './boxes.ts'
import type { Chunk } from './chunks.ts'
import { SIZE } from './levels.ts'
import { out, pack, type Packed } from './mesh.ts'
import { chunkOf, flat } from './terrain.ts'
import { world } from './world.ts'
import { wanted } from './stream.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

seedBuildings()

let bare = (ci: number, ck: number): Chunk => ({
  ci,
  ck,
  solid: pack(out()),
  roof: null,
  small: null,
  buildings: [],
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
})

Deno.test('visible buildings share one mesh and release it when they leave', async () => {
  let v = flat(5), empty = pack(out())
  let calls = 0
  let reveal: (p: Packed) => void = () => {}
  let held = new Promise<Packed>((done) => reveal = done)
  let mid = SIZE / 2
  let prop = { kind: 'oak', x: mid, z: mid, seed: 1 }
  let placed: Chunk['buildings'] = [mid, mid + 4].map((x) => ({
    kind: 'smithy.plaster',
    seed: 0,
    turn: 0,
    at: [x, 5, mid],
  }))
  let w = world(v, {
    capacity: 4,
    chunk: (ci, ck): Promise<Chunk> =>
      Promise.resolve({
        ...bare(ci, ck),
        solid: empty,
        buildings: ci == chunkOf(mid) && ck == chunkOf(mid) ? placed : [],
        stood: ci == chunkOf(mid) && ck == chunkOf(mid)
          ? [{ prop, step: 1 }]
          : [],
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
  reveal(pack(cuboids(out(), [[[0, 0, 0], [1, 1, 1], 0x807060]])))
  await near
  assertEquals(w.props().flatMap((c) => c.stood), [{ prop, step: 1 }])
  let meshes = w.scene.children.filter((o): o is THREE.InstancedMesh =>
    o instanceof THREE.InstancedMesh
  )
  let buildingMesh = meshes.find((m) => m.count == 2)
  assert(buildingMesh)
  let at = new THREE.Matrix4()
  buildingMesh.getMatrixAt(0, at)
  assertEquals(at.elements[12], mid)
  buildingMesh.getMatrixAt(1, at)
  assertEquals(at.elements[12], mid + 4)
  let shown = buildingMesh.geometry
  let disposed = 0
  shown.addEventListener('dispose', () => disposed++)
  w.focus.set(1000, 5, 1000)
  w.tick(0, 0)
  assertEquals(disposed, 1)
  assertEquals(w.props().flatMap((c) => c.stood), [])
  w.dispose()
})

Deno.test('an edited design redraws a visible building', async () => {
  let mid = SIZE / 2, calls = 0
  let w = world(flat(5), {
    capacity: 4,
    chunk: (ci, ck) =>
      Promise.resolve({
        ...bare(ci, ck),
        buildings: ci == chunkOf(mid) && ck == chunkOf(mid)
          ? [{ kind: 'cottage.plaster', seed: 0, turn: 0, at: [mid, 5, mid] }]
          : [],
      }),
    template: () => {
      calls++
      return Promise.resolve(pack(cuboids(
        out(),
        [[[0, 0, 0], [1, 1, 1], calls]],
      )))
    },
  })
  await w.near()
  let first = w.scene.children.find((o): o is THREE.InstancedMesh =>
    o instanceof THREE.InstancedMesh && o.geometry.userData.bytes != null
  )!
  w.refresh()
  await w.near()
  let next = w.scene.children.find((o): o is THREE.InstancedMesh =>
    o instanceof THREE.InstancedMesh && o.geometry.userData.bytes != null
  )!
  assert(first.geometry != next.geometry)
  assert(calls > 1)
  w.dispose()
})

Deno.test('new ground draws before detail and keeps a worker free while travelling', async () => {
  let sent: { ci: number; ck: number; lod: number }[] = []
  let fine: (() => void)[] = []
  let w = world(flat(5), {
    capacity: 4,
    chunk: (ci, ck, lod) => {
      sent.push({ ci, ck, lod })
      return lod == 2
        ? Promise.resolve(bare(ci, ck))
        : new Promise((done) => fine.push(() => done(bare(ci, ck))))
    },
    template: () => Promise.resolve(pack(out())),
  })
  w.focus.set(128, 5, 128)
  await w.near()
  let close =
    wanted(128, 128, w.fog.far, () => undefined).filter((c) => c.d < 24).length
  assert(w.chunks[2] >= close)
  assertEquals(sent.slice(0, 4).every((a) => a.lod == 2), true)
  for (let n = 0; fine.length < 3 && n < 50; n++) await Promise.resolve()
  assertEquals(fine.length, 3)
  assertEquals(w.chunks[0], 0)
  w.focus.set(320, 5, 128)
  w.tick(0, 0)
  for (let n = 0; sent.every((a) => a.ci < 19) && n < 50; n++) {
    await Promise.resolve()
  }
  assert(sent.some((a) => a.ci >= 19 && a.lod == 2))
  w.dispose()
})
