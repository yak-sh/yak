/// <reference lib="deno.ns" />
// A game's frame, on the graph a page runs: a voxel world of about fifty
// thousand entities held in a local client (@yaks/ram under @yaks/graph, with
// @yaks/client's watches), and each iteration is one frame of a game loop —
// the patches a frame writes, the queries it asks, and the watches its writes
// wake. At 60 fps a frame has 16.7 ms, and the graph's share of it is a few.
//
// The world: a 200 × 200 floor of blocks, two thousand creatures with health,
// eight thousand items (most on the ground, some carried), eight players.
// A frame: the local player steps, the other seven arrive from the network as
// one change, the simulation moves two hundred creatures and hurts twenty, and
// the frame asks what is near the player, what is alive, and what the player
// carries. Three watches stay open throughout: the living creatures, the
// player's inventory, and the roster.

import { type Bundle, mint } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { client } from './client.ts'

let num = { type: 'number' }
let text = { type: 'string' }
let vocab = loadVocab([{
  $defs: {
    pos: {
      component: true,
      type: 'object',
      properties: { x: num, y: num, z: num },
    },
    block: { component: true, type: 'object', properties: { kind: text } },
    creature: {
      component: true,
      type: 'object',
      properties: { species: text },
    },
    health: {
      component: true,
      type: 'object',
      properties: { hp: num, max: num },
    },
    item: { component: true, type: 'object', properties: { kind: text } },
    carried: {
      component: true,
      type: 'object',
      properties: { by: { type: 'string', ref: 'entity', death: 'cascade' } },
    },
    player: { component: true, type: 'object', properties: { name: text } },
  },
}])

let SIDE = 200
let CREATURES = 2_000
let ITEMS = 8_000
let PLAYERS = 8
let MOVING = 200
let HURT = 20

// A small deterministic generator, so every run builds the same world.
let seed = 42
let rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
let at = () => ({ x: rand() * SIDE, y: 1, z: rand() * SIDE })

let players = Array.from({ length: PLAYERS }, () => mint())
let creatures = Array.from({ length: CREATURES }, () => mint())
let world: Bundle[] = [
  ...Array.from({ length: SIDE * SIDE }, (_, i): Bundle => ({
    entity: { eid: mint() },
    pos: { x: i % SIDE, y: 0, z: Math.floor(i / SIDE) },
    block: { kind: ['grass', 'stone', 'sand'][i % 3] },
  })),
  ...players.map((eid, i): Bundle => ({
    entity: { eid },
    player: { name: `p${i}` },
    pos: at(),
    health: { hp: 100, max: 100 },
  })),
  ...creatures.map((eid, i): Bundle => ({
    entity: { eid },
    creature: { species: ['slime', 'boar', 'wisp'][i % 3] },
    pos: at(),
    health: { hp: 20, max: 20 },
  })),
  ...Array.from({ length: ITEMS }, (_, i): Bundle => ({
    entity: { eid: mint() },
    item: { kind: ['stick', 'stone', 'berry', 'sword'][i % 4] },
    ...(i % 8 == 0 ? { carried: { by: players[i % PLAYERS] } } : { pos: at() }),
  })),
]

let c = client(vocab, [], { vault: false, wireVault: false })
let t0 = performance.now()
c.mutate(world)
console.log(
  `world: ${world.length} entities loaded in ${
    (performance.now() - t0).toFixed(0)
  } ms`,
)

let me = players[0]
let heard = 0
let alive = c.watch('.creature&.health.hp>0&?pos')
let bag = c.watch(`.carried.by=${me}&?item`)
let roster = c.watch('.player&?pos&?health')
for (let w of [alive, bag, roster]) w.subscribe(() => heard++)

let tick = 0
let step = (p: { x: number; z: number }, d: number) => ({
  x: (p.x + d + SIDE) % SIDE,
  y: 1,
  z: (p.z + d / 2 + SIDE) % SIDE,
})
let where = new Map(
  world.flatMap((b) =>
    b.pos ? [[b.entity.eid, b.pos as { x: number; z: number }]] : []
  ),
)
let move = (eid: string, d: number): Bundle => {
  let p = step(where.get(eid)!, d)
  where.set(eid, p)
  return { entity: { eid }, pos: p }
}

// One frame of the loop. Each part is what a game does every frame; together
// they are the graph's whole bill for that frame.
let frame = () => {
  tick++
  c.mutate([move(me, 0.1)])
  c.mutate(players.slice(1).map((eid) => move(eid, 0.2)))
  let busy = creatures.slice((tick * MOVING) % CREATURES).slice(0, MOVING)
  c.mutate(busy.map((eid, i): Bundle => ({
    ...move(eid, 0.05),
    ...i < HURT ? { health: { hp: (tick + i) % 21 } } : {},
  })))
  let { x, z } = where.get(me)!
  let box = (r: number) =>
    `.pos.x=${Math.floor(x - r)}..${Math.ceil(x + r)}` +
    `&.pos.z=${Math.floor(z - r)}..${Math.ceil(z + r)}`
  let near = c.read(`.creature&${box(16)}&?health`)
  let loot = c.read(`.item&${box(4)}`)
  let carried = c.read(`.carried.by=${me}&?item`)
  return near.length + loot.length + carried.length + alive.value.length +
    bag.value.length + roster.value.length
}

Deno.bench('frame: 50k-entity world, 208 bundles, 3 reads, 3 watches', () => {
  frame()
})

// The parts, apart: which share of a frame each one costs.
Deno.bench('part: one patch (the local player steps)', () => {
  c.mutate([move(me, 0.1)])
})
Deno.bench('part: a 200-bundle change (the simulation)', () => {
  tick++
  let busy = creatures.slice((tick * MOVING) % CREATURES).slice(0, MOVING)
  c.mutate(busy.map((eid) => move(eid, 0.05)))
})
Deno.bench('part: what is near (range over creatures)', () => {
  let { x, z } = where.get(me)!
  c.read(
    `.creature&.pos.x=${Math.floor(x - 16)}..${Math.ceil(x + 16)}` +
      `&.pos.z=${Math.floor(z - 16)}..${Math.ceil(z + 16)}`,
  )
})
Deno.bench('part: what a player carries (a reference)', () => {
  c.read(`.carried.by=${me}&?item`)
})
Deno.bench('part: what is alive (a property over one component)', () => {
  c.read('.creature&.health.hp>0')
})

addEventListener('unload', () => {
  c.close()
  console.log(`watch notifications: ${heard}`)
})
