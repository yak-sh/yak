// Resource plates and a felled tree as the scene sees gathering change.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { assert, assertEquals } from '@std/assert'
import { LODES, naturalEid } from './gather.ts'
import { type ChunkProps, natureMesh } from './nature_mesh.ts'
import { nodes } from './nodes.ts'
import { flat, type Prop } from './terrain.ts'
import { tradesOf } from './trades.ts'
import type { Job, Seen } from './work.ts'

Deno.test('gathered trees topple, lose their plates, and return on respawn', () => {
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
  let job: Job = {
    nodes: [n],
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
  assert(labels[0].html.includes('Plate_Bar-work'))

  job.doing = null
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
