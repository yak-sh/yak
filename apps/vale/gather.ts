// Gathering: each natural tree and rock is a node to chop or mine. Herbs and
// shoals remain placed nodes near fitting places. The four trades grow by
// working them, and every page names a node from where it stands.
//
// Working a node writes an item wearing a `gathered` row: the item is what the
// hero gets, and the row spends the node for everyone until it grows back, the
// way a `slain` row fells a creature (rules.ts `fallOf`). A hero's trades
// (trades.ts) are counted from the gathered rows on their items: each is xp in
// its node's trade. A low trade level makes harder nodes slow and less useful.
import { isA } from './features.ts'
import { HOPS, LEVELS } from './levels.ts'
import { hashOf, rand, uuidOf } from './rand.ts'
import { type Natural, NATURE } from './nature.ts'
import { nearby, originOf, regionOf } from './regions.ts'
import {
  type Prop,
  rise,
  SHORE,
  steep,
  vale,
  wallsNear,
  WATER,
} from './terrain.ts'
import { trodden } from './ways.ts'
import { type Gather, least } from './trades.ts'
import { pick, type Rarity } from './rarity.ts'

/** How each gathering trade works a node: what working one is called, how
 * near a hero must stand to work it, in metres, and how long the work takes
 * against a tree's; and for placed herbs and shoals, how many around each
 * place, within how many metres, and how far apart. Respawn is in seconds. */
