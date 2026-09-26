// Gathering: the nodes of each level a hero works for what they give, and the
// four trades that grow by working them. A node is a tree to fell, a seam to
// mine, a herb to pick or a shoal to fish, of a kind (`LODES`) that grows
// around the kinds of place it names (features.ts) in the levels whose danger
// it suits, the way a creature lives around its haunts (homes.ts). Every page
// places the same nodes from the level's own numbers and names each by where
// it stands, so nothing about where they are is stored.
//
// Working a node writes an item wearing a `gathered` row: the item is what the
// hero gets, and the row spends the node for everyone until it grows back, the
// way a `slain` row fells a creature (rules.ts `fallOf`). A hero's trades are
// counted from the gathered rows on their items: each is xp in its node's
// trade, and a node of a higher tier asks a trade that high before it can be
// worked.
import { isA } from './features.ts'
import { HOPS } from './levels.ts'
import { hashOf, rand, uuidOf } from './rand.ts'
import { wallsNear } from './sim.ts'
import {
  rise,
  SHORE,
  SIZE,
  steep,
  trodden,
  type Vale,
  WATER,
} from './terrain.ts'

export type Trade = 'wood' | 'ore' | 'herb' | 'fish'

/** Each trade: its name, its icon, what working a node of it is called, how
 * near a hero must stand to work one, in metres, and how long the work takes
 * against a tree's; and how its nodes grow: how many around each place, within
 * how many metres of it, how far apart, and how many seconds a spent one takes
 * to grow back. */
export let TRADES: Record<Trade, {
  name: string
  icon: string
  verb: string
  reach: number
  work: number
  count: number
  within: number
  apart: number
  respawn: number
}> = {
  wood: {
    name: 'Woodcutting',
    icon: '🪓',
    verb: 'Chop',
    reach: 2.4,
    work: 1,
    count: 3,
    within: 24,
    apart: 7,
    respawn: 150,
  },
  ore: {
    name: 'Mining',
    icon: '⛏️',
    verb: 'Mine',
    reach: 2.2,
    work: 1.15,
    count: 2,
    within: 22,
    apart: 6,
    respawn: 180,
  },
  herb: {
    name: 'Herbalism',
    icon: '🌿',
    verb: 'Pick',
    reach: 1.9,
    work: 0.7,
    count: 2,
    within: 26,
    apart: 6,
    respawn: 100,
  },
  fish: {
    name: 'Fishing',
    icon: '🎣',
    verb: 'Fish',
    reach: 3.4,
    work: 1.5,
    count: 2,
    within: 26,
    apart: 8,
    respawn: 75,
  },
}

/** How a node is drawn (nodes.ts): a tree is a prop of that kind (props.ts)
 * with logs cut at its foot, felled to a stump of its bark and wood; a seam is
 * stone veined with ore; a herb is a clump in bloom, a bush, stalks or caps; a
 * shoal ripples on the water, a fish of its colour leaping now and then. */
export type Look =
  | { plan: 'tree'; prop: string; bark: number; wood: number }
  | { plan: 'seam'; stone: [number, number, number]; vein: number }
  | {
    plan: 'herb'
    form: 'bush' | 'stalks' | 'caps'
    leaf: number
    bloom: number
  }
  | { plan: 'shoal'; fish: number }

/** A kind of node: its name, its trade and tier, the item it gives
 * (items.ts), the kinds of place it grows around, or places like them, and the
 * fewest and most roads from home a level it grows in lies (levels.ts
 * `HOPS`). */
export type Lode = {
  name: string
  trade: Trade
  tier: number
  gives: string
  near: string[]
  hops: [number, number]
  look: Look
}

let tree = (prop: string, bark: number, wood: number): Look => ({
  plan: 'tree',
  prop,
  bark,
  wood,
})
let seam = (stone: [number, number, number], vein: number): Look => ({
  plan: 'seam',
  stone,
  vein,
})
let herb = (
  form: 'bush' | 'stalks' | 'caps',
  leaf: number,
  bloom: number,
): Look => ({ plan: 'herb', form, leaf, bloom })
let shoal = (fish: number): Look => ({ plan: 'shoal', fish })

