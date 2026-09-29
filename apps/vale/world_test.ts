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
import { CHUNK, chunkOf, flat } from './terrain.ts'
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
  let reveal: (p: Packed) => void = () => {}
  let held = new Promise<Packed>((done) => reveal = done)
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
      return calls == 1
        ? Promise.resolve(pack(cuboids(
          out(),
          [[[0, 0, 0], [1, 1, 1], calls]],
        )))
        : held
    },
  })
  await w.near()
  let first = w.scene.children.find((o): o is THREE.InstancedMesh =>
    o instanceof THREE.InstancedMesh && o.geometry.userData.bytes != null
  )!
  w.refresh()
  for (let i = 0; calls < 2 && i < 200; i++) await Promise.resolve()
  assertEquals(calls, 2)
  assert(w.scene.children.includes(first))
  w.refresh()
  assert(w.scene.children.includes(first))
  reveal(pack(cuboids(out(), [[[0, 0, 0], [1, 1, 1], 3]])))
  await w.near()
  assertEquals(calls, 3)
  let next = w.scene.children.find((o): o is THREE.InstancedMesh =>
    o instanceof THREE.InstancedMesh && o.geometry.userData.bytes != null
  )!
  assert(first.geometry != next.geometry)
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

Deno.test('a design refresh keeps visible ground until replacement chunks arrive', async () => {
  let next = false
  let finish = new Map<string, (c: Chunk) => void>()
  let w = world(flat(5), {
    capacity: 4,
    chunk: (ci, ck) =>
      next
        ? new Promise((done) => finish.set(`${ci} ${ck}`, done))
        : Promise.resolve(bare(ci, ck)),
    template: () => Promise.resolve(pack(out())),
  })
  await w.near()
  let at = (ci: number, ck: number) =>
    w.scene.children.find((o): o is THREE.Mesh =>
      o instanceof THREE.Mesh && o.position.x == ci * CHUNK &&
      o.position.z == ck * CHUNK && o.geometry.userData.bytes != null
    )
  let center = at(8, 8)
  assert(center)
  next = true
  w.refresh()
  assertEquals(at(8, 8), center)
  let ready = false
  w.near().then(() => ready = true)
  await Promise.resolve()
  assertEquals(ready, false)
  for (let i = 0; !finish.size && i < 200; i++) await Promise.resolve()
  assert(finish.size)
  let [key, stale] = [...finish][0]
  let [ci, ck] = key.split(' ').map(Number)
  let before = at(ci, ck)
  assert(before)
  w.refresh()
  assertEquals(at(ci, ck), before)
  stale(bare(ci, ck))
  for (let i = 0; finish.get(key) == stale && i < 200; i++) {
    await Promise.resolve()
  }
  let done = finish.get(key)
  assert(done && done != stale)
  assertEquals(at(ci, ck), before)
  done(bare(ci, ck))
  for (let i = 0; at(ci, ck) == before && i < 50; i++) await Promise.resolve()
  assert(at(ci, ck) != before)
  w.dispose()
})

Deno.test('a scoped design edit replaces its chunk and keeps its neighbour', async () => {
  let calls: string[] = []
  let w = world(flat(5), {
    capacity: 4,
    chunk: (ci, ck) => {
      calls.push(`${ci} ${ck}`)
      return Promise.resolve(bare(ci, ck))
    },
    template: () => Promise.resolve(pack(out())),
  })
  w.fog.far = 35
  w.focus.set(128, 5, 128)
  await w.near()
  for (let i = 0; w.pending && i < 500; i++) await Promise.resolve()
  assertEquals(w.pending, 0)
  let at = (ci: number, ck: number) =>
    w.scene.children.find((o): o is THREE.Mesh =>
      o instanceof THREE.Mesh && o.position.x == ci * CHUNK &&
      o.position.z == ck * CHUNK && o.geometry.userData.bytes != null
    )
  let first = at(8, 8), other = at(7, 8)
  assert(first && other)
  calls.length = 0
  w.refresh((ci, ck) => ci == 8 && ck == 8)
  await w.near()
  assert(at(8, 8) != first)
  assertEquals(at(7, 8), other)
  assertEquals(calls, ['8 8'])
  w.focus.set(1000, 5, 1000)
  w.tick(0, 0)
  assertEquals(at(8, 8), undefined)
  w.focus.set(128, 5, 128)
  await w.near()
  assert(at(8, 8))
  w.dispose()
})

Deno.test('a building edit remeshes its model without remeshing another kind', async () => {
  let calls: string[] = []
  let w = world(flat(5), {
    capacity: 4,
    chunk: (ci, ck) =>
      Promise.resolve({
        ...bare(ci, ck),
        buildings: ci == 8 && ck == 8
          ? [{ kind: 'cottage.plaster', seed: 0, turn: 0, at: [136, 5, 136] }]
          : ci == 7 && ck == 8
          ? [{ kind: 'smithy.plaster', seed: 0, turn: 0, at: [120, 5, 136] }]
          : [],
      }),
    template: (kind) => {
      calls.push(kind)
      return Promise.resolve(pack(out()))
    },
  })
  w.fog.far = 35
  w.focus.set(128, 5, 128)
  await w.near()
  for (let i = 0; w.pending && i < 500; i++) await Promise.resolve()
  assertEquals(w.pending, 0)
  calls.length = 0
  w.refresh((ci, ck) => ci == 8 && ck == 8, new Set(['cottage']))
  await w.near()
  assertEquals(calls, ['cottage.plaster'])
  w.dispose()
})
