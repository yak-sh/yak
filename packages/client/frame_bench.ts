/// <reference lib="deno.ns" />
// A game's frame, on the graph a page runs: a voxel world of about fifty
// thousand entities held in a local client (@yaks/ram under @yaks/graph, with
// @yaks/client's watches), and each iteration is one frame of a game loop —
// the patches a frame writes, the queries it asks, and the watches its writes
// wake. At 60 fps a frame has 16.7 ms, and the graph's share of it is a few.
//
// The world: a 200 × 200 floor of blocks in 16 × 16 chunks, two thousand
// creatures with health, eight thousand items (most on the ground, some
// carried), eight players. A frame: the local player steps, the other seven
// arrive from the network as one batch, the simulation moves two hundred
// creatures and hurts twenty, and the frame asks what is near the player, what
// is lying at its feet, and what it carries. Forty watches stay open, the ones
// a game's screen keeps: every player's inventory, the roster, the living
// creatures (all of them, each species, the dying), the items around the
// spawn, and the blocks of the twenty-five chunks around it, which the frame's
// writes never touch.

import { type Bundle, mint } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { client } from './client.ts'

/** The same bounded world and frame in Deno and a throwaway browser. */
export function frameFixture() {
  let num = { type: 'number' }
  let text = { type: 'string' }
  let vocab = loadVocab([{
    $defs: {
      pos: {
        component: true,
        type: 'object',
        properties: { x: num, y: num, z: num },
      },
      block: {
        component: true,
        type: 'object',
        properties: { kind: text, chunk: text },
      },
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
  let CHUNK = 16
  let CREATURES = 2_000
  let ITEMS = 8_000
  let PLAYERS = 8
  let MOVING = 200
  let HURT = 20
  let SPECIES = ['slime', 'boar', 'wisp']

  // A small deterministic generator, so every run builds the same world.
  let seed = 42
  let rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  let at = () => ({ x: rand() * SIDE, y: 1, z: rand() * SIDE })
  let chunk = (x: number, z: number) =>
    `${Math.floor(x / CHUNK)}:${Math.floor(z / CHUNK)}`

  let players = Array.from({ length: PLAYERS }, () => mint())
  let creatures = Array.from({ length: CREATURES }, () => mint())
  let world: Bundle[] = [
    ...Array.from({ length: SIDE * SIDE }, (_, i): Bundle => {
      let x = i % SIDE, z = Math.floor(i / SIDE)
      return {
        entity: { eid: mint() },
        pos: { x, y: 0, z },
        block: { kind: ['grass', 'stone', 'sand'][i % 3], chunk: chunk(x, z) },
      }
    }),
    ...players.map((eid, i): Bundle => ({
      entity: { eid },
      player: { name: `p${i}` },
      pos: at(),
      health: { hp: 100, max: 100 },
    })),
    ...creatures.map((eid, i): Bundle => ({
      entity: { eid },
      creature: { species: SPECIES[i % 3] },
      pos: at(),
      health: { hp: 20, max: 20 },
    })),
    ...Array.from({ length: ITEMS }, (_, i): Bundle => ({
      entity: { eid: mint() },
      item: { kind: ['stick', 'stone', 'berry', 'sword'][i % 4] },
      ...(i % 8 == 0
        ? { carried: { by: players[(i / 8) % PLAYERS] } }
        : { pos: at() }),
    })),
  ]

  let c = client(vocab, [], { vault: false, wireVault: false })
  let t0 = performance.now()
  c.mutate(world)
  console.error(
    `world: ${world.length} entities loaded in ${
      (performance.now() - t0).toFixed(0)
    } ms`,
  )

  let me = players[0]
  let spawn = world.find((b) => b.entity.eid == me)!.pos as {
    x: number
    z: number
  }
  let around = (p: { x: number; z: number }, r: number) =>
    `.pos.x=${Math.floor(p.x - r)}..${Math.ceil(p.x + r)}` +
    `&.pos.z=${Math.floor(p.z - r)}..${Math.ceil(p.z + r)}`
  let heard = 0
  let watches = [
    ...players.map((p) => c.watch(`.carried.by=${p}&?item`)),
    c.watch('.player&?pos&?health'),
    c.watch('.creature&.health.hp>0&?pos'),
    ...SPECIES.map((s) => c.watch(`.creature.species=${s}&.health.hp>0`)),
    c.watch('.creature&.health.hp<5'),
    c.watch(`.item&${around(spawn, 8)}`),
    ...[-2, -1, 0, 1, 2].flatMap((dx) =>
      [-2, -1, 0, 1, 2].map((dz) =>
        c.watch(
          `.block.chunk="${chunk(spawn.x + dx * CHUNK, spawn.z + dz * CHUNK)}"`,
        )
      )
    ),
  ]
  for (let w of watches) w.subscribe(() => heard++)

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
  let busy = () => creatures.slice((tick * MOVING) % CREATURES).slice(0, MOVING)

  // One frame of the loop. Each part is what a game does every frame; together
  // they are the graph's whole bill for that frame.
  let frame = (shape: 'game' | 'batch' | 'alone' = 'game') => {
    tick++
    let local = [move(me, 0.1)]
    let peers = players.slice(1).map((eid) => move(eid, 0.2))
    let simulation = busy().map((eid, i): Bundle => ({
      ...move(eid, 0.05),
      ...i < HURT ? { health: { hp: (tick + i) % 21 } } : {},
    }))
    if (shape == 'game') {
      c.mutate(local)
      c.mutate(peers)
      c.mutate(simulation)
    } else if (shape == 'batch') {
      c.mutate([...local, ...peers, ...simulation])
    } else {
      for (let bundle of [...local, ...peers, ...simulation]) c.mutate([bundle])
    }
    let p = where.get(me)!
    let near = c.read(`.creature&${around(p, 16)}&?health`)
    let loot = c.read(`.item&${around(p, 4)}`)
    let carried = c.read(`.carried.by=${me}&?item`)
    return near.length + loot.length + carried.length +
      watches.reduce((n, w) => n + w.value.length, 0)
  }

  return {
    frame,
    watches: watches.length,
    verify: () => {
      let rows = c.graph.get([...players, ...creatures]) as Bundle[]
      if (rows.length != PLAYERS + CREATURES) throw new Error('Lost movers')
      for (let row of rows) {
        let expected = where.get(row.entity.eid)!
        let position = row.pos as { x: number; z: number } | undefined
        if (position?.x != expected.x || position?.z != expected.z) {
          throw new Error(`Position did not change: ${row.entity.eid}`)
        }
      }
      if (c.read('.entity').length != world.length) {
        throw new Error('World grew')
      }
    },
    parts: {
      'part: one patch (the local player steps)': () =>
        c.mutate([move(me, 0.1)]),
      'part: a 200-bundle batch (the simulation)': () => {
        tick++
        c.mutate(busy().map((eid) => move(eid, 0.05)))
      },
      'part: what is near (range over creatures)': () =>
        c.read(`.creature&${around(where.get(me)!, 16)}`),
      'part: what lies at its feet (range over items)': () =>
        c.read(`.item&${around(where.get(me)!, 4)}`),
      'part: what a player carries (a reference)': () =>
        c.read(`.carried.by=${me}&?item`),
      'part: what is alive (a property over one component)': () =>
        c.read('.creature&.health.hp>0'),
    },
    close: () => {
      c.close()
      console.error(`watch notifications: ${heard}`)
    },
  }
}

/** Per-frame tails, without Deno's adaptive grouping or world construction.
 * A fresh deterministic world per repeat keeps comparisons like for like.
 * Values change every frame; coordinates wrap and entity count stays bounded.
 */
export function frameDistribution(
  warmup = 100,
  count = 300,
  shape: 'game' | 'batch' | 'alone' = 'game',
) {
  let f = frameFixture()
  try {
    for (let i = 0; i < warmup; i++) f.frame(shape)
    let samples = Array.from({ length: count }, () => {
      let start = performance.now()
      f.frame(shape)
      return performance.now() - start
    })
    f.verify()
    let sorted = samples.toSorted((a, b) => a - b)
    let at = (p: number) => sorted[Math.ceil(count * p) - 1]
    return {
      unit: 'ms/frame',
      shape,
      count,
      warmup,
      watches: f.watches,
      median: at(.5),
      p95: at(.95),
      p99: at(.99),
      max: sorted[count - 1],
      samples,
    }
  } finally {
    f.close()
  }
}

if (typeof Deno != 'undefined') {
  if (import.meta.main) {
    if (Deno.args.includes('--distribution')) {
      let shape: 'game' | 'batch' | 'alone' = Deno.args.includes('--alone')
        ? 'alone'
        : Deno.args.includes('--batch')
        ? 'batch'
        : 'game'
      console.log(
        JSON.stringify(
          Array.from({ length: 3 }, () => frameDistribution(100, 300, shape)),
        ),
      )
    } else {
      await (await import('../../bench/standalone.ts')).standaloneMain(
        'client-frame',
      )
    }
  } else {
    let f = frameFixture()
    Deno.bench(
      `frame: 50k-entity world, 208 bundles, 3 reads, ${f.watches} watches`,
      () => {
        f.frame()
      },
    )
    for (let [name, fn] of Object.entries(f.parts)) {
      Deno.bench(name, () => {
        fn()
      })
    }
    addEventListener('unload', f.close)
  }
}