export let LODES: Record<string, Lode> = {
  oak: {
    name: 'Oak',
    trade: 'wood',
    tier: 1,
    gives: 'oaklog',
    near: ['woods'],
    hops: [0, 1],
    look: tree('oak', 0x7a5236, 0xd8b078),
  },
  pine: {
    name: 'Tall pine',
    trade: 'wood',
    tier: 2,
    gives: 'pinelog',
    near: ['pinewood', 'woods'],
    hops: [2, 3],
    look: tree('pine', 0x6b4a33, 0xe8c890),
  },
  driftwood: {
    name: 'Driftwood',
    trade: 'wood',
    tier: 2,
    gives: 'driftwood',
    near: ['coast'],
    hops: [2, 5],
    look: tree('driftlog', 0xb8ab98, 0xd8ccb8),
  },
  toadstool: {
    name: 'Giant toadstool',
    trade: 'wood',
    tier: 3,
    gives: 'stalkwood',
    near: ['shroomwood'],
    hops: [3, 5],
    look: tree('toadstool', 0xf1eadb, 0xe9dcc4),
  },
  rimepine: {
    name: 'Rime-pine',
    trade: 'wood',
    tier: 3,
    gives: 'rimewood',
    near: ['snowfield', 'pinewood'],
    hops: [4, 5],
    look: tree('rimespruce', 0x4a4038, 0xdce8f0),
  },
  palm: {
    name: 'Date palm',
    trade: 'wood',
    tier: 3,
    gives: 'palmwood',
    near: ['oasis'],
    hops: [4, 7],
    look: tree('datepalm', 0x8a6a44, 0xe0c8a0),
  },
  spruce: {
    name: 'Old spruce',
    trade: 'wood',
    tier: 4,
    gives: 'sprucelog',
    near: ['snowfield', 'pinewood'],
    hops: [6, 7],
    look: tree('bigspruce', 0x3e2e22, 0xd8b880),
  },
  charpine: {
    name: 'Charred pine',
    trade: 'wood',
    tier: 4,
    gives: 'charwood',
    near: ['ashfield', 'volcano'],
    hops: [6, 8],
    look: tree('chartree', 0x2a2624, 0xe8622a),
  },
  iron: {
    name: 'Iron seam',
    trade: 'ore',
    tier: 1,
    gives: 'ore',
    near: ['crags', 'ridge'],
    hops: [0, 1],
    look: seam([0x8f8e86, 0xa3a198, 0x7f7e77], 0xc8783a),
  },
  silver: {
    name: 'Silver seam',
    trade: 'ore',
    tier: 2,
    gives: 'silver',
    near: ['crags', 'moor', 'ruins'],
    hops: [2, 3],
    look: seam([0x7a7a80, 0x8a8a90, 0x6a6a70], 0xe8ecf2),
  },
  gold: {
    name: 'Gold seam',
    trade: 'ore',
    tier: 3,
    gives: 'gold',
    near: ['crags', 'moor', 'ruins'],
    hops: [4, 5],
    look: seam([0x7a6a58, 0x8a7a66, 0x6a5a4a], 0xf2c14e),
  },
  gleam: {
    name: 'Gleamstone seam',
    trade: 'ore',
    tier: 3,
    gives: 'gleamstone',
    near: ['crystals'],
    hops: [3, 5],
    look: seam([0x4a4a6a, 0x5a5a7a, 0x3a3a5a], 0x9ad8ff),
  },
  iceore: {
    name: 'Ice-ore seam',
    trade: 'ore',
    tier: 3,
    gives: 'iceore',
    near: ['glacier', 'snowfield'],
    hops: [4, 5],
    look: seam([0x8aa0b0, 0x9ab0c0, 0x7a90a0], 0xc8f0ff),
  },
  sunstone: {
    name: 'Sunstone seam',
    trade: 'ore',
    tier: 3,
    gives: 'sunstone',
    near: ['mesa', 'dunes'],
    hops: [4, 7],
    look: seam([0xc89a6a, 0xd8aa7a, 0xb88a5a], 0xff9030),
  },
  starsilver: {
    name: 'Starsilver seam',
    trade: 'ore',
    tier: 4,
    gives: 'starsilver',
    near: ['glacier', 'snowfield'],
    hops: [6, 7],
    look: seam([0x505868, 0x606878, 0x404858], 0xf0f8ff),
  },
  obsidian: {
    name: 'Obsidian',
    trade: 'ore',
    tier: 4,
    gives: 'obsidian',
    near: ['volcano', 'ashfield'],
    hops: [6, 7],
    look: seam([0x2a2624, 0x3a3432, 0x221e1c], 0x7a5aa8),
  },
  emberstone: {
    name: 'Emberstone seam',
    trade: 'ore',
    tier: 5,
    gives: 'emberstone',
    near: ['volcano', 'ashfield', 'ruins'],
    hops: [8, 8],
    look: seam([0x3a2420, 0x4a302a, 0x2a1a18], 0xff5a2a),
  },
  mossberry: {
    name: 'Mossberry bush',
    trade: 'herb',
    tier: 1,
    gives: 'mossberry',
    near: ['meadow', 'woods', 'fields'],
    hops: [0, 1],
    look: herb('bush', 0x4f8f3c, 0xc0406a),
  },
  myrtle: {
    name: 'Bog myrtle',
    trade: 'herb',
    tier: 2,
    gives: 'myrtle',
    near: ['marsh', 'moor'],
    hops: [1, 3],
    look: herb('bush', 0x5a7a3a, 0xc8a050),
  },
  marigold: {
    name: 'Marigolds',
    trade: 'herb',
    tier: 2,
    gives: 'marigold',
    near: ['meadow', 'woods', 'fields'],
    hops: [2, 3],
    look: herb('stalks', 0x5a9a44, 0xf2a030),
  },
  samphire: {
    name: 'Samphire',
    trade: 'herb',
    tier: 2,
    gives: 'samphire',
    near: ['coast', 'isles'],
    hops: [2, 5],
    look: herb('stalks', 0x6aa04a, 0x9ad060),
  },
  caps: {
    name: 'Mushroom ring',
    trade: 'herb',
    tier: 3,
    gives: 'cap',
    near: ['shroomwood'],
    hops: [3, 5],
    look: herb('caps', 0xefe4cc, 0xd8483a),
  },
  snowbell: {
    name: 'Snowbells',
    trade: 'herb',
    tier: 3,
    gives: 'snowbell',
    near: ['snowfield', 'glacier'],
    hops: [4, 7],
    look: herb('stalks', 0x5a8a6a, 0xf4f8ff),
  },
  sage: {
    name: 'Desert sage',
    trade: 'herb',
    tier: 3,
    gives: 'sage',
    near: ['oasis', 'dunes', 'mesa'],
    hops: [4, 7],
    look: herb('bush', 0x8aa07a, 0xb8a0d8),
  },
  wolfsbane: {
    name: 'Wolfsbane',
    trade: 'herb',
    tier: 3,
    gives: 'wolfsbane',
    near: ['moor', 'marsh', 'ruins'],
    hops: [4, 5],
    look: herb('stalks', 0x4a6a3a, 0x6a4ab8),
  },
  firebloom: {
    name: 'Firebloom',
    trade: 'herb',
    tier: 4,
    gives: 'firebloom',
    near: ['ashfield', 'volcano'],
    hops: [6, 8],
    look: herb('stalks', 0x3a3a2a, 0xff5a2a),
  },
  perch: {
    name: 'Perch',
    trade: 'fish',
    tier: 1,
    gives: 'perch',
    near: ['lake'],
    hops: [0, 1],
    look: shoal(0x6a8a4a),
  },
  pike: {
    name: 'Pike',
    trade: 'fish',
    tier: 2,
    gives: 'pike',
    near: ['lake', 'marsh'],
    hops: [2, 3],
    look: shoal(0x4a6a4a),
  },
  mackerel: {
    name: 'Mackerel',
    trade: 'fish',
    tier: 2,
    gives: 'mackerel',
    near: ['coast', 'isles'],
    hops: [2, 5],
    look: shoal(0x3a6a8a),
  },
  eel: {
    name: 'Mire eels',
    trade: 'fish',
    tier: 3,
    gives: 'eel',
    near: ['marsh', 'lake'],
    hops: [4, 5],
    look: shoal(0x3a3a2a),
  },
  char: {
    name: 'Tarn char',
    trade: 'fish',
    tier: 3,
    gives: 'char',
    near: ['tarn'],
    hops: [4, 7],
    look: shoal(0x5a6a7a),
  },
  carp: {
    name: 'Oasis carp',
    trade: 'fish',
    tier: 3,
    gives: 'carp',
    near: ['oasis'],
    hops: [4, 7],
    look: shoal(0xd8883a),
  },
}

