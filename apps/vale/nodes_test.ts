// Resource plates and a felled tree as the scene sees gathering change.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { LODES, naturalEid } from './gather.ts'
import { type ChunkProps, natureMesh } from './nature_mesh.ts'
import { nodes } from './nodes.ts'
import { flat, type Prop } from './terrain.ts'
import { tradesOf } from './trades.ts'
import type { Job, Seen } from './work.ts'

test('gathered trees topple, lose their plates, and return on respawn', () => {
  let prop: Prop = { kind: 'oak', x: 5, z: 7, seed: 1, natural: true }
  let at: [number, number, number] = [5, 5, 7]
  let entry = { prop, at }
  let chunk: ChunkProps = {
    ci: 0,
    ck: 0,
    voxel: 0.25,
    natural: [entry],
    nature: natureMesh(
      0,
      0,
      [{ ...entry, spent: false, rarity: 'common' }],
      0.25,
    ),
    stood: [],
  }
  let n: Seen = {
    eid: naturalEid(prop),
    kind: 'oak',
    lode: LODES.oak,
    name: 'Oak',
    at,
    life: 0,
    spent: false,
    near: 2,
    rarity: 'common',
    prop,
  }
  let placed: Seen = {
    ...n,
    eid: 'placed-copper',
    kind: 'copper',
    lode: LODES.copper,
    name: 'Stone',
    at: [8, 5, 7],
    near: 4,
    prop: undefined,
  }
  let job: Job = {
    nodes: [n, placed],
    near: n,
    bench: null,
    board: null,
    doing: null,
    trades: tradesOf([]),
    events: [],
  }
  let labels: { key: string; html: string }[] = []
  let marks = {
    plate: (key: string, _at: THREE.Vector3, html: string) => {
      labels.push({ key, html })
    },
  }
  let glow = { emit: () => {} }
  let scene = new THREE.Scene()
  let view = nodes(scene, flat(5, [], [prop]), marks, glow, false)
  let tick = (dt = 0.016, chunks = [chunk]) => {
    labels = []
    view.tick(job, [4, 5, 7], dt, chunks)
  }
  let falls = () => scene.children.filter((o) => o.position.x == 5)

  tick()
  assertEquals(labels.map((l) => l.key), [`node:${n.eid}`])
  assert(labels[0].html.includes('· E'))
  job.near = placed
  tick()
  assertEquals(labels.map((l) => l.key), [`node:${placed.eid}`])
  job.near = null
  tick()
  assertEquals(labels, [])
  job.doing = {
    trade: 'wood',
    at,
    node: n,
    recipe: null,
    piece: null,
    k: 0.5,
    swing: 0,
  }
  tick()
  assertEquals(labels.map((l) => l.key), [`node:${n.eid}`])
  assert(labels[0].html.includes('Plate_Bar-work'))

  job.doing = null
  job.near = n
  n.spent = true
  tick(0.15)
  assertEquals(labels, [])
  assertEquals(falls().length, 1)
  assert(falls()[0].rotation.z != 0)
  tick(0.016, [{ ...chunk }])
  assertEquals(labels, [])
  assertEquals(falls().length, 1)
  tick(1.5)
  assertEquals(falls().length, 0)

  n.spent = false
  tick()
  assertEquals(labels.map((l) => l.key), [`node:${n.eid}`])
  n.spent = true
  tick(0.15)
  assertEquals(falls().length, 1)
  view.dispose()
})

test('rare resources keep visible rarity light before their plates appear', () => {
  let seen = (x: number, rarity: Seen['rarity']): Seen => {
    let prop: Prop = { kind: 'oak', x, z: 7, seed: x, natural: true }
    return {
      eid: naturalEid(prop),
      kind: 'oak',
      lode: LODES.oak,
      name: 'Oak',
      at: [x, 5, 7],
      life: 0,
      spent: false,
      near: 18,
      rarity,
      prop,
    }
  }
  let rare = seen(5, 'rare'), legendary = seen(9, 'legendary')
  let job: Job = {
    nodes: [rare, legendary, seen(13, 'common')],
    near: null,
    bench: null,
    board: null,
    doing: null,
    trades: tradesOf([]),
    events: [],
  }
  let labels: string[] = [], particles = 0
  let scene = new THREE.Scene()
  let view = nodes(
    scene,
    flat(5, [], []),
    { plate: (key: string) => labels.push(key) },
    { emit: () => particles++ },
    false,
  )
  let lights = () =>
    scene.children.filter((o): o is THREE.Sprite => o instanceof THREE.Sprite)
  let tick = () => view.tick(job, [0, 5, 0], 0)

  tick()
  assertEquals(labels, [])
  assertEquals(particles, 0)
  assertEquals(lights().length, 2)
  assert(lights()[0].scale.x < lights()[1].scale.x)
  assert(
    lights()[0].material.color.getHex() !=
      lights()[1].material.color.getHex(),
  )
  tick()
  assertEquals(lights().length, 2)
  rare.spent = true
  tick()
  assertEquals(lights().length, 1)
  legendary.near = 60
  tick()
  assertEquals(lights().length, 0)
  view.dispose()
})

test('resource light stays bounded on phones', () => {
  let job: Job = {
    nodes: Array.from({ length: 25 }, (_, i): Seen => {
      let prop: Prop = { kind: 'oak', x: i, z: 7, seed: i, natural: true }
      return {
        eid: naturalEid(prop),
        kind: 'oak',
        lode: LODES.oak,
        name: 'Oak',
        at: [i, 5, 7],
        life: 0,
        spent: false,
        near: 10 + i,
        rarity: 'epic',
        prop,
      }
    }),
    near: null,
    bench: null,
    board: null,
    doing: null,
    trades: tradesOf([]),
    events: [],
  }
  let scene = new THREE.Scene()
  let view = nodes(
    scene,
    flat(5, [], []),
    { plate: () => {} },
    { emit: () => {} },
    true,
  )
  view.tick(job, [0, 5, 0], 0)
  let lights = scene.children.filter((o) => o instanceof THREE.Sprite)
  assert(lights.length <= 12)
  assert(lights.some((o) => o.position.x == 0))
  assert(!lights.some((o) => o.position.x == 24))
  view.dispose()
  assertEquals(scene.children, [])
})