export let GATHER: Record<Gather, {
  verb: string
  reach: number
  work: number
  count: number
  within: number
  apart: number
  respawn: number
}> = {
  wood: {
    verb: 'Chop',
    reach: 2.4,
    work: 1,
    count: 3,
    within: 24,
    apart: 7,
    respawn: 3600,
  },
  ore: {
    verb: 'Mine',
    reach: 2.2,
    work: 1.15,
    count: 2,
    within: 22,
    apart: 6,
    respawn: 3600,
  },
  herb: {
    verb: 'Pick',
    reach: 1.9,
    work: 0.7,
    count: 2,
    within: 26,
    apart: 6,
    respawn: 100,
  },
  fish: {
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
  trade: Gather
  tier: number
  gives: string
  near: string[]
  hops: [number, number]
  look: Look
}

/** The colour of the bits a stroke knocks off a node: chips of wood, grit of
 * the ore, leaves, spray. */
export let chipOf = (look: Look): number =>
  look.plan == 'tree'
    ? look.wood
    : look.plan == 'seam'
    ? look.vein
    : look.plan == 'herb'
    ? look.leaf
    : 0xe8f4ff

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
  copper: {
    name: 'Copper seam',
    trade: 'ore',
    tier: 1,
    gives: 'copper',
    near: ['crags', 'ridge'],
    hops: [0, 1],
    look: seam([0x8f8e86, 0xa3a198, 0x7f7e77], 0xc8783a),
  },
  iron: {
    name: 'Iron seam',
    trade: 'ore',
    tier: 2,
    gives: 'ore',
    near: ['crags', 'ridge'],
    hops: [2, 3],
    look: seam([0x6e6c68, 0x7e7c76, 0x5e5c58], 0xa86a4a),
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
export type Node = {
  eid: string
  lode: string
  x: number
  z: number
  prop?: Prop
  ground?: number
}

// How far from a village's middle no node grows, in metres.
let HOMELY = 16
// The directions a shoal looks for a bank to be fished from.
let ROUND = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2)

let placed = new Map<string, Node[]>()

/** Every herb and shoal a level grows, and where: for each kind that suits
 * the level, round each place of a kind it grows near, on
 * ground they can stand on (a shoal on deep water a hero can reach from the
 * bank) in the level's region, nearer that place than any place of another
 * kind, clear of trunks, rocks, roads and lanes, the village and each other.
 * Picked on the smooth ground, and each named by where it stands.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * let nodes = nodesOf('mossvale')
 * assert(nodes.length > 0)
 * // The same nodes, by the same names, however often asked.
 * assertEquals(nodesOf('mossvale'), nodes)
 * ```
 */
export let nodesOf = (id: string): Node[] => {
  let got = placed.get(id)
  if (got) return got
  let lv = LEVELS[id], hops = HOPS[id] ?? 0, v = vale()
  let [ox, oz] = originOf(id)
  let places = Object.entries(lv.places).map(([name, p]) => ({
    name,
    kind: p.kind,
    at: [ox + p.at[0], oz + p.at[1]],
  }))
  let homes = places.filter((p) => isA(p.kind, 'village'))
  let out: Node[] = []
  let dry = (x: number, z: number) => {
    let h = rise(x, z)
    return h > SHORE + 0.2 && h < 18 && steep(rise, x, z) < 1 &&
      !trodden(x, z) &&
      !wallsNear(v, x, z).some((w) => Math.hypot(w.x - x, w.z - z) < w.r + 1.2)
  }
  // Deep enough that nobody stands in it, with a bank or shallows within
  // reach.
  let wet = (x: number, z: number) =>
    rise(x, z) < WATER - 0.9 &&
    ROUND.some((a) =>
      rise(x + Math.cos(a) * 2.6, z + Math.sin(a) * 2.6) > WATER - 0.5
    )
  for (let [kind, lode] of Object.entries(LODES)) {
    if (lode.trade == 'wood' || lode.trade == 'ore') continue
    if (hops < lode.hops[0] || hops > lode.hops[1]) continue
    let t = GATHER[lode.trade]
    let fits = lode.trade == 'fish' ? wet : dry
    for (let place of places) {
      if (!lode.near.some((near) => isA(place.kind, near))) continue
      let key = `${id}/${kind}/${place.name}`
      let salt = hashOf(key)
      let [px, pz] = place.at
      let own = (x: number, z: number) => {
        let d = Math.hypot(x - px, z - pz)
        return d <= t.within &&
          places.every((p) =>
            p.kind == place.kind || Math.hypot(x - p.at[0], z - p.at[1]) > d
          )
      }
      let n = 0
      for (let tries = 0; n < t.count && tries < 3000; tries++) {
        let x = px + (rand(tries, salt, 1) * 2 - 1) * t.within
        let z = pz + (rand(tries, salt, 2) * 2 - 1) * t.within
        if (!own(x, z) || regionOf(x, z) != id) continue
        if (
          homes.some((h) => Math.hypot(x - h.at[0], z - h.at[1]) < HOMELY)
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
  placed.set(id, out)
  return out
}

// How far past its level's cell a node may grow, in metres: as far as a
// region reaches past its cell.
let PAST = 48

let near = nearby(nodesOf)

let wild = new WeakMap<Prop, Node>()
export let naturalEid = (prop: Prop): string =>
  uuidOf(`natural/${prop.kind}@${prop.x},${prop.z}`)
let wildNode = ({ prop, at }: Natural): Node => {
  let got = wild.get(prop)
  if (got) return got
  got = {
    eid: naturalEid(prop),
    lode: NATURE[prop.kind],
    x: prop.x,
    z: prop.z,
    prop,
    ground: at[1],
  }
  wild.set(prop, got)
  return got
}

/** The nodes within `r` metres of (x, z), as far as they are found yet: the
 * levels near are looked at one a call, nearest first. */
export let nodesNear = (
  x: number,
  z: number,
  r: number,
  natural: Natural[] = [],
  target?: string,
): Node[] => [
  ...(target
    ? []
    : near(x, z, r + PAST).filter((n) => Math.hypot(n.x - x, n.z - z) < r)),
  ...natural.filter(({ prop: p }) =>
    p.natural && NATURE[p.kind] &&
    (!target || naturalEid(p) == target) &&
    Math.hypot(p.x - x, p.z - z) < r
  ).map(wildNode),
]

let bonus: Record<Rarity, number> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 5,
  legendary: 8,
}

// A glint among ordinary trees is worth turning off the road for.
let NODE_ODDS = [0.95, 0.04, 0.008, 0.0018, 0.0002]

/** A node's rarity for this life, shared by everyone and rolled anew after
 * its last spent life. */
export let nodeRarity = (eid: string, fell: number): Rarity =>
  pick(NODE_ODDS, rand(hashOf(`${eid}:${fell}`)))

/** What working a node is worth to its trade. Low skill yields poor xp,
 * while rarity makes a find worth taking a detour for. */
export let gatherXp = (
  tier: number,
  rarity: Rarity = 'common',
  lvl = least(tier),
): number =>
  Math.max(
    1,
    Math.round(5 * tier * bonus[rarity] * Math.min(1, lvl / least(tier))),
  )

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
    (1300 + 300 * lode.tier) * GATHER[lode.trade].work *
      (lvl < least(lode.tier)
        ? 1 + 0.45 * (least(lode.tier) - lvl) ** 2
        : Math.max(2 / 3, 1 - (lvl - least(lode.tier)) * 0.05)),
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
  rarity: Rarity = 'common',
): number => {
  let l = LODES[kind]
  let past = l ? lvl - least(l.tier) : 0
  let odds = Math.min(0.5, past * 0.08)
  let extra = rand(hashOf(`${node}:${at}:${player}`), 3) < odds ? 1 : 0
  let rare = Math.max(0, bonus[rarity] - 1)
  let skill = l ? Math.min(1, lvl / least(l.tier)) : 1
  return 1 + (rare ? Math.max(1, Math.round(rare * skill)) : 0) + extra
}