/** A node where it stands: its eid, its kind, and where, in metres. */
export type Node = { eid: string; lode: string; x: number; z: number }

// How far from a village's middle, and from where a road comes in, no node
// grows, in metres.
let HOMELY = 16
let DOOR = 8
// The directions a shoal looks for a bank to be fished from.
let ROUND = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2)

let placed = new WeakMap<Vale, Node[]>()

/** Every node a level grows, and where: for each kind that suits the level,
 * round each place of a kind it grows near, as many as its trade grows, on
 * ground they can stand on (a shoal on deep water a hero can reach from the
 * bank), nearer that place than any place of another kind, clear of trunks,
 * rocks, roads and lanes, the village and each other. Picked on the level's
 * smooth ground, and each named by where it stands.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * import { vale } from './terrain.ts'
 * // The same nodes, by the same names, on a page growing any voxel size.
 * let at = (voxel: number) =>
 *   nodesOf(vale('mossvale', voxel)).map((n) => `${n.lode} ${n.eid}`)
 * assert(at(4).length > 0)
 * assertEquals(at(4), at(1))
 * ```
 */
export let nodesOf = (v: Vale): Node[] => {
  let got = placed.get(v)
  if (got) return got
  let lv = v.level, hops = HOPS[lv.id] ?? 0
  let height = rise(lv)
  let worn = trodden(lv)
  let places = Object.entries(lv.places)
  let homes = places.filter(([, p]) => isA(p.kind, 'village'))
  let out: Node[] = []
  let dry = (x: number, z: number) => {
    let h = height(x, z)
    return h > SHORE + 0.2 && h < 18 && steep(height, x, z) < 1 &&
      !worn(x, z) &&
      !wallsNear(v, x, z).some((w) => Math.hypot(w.x - x, w.z - z) < w.r + 1.2)
  }
  // Deep enough that nobody stands in it, with a bank or shallows within
  // reach.
  let wet = (x: number, z: number) =>
    height(x, z) < WATER - 0.9 &&
    ROUND.some((a) =>
      height(x + Math.cos(a) * 2.6, z + Math.sin(a) * 2.6) > WATER - 0.5
    )
  for (let [kind, lode] of Object.entries(LODES)) {
    if (hops < lode.hops[0] || hops > lode.hops[1]) continue
    let t = TRADES[lode.trade]
    let fits = lode.trade == 'fish' ? wet : dry
    for (let [name, place] of places) {
      if (!lode.near.some((near) => isA(place.kind, near))) continue
      let key = `${lv.id}/${kind}/${name}`
      let salt = hashOf(key)
      let [px, pz] = place.at
      let own = (x: number, z: number) => {
        let d = Math.hypot(x - px, z - pz)
        return d <= t.within &&
          places.every(([, p]) =>
            p.kind == place.kind || Math.hypot(x - p.at[0], z - p.at[1]) > d
          )
      }
      let n = 0
      for (let tries = 0; n < t.count && tries < 3000; tries++) {
        let x = px + (rand(tries, salt, 1) * 2 - 1) * t.within
        let z = pz + (rand(tries, salt, 2) * 2 - 1) * t.within
        if (x < 6 || z < 6 || x > SIZE - 6 || z > SIZE - 6) continue
        if (!own(x, z)) continue
        if (
          homes.some(([, h]) => Math.hypot(x - h.at[0], z - h.at[1]) < HOMELY)
        ) {
          continue
        }
        if (
          v.roads.some((r) => Math.hypot(x - r.door[0], z - r.door[1]) < DOOR)
        ) {
          continue
        }
        if (out.some((o) => Math.hypot(o.x - x, o.z - z) < t.apart)) continue
        if (!fits(x, z)) continue
        let [sx, sz] = [Math.round(x * 4) / 4, Math.round(z * 4) / 4]
        out.push({
          eid: uuidOf(`${key}@${sx},${sz}`),
          lode: kind,
          x: sx,
          z: sz,
        })
        n++
      }
    }
  }
  placed.set(v, out)
  return out
}

/** The xp a level of a trade takes, counted from nothing.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([tradeNeed(1), tradeNeed(2), tradeNeed(3)], [0, 10, 40])
 * assertEquals(tradeLevel(tradeNeed(5)), 5)
 * assertEquals(tradeLevel(tradeNeed(5) - 1), 4)
 * ```
 */
export let tradeNeed = (lvl: number): number => 10 * (lvl - 1) ** 2

export let tradeLevel = (xp: number): number => {
  let l = 1
  while (xp >= tradeNeed(l + 1)) l++
  return l
}

/** The least level of its trade a node of `tier` asks: a tier every two
 * levels. */
export let least = (tier: number): number => 2 * tier - 1

/** What working a node of `tier` is worth to its trade. */
export let tradeXp = (tier: number): number => 5 * tier

export type Trades = Record<Trade, { xp: number; lvl: number }>

/** A hero's trades, from the kinds of node their gathered rows name: a
 * handful of oaks makes a woodcutter who can fell pines.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let t = tradesOf([...Array(8).fill('oak'), 'perch', 'nothing'])
 * assertEquals(t.wood, { xp: 40, lvl: 3 })
 * assertEquals(t.fish, { xp: 5, lvl: 1 })
 * assertEquals(t.wood.lvl >= least(LODES.pine.tier), true)
 * ```
 */
export let tradesOf = (kinds: string[]): Trades => {
  let xp: Record<Trade, number> = { wood: 0, ore: 0, herb: 0, fish: 0 }
  for (let k of kinds) {
    let l = LODES[k]
    if (l) xp[l.trade] += tradeXp(l.tier)
  }
  let at = (t: Trade) => ({ xp: xp[t], lvl: tradeLevel(xp[t]) })
  return {
    wood: at('wood'),
    ore: at('ore'),
    herb: at('herb'),
    fish: at('fish'),
  }
}

/** How long working a node takes a hero whose trade is at `lvl`, in ms: a
 * moment more for each tier, as long again for a shoal to bite, and less the
 * further the hero's trade is past what the node asks, down to two thirds.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * let oak = LODES.oak
 * assert(effort(oak, 1) > effort(oak, 6))
 * assert(effort(LODES.perch, 1) > effort(oak, 1))
 * ```
 */
export let effort = (lode: Lode, lvl: number): number =>
  Math.round(
    (1300 + 300 * lode.tier) * TRADES[lode.trade].work *
      Math.max(2 / 3, 1 - (lvl - least(lode.tier)) * 0.05),
  )

/** How many of what it gives a node yields a hero at one gathering: one, and
 * now and then two for a hero whose trade is past what the node asks, the
 * further past the more often, to one time in two. The same on every page
 * that asks.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let hauls = (lvl: number) =>
 *   Array.from({ length: 200 }, (_, i) => haulOf('n', i, 'p', 'oak', lvl))
 * assertEquals(new Set(hauls(1)), new Set([1]))
 * assertEquals(new Set(hauls(9)), new Set([1, 2]))
 * assertEquals(haulOf('n', 7, 'p', 'oak', 9), haulOf('n', 7, 'p', 'oak', 9))
 * ```
 */
export let haulOf = (
  node: string,
  at: number,
  player: string,
  kind: string,
  lvl: number,
): number => {
  let l = LODES[kind]
  let past = l ? lvl - least(l.tier) : 0
  let odds = Math.min(0.5, past * 0.08)
  return rand(hashOf(`${node}:${at}:${player}`), 3) < odds ? 2 : 1
}
