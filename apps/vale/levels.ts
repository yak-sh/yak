// The levels: each a place of its own, grown from its seed and its places by
// terrain.ts, so every page grows the same one and none of it is stored. A
// place is a kind of ground (features.ts: a village, woods, a marsh,
// dunes, a volcano, ruins, …) at a point; the creatures that live around each
// kind come from beasts.ts, the people who stand at them from quests.ts. A
// kind that spreads over a whole level (a marsh, a moor, dunes, snow, ash)
// sets its mood, and the smaller places stand in it.
//
// Roads join levels. Each runs from where a hero arrives out to the middle of
// one side of the level, and walking off the end of it comes in on the road
// back, at the middle of the opposite side of the level beyond: the east road
// leads to a level whose west road leads back. Every level is reached from
// Mossvale, and the further from it, the wilder. A new level is a row here.

/** A point on a level's ground, in metres `[east, south]` from its
 * north-west corner; a level is 128 m on a side (terrain.ts `SIZE`). */
export type Spot = [number, number]

export type Place = { kind: string; at: Spot }

/** A side of a level. */
export type Side = 'north' | 'east' | 'south' | 'west'

/** Each side of a level, and the side across from it. */
export let ACROSS: Record<Side, Side> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
}

export type Level = {
  id: string
  name: string
  /** what the noise is salted with; 0 grows Mossvale as it always was */
  seed: number
  /** where a new hero first stands, and where the roads start: one of the
   * places */
  arrive: string
  places: Record<string, Place>
  /** the level each side's road leads to */
  roads: Partial<Record<Side, string>>
}

// Each level as written, by its id.
let ROWS: Record<string, Omit<Level, 'id'>> = {
  // Home: the vale, and the gentle country round it.
  mossvale: {
    name: 'Mossvale',
    seed: 0,
    arrive: 'plaza',
    places: {
      crags: { kind: 'crags', at: [30, 98] },
      ridge: { kind: 'ridge', at: [102, 100] },
      woods: { kind: 'woods', at: [66, 25] },
      lake: { kind: 'lake', at: [26, 49] },
      fields: { kind: 'fields', at: [99, 52] },
      plaza: { kind: 'village', at: [64, 64] },
    },
    roads: {
      north: 'fernwood',
      east: 'reedmarsh',
      south: 'stonestep',
      west: 'birchmere',
    },
  },
  birchmere: {
    name: 'Birchmere',
    seed: 7,
    arrive: 'green',
    places: {
      mere: { kind: 'lake', at: [48, 75] },
      woods: { kind: 'woods', at: [85, 35] },
      east: { kind: 'woods', at: [98, 85] },
      fields: { kind: 'fields', at: [40, 35] },
      green: { kind: 'village', at: [69, 62] },
    },
    roads: {
      north: 'clovermead',
      east: 'mossvale',
      west: 'gullwick',
    },
  },
  clovermead: {
    name: 'Clovermead',
    seed: 11,
    arrive: 'meadow',
    places: {
      meadow: { kind: 'meadow', at: [60, 62] },
      woods: { kind: 'woods', at: [34, 38] },
      pond: { kind: 'lake', at: [90, 86] },
      copse: { kind: 'woods', at: [98, 40] },
    },
    roads: {
      east: 'fernwood',
      south: 'birchmere',
    },
  },
  // North: the green woods, then the pines, and the snow beyond.
  fernwood: {
    name: 'Fernwood',
    seed: 13,
    arrive: 'glade',
    places: {
      woods: { kind: 'woods', at: [40, 36] },
      deep: { kind: 'woods', at: [94, 42] },
      meadow: { kind: 'meadow', at: [36, 88] },
      pond: { kind: 'lake', at: [90, 90] },
      glade: { kind: 'village', at: [62, 66] },
    },
    roads: {
      north: 'elderglade',
      east: 'greypine',
      south: 'mossvale',
      west: 'clovermead',
    },
  },
  elderglade: {
    name: 'Elderglade',
    seed: 17,
    arrive: 'heart',
    places: {
      heart: { kind: 'woods', at: [64, 62] },
      west: { kind: 'woods', at: [34, 40] },
      east: { kind: 'woods', at: [94, 84] },
      pool: { kind: 'lake', at: [38, 90] },
      meadow: { kind: 'meadow', at: [92, 36] },
    },
    roads: {
      south: 'fernwood',
      west: 'glowcap',
    },
  },
  greypine: {
    name: 'Greypine',
    seed: 19,
    arrive: 'pines',
    places: {
      pines: { kind: 'pinewood', at: [60, 58] },
      tarn: { kind: 'lake', at: [90, 84] },
      crags: { kind: 'crags', at: [34, 92] },
      high: { kind: 'pinewood', at: [96, 34] },
    },
    roads: {
      east: 'wolfden',
      west: 'fernwood',
    },
  },
  wolfden: {
    name: 'Wolfden',
    seed: 23,
    arrive: 'pines',
    places: {
      pines: { kind: 'pinewood', at: [50, 50] },
      crags: { kind: 'crags', at: [92, 40] },
      scree: { kind: 'crags', at: [44, 96] },
      tarn: { kind: 'lake', at: [94, 90] },
    },
    roads: {
      east: 'frostmoor',
      west: 'greypine',
    },
  },
  // West: the wetlands, sinking into bog.
  reedmarsh: {
    name: 'Reedmarsh',
    seed: 29,
    arrive: 'stilts',
    places: {
      marsh: { kind: 'marsh', at: [60, 64] },
      meadow: { kind: 'meadow', at: [40, 36] },
      pool: { kind: 'lake', at: [36, 90] },
      woods: { kind: 'woods', at: [96, 90] },
      stilts: { kind: 'village', at: [70, 56] },
    },
    roads: {
      south: 'mirewood',
      west: 'mossvale',
    },
  },
  mirewood: {
    name: 'Mirewood',
    seed: 31,
    arrive: 'marsh',
    places: {
      marsh: { kind: 'marsh', at: [60, 64] },
      woods: { kind: 'woods', at: [92, 40] },
      west: { kind: 'woods', at: [36, 36] },
      pool: { kind: 'lake', at: [88, 92] },
    },
    roads: {
      north: 'reedmarsh',
      south: 'fenhollow',
    },
  },
  fenhollow: {
    name: 'Fenhollow',
    seed: 37,
    arrive: 'marsh',
    places: {
      marsh: { kind: 'marsh', at: [64, 64] },
      ruins: { kind: 'ruins', at: [44, 44] },
      pool: { kind: 'lake', at: [92, 86] },
      moor: { kind: 'moor', at: [94, 38] },
    },
    roads: {
      north: 'mirewood',
      south: 'sunkenkirk',
    },
  },
  sunkenkirk: {
    name: 'Sunken Kirk',
    seed: 41,
    arrive: 'kirk',
    places: {
      marsh: { kind: 'marsh', at: [64, 66] },
      kirk: { kind: 'ruins', at: [60, 48] },
      chapel: { kind: 'ruins', at: [90, 88] },
      pool: { kind: 'lake', at: [36, 86] },
      mere: { kind: 'lake', at: [34, 40] },
    },
    roads: {
      north: 'fenhollow',
      east: 'bogheart',
      west: 'oldwall',
    },
  },
  bogheart: {
    name: 'Bogheart',
    seed: 43,
    arrive: 'marsh',
    places: {
      marsh: { kind: 'marsh', at: [64, 64] },
      pool: { kind: 'lake', at: [40, 92] },
      mere: { kind: 'lake', at: [34, 38] },
      toadstools: { kind: 'shroomwood', at: [94, 40] },
    },
    roads: {
      east: 'sporefen',
      west: 'sunkenkirk',
    },
  },
  // East: the sea, its cliffs and its islands.
  gullwick: {
    name: 'Gullwick',
    seed: 47,
    arrive: 'harbour',
    places: {
      coast: { kind: 'coast', at: [66, 14] },
      meadow: { kind: 'meadow', at: [36, 40] },
      woods: { kind: 'woods', at: [36, 92] },
      harbour: { kind: 'village', at: [60, 62] },
    },
    roads: {
      east: 'birchmere',
      south: 'saltreach',
      west: 'driftwood',
    },
  },
  saltreach: {
    name: 'Saltreach',
    seed: 53,
    arrive: 'moor',
    places: {
      coast: { kind: 'coast', at: [108, 76] },
      moor: { kind: 'moor', at: [62, 56] },
      crags: { kind: 'crags', at: [30, 50] },
      head: { kind: 'crags', at: [98, 44] },
    },
    roads: {
      north: 'gullwick',
      south: 'shellstrand',
    },
  },
  shellstrand: {
    name: 'Shellstrand',
    seed: 59,
    arrive: 'isles',
    places: {
      isles: { kind: 'isles', at: [64, 64] },
      coast: { kind: 'coast', at: [100, 96] },
      meadow: { kind: 'meadow', at: [36, 40] },
    },
    roads: {
      north: 'saltreach',
      east: 'stormhead',
    },
  },
  driftwood: {
    name: 'Driftwood Bay',
    seed: 61,
    arrive: 'wharf',
    places: {
      coast: { kind: 'coast', at: [20, 64] },
      woods: { kind: 'woods', at: [92, 38] },
      meadow: { kind: 'meadow', at: [92, 92] },
      wharf: { kind: 'village', at: [68, 66] },
    },
    roads: {
      east: 'gullwick',
      south: 'dustmere',
    },
  },
  stormhead: {
    name: 'Stormhead',
    seed: 67,
    arrive: 'moor',
    places: {
      coast: { kind: 'coast', at: [64, 18] },
      moor: { kind: 'moor', at: [64, 60] },
      crags: { kind: 'crags', at: [38, 84] },
      head: { kind: 'crags', at: [96, 80] },
    },
    roads: {
      west: 'shellstrand',
    },
  },
  // South: the moors and the ruins of an old kingdom, then the fire.
  stonestep: {
    name: 'Stonestep',
    seed: 71,
    arrive: 'steps',
    places: {
      moor: { kind: 'moor', at: [84, 40] },
      crags: { kind: 'crags', at: [36, 36] },
      meadow: { kind: 'meadow', at: [36, 90] },
      woods: { kind: 'woods', at: [96, 92] },
      steps: { kind: 'village', at: [60, 64] },
    },
    roads: {
      north: 'mossvale',
      south: 'heatherfell',
    },
  },
  heatherfell: {
    name: 'Heatherfell',
    seed: 73,
    arrive: 'moor',
    places: {
      moor: { kind: 'moor', at: [64, 64] },
      fell: { kind: 'crags', at: [92, 36] },
      scree: { kind: 'crags', at: [36, 92] },
      tarn: { kind: 'lake', at: [38, 40] },
    },
    roads: {
      north: 'stonestep',
      south: 'oldwall',
    },
  },
  oldwall: {
    name: 'Oldwall',
    seed: 79,
    arrive: 'ruins',
    places: {
      moor: { kind: 'moor', at: [50, 78] },
      ruins: { kind: 'ruins', at: [64, 56] },
      crags: { kind: 'crags', at: [96, 40] },
      woods: { kind: 'woods', at: [96, 94] },
      tarn: { kind: 'lake', at: [30, 40] },
    },
    roads: {
      north: 'heatherfell',
      east: 'sunkenkirk',
      west: 'kingsbarrow',
    },
  },
  kingsbarrow: {
    name: 'Kingsbarrow',
    seed: 83,
    arrive: 'moor',
    places: {
      moor: { kind: 'moor', at: [64, 64] },
      barrow: { kind: 'ruins', at: [60, 42] },
      hall: { kind: 'ruins', at: [88, 84] },
      crags: { kind: 'crags', at: [34, 34] },
      scree: { kind: 'crags', at: [36, 94] },
    },
    roads: {
      east: 'oldwall',
      west: 'giantsteps',
    },
  },
  giantsteps: {
    name: 'Giantsteps',
    seed: 89,
    arrive: 'moor',
    places: {
      moor: { kind: 'moor', at: [64, 64] },
      crags: { kind: 'crags', at: [40, 40] },
      steps: { kind: 'crags', at: [92, 92] },
      fell: { kind: 'crags', at: [96, 34] },
      scree: { kind: 'crags', at: [34, 94] },
    },
    roads: {
      east: 'kingsbarrow',
      west: 'emberfall',
    },
  },
  // Under the old woods: giant toadstools, then crystal.
  glowcap: {
    name: 'Glowcap Hollow',
    seed: 97,
    arrive: 'hollow',
    places: {
      toadstools: { kind: 'shroomwood', at: [64, 64] },
      pool: { kind: 'lake', at: [92, 40] },
      mere: { kind: 'lake', at: [36, 90] },
      hollow: { kind: 'village', at: [56, 70] },
    },
    roads: {
      east: 'elderglade',
      south: 'sporefen',
      west: 'gleamdeep',
    },
  },
  sporefen: {
    name: 'Sporefen',
    seed: 101,
    arrive: 'toadstools',
    places: {
      marsh: { kind: 'marsh', at: [60, 80] },
      toadstools: { kind: 'shroomwood', at: [64, 56] },
      east: { kind: 'shroomwood', at: [96, 36] },
      pool: { kind: 'lake', at: [30, 40] },
    },
    roads: {
      north: 'glowcap',
      west: 'bogheart',
    },
  },
  gleamdeep: {
    name: 'Gleamdeep',
    seed: 103,
    arrive: 'toadstools',
    places: {
      toadstools: { kind: 'shroomwood', at: [64, 64] },
      gleam: { kind: 'crystals', at: [44, 44] },
      deep: { kind: 'crystals', at: [90, 86] },
      pool: { kind: 'lake', at: [92, 36] },
    },
    roads: {
      north: 'shardvault',
      east: 'glowcap',
    },
  },
  shardvault: {
    name: 'Shardvault',
    seed: 107,
    arrive: 'vault',
    places: {
      toadstools: { kind: 'shroomwood', at: [64, 70] },
      vault: { kind: 'crystals', at: [64, 60] },
      west: { kind: 'crystals', at: [38, 40] },
      east: { kind: 'crystals', at: [92, 88] },
      north: { kind: 'crystals', at: [96, 36] },
    },
    roads: {
      east: 'icefall',
      south: 'gleamdeep',
    },
  },
  // Beyond the sea: the desert, its mesas and its tombs.
  dustmere: {
    name: 'Dustmere',
    seed: 109,
    arrive: 'well',
    places: {
      dunes: { kind: 'dunes', at: [64, 64] },
      mesa: { kind: 'mesa', at: [96, 36] },
      oasis: { kind: 'oasis', at: [90, 88] },
      well: { kind: 'village', at: [58, 62] },
    },
    roads: {
      north: 'driftwood',
      south: 'sunscar',
      west: 'palmwell',
    },
  },
  palmwell: {
    name: 'Palmwell',
    seed: 113,
    arrive: 'camp',
    places: {
      dunes: { kind: 'dunes', at: [64, 64] },
      oasis: { kind: 'oasis', at: [50, 52] },
      mesa: { kind: 'mesa', at: [96, 96] },
      camp: { kind: 'village', at: [72, 72] },
    },
    roads: {
      east: 'dustmere',
      south: 'redmesa',
    },
  },
  sunscar: {
    name: 'Sunscar Dunes',
    seed: 127,
    arrive: 'dunes',
    places: {
      dunes: { kind: 'dunes', at: [64, 64] },
      east: { kind: 'dunes', at: [94, 40] },
      buried: { kind: 'ruins', at: [40, 40] },
      mesa: { kind: 'mesa', at: [96, 94] },
    },
    roads: {
      north: 'dustmere',
      west: 'redmesa',
    },
  },
  redmesa: {
    name: 'Redmesa',
    seed: 131,
    arrive: 'mesa',
    places: {
      dunes: { kind: 'dunes', at: [64, 64] },
      mesa: { kind: 'mesa', at: [64, 64] },
      west: { kind: 'mesa', at: [36, 36] },
      east: { kind: 'mesa', at: [94, 92] },
      oasis: { kind: 'oasis', at: [90, 40] },
    },
    roads: {
      north: 'palmwell',
      east: 'sunscar',
      west: 'tombsands',
    },
  },
  tombsands: {
    name: 'Tombsands',
    seed: 137,
    arrive: 'tombs',
    places: {
      dunes: { kind: 'dunes', at: [64, 64] },
      tombs: { kind: 'ruins', at: [64, 48] },
      sunken: { kind: 'ruins', at: [38, 86] },
      mesa: { kind: 'mesa', at: [96, 92] },
    },
    roads: {
      east: 'redmesa',
      south: 'cinderreach',
    },
  },
  // The far north: snow, then ice.
  frostmoor: {
    name: 'Frostmoor',
    seed: 139,
    arrive: 'snow',
    places: {
      snow: { kind: 'snowfield', at: [64, 64] },
      pines: { kind: 'pinewood', at: [40, 40] },
      tarn: { kind: 'lake', at: [92, 86] },
      glacier: { kind: 'glacier', at: [96, 36] },
    },
    roads: {
      south: 'rimeholt',
      west: 'wolfden',
    },
  },
  rimeholt: {
    name: 'Rimeholt',
    seed: 149,
    arrive: 'holt',
    places: {
      snow: { kind: 'snowfield', at: [64, 64] },
      tarn: { kind: 'lake', at: [36, 40] },
      pines: { kind: 'pinewood', at: [96, 90] },
      glacier: { kind: 'glacier', at: [96, 34] },
      holt: { kind: 'village', at: [62, 62] },
    },
    roads: {
      north: 'frostmoor',
      east: 'frostpine',
      south: 'icefall',
    },
  },
  frostpine: {
    name: 'Frostpine',
    seed: 151,
    arrive: 'snow',
    places: {
      snow: { kind: 'snowfield', at: [64, 64] },
      pines: { kind: 'pinewood', at: [60, 38] },
      east: { kind: 'pinewood', at: [92, 84] },
      tarn: { kind: 'lake', at: [36, 86] },
    },
    roads: {
      west: 'rimeholt',
    },
  },
  icefall: {
    name: 'Icefall',
    seed: 157,
    arrive: 'snow',
    places: {
      snow: { kind: 'snowfield', at: [64, 64] },
      glacier: { kind: 'glacier', at: [82, 36] },
      west: { kind: 'glacier', at: [36, 44] },
      south: { kind: 'glacier', at: [36, 92] },
      tarn: { kind: 'lake', at: [94, 90] },
    },
    roads: {
      north: 'rimeholt',
      east: 'whitepeak',
      west: 'shardvault',
    },
  },
  whitepeak: {
    name: 'Whitepeak',
    seed: 163,
    arrive: 'snow',
    places: {
      snow: { kind: 'snowfield', at: [64, 72] },
      glacier: { kind: 'glacier', at: [64, 50] },
      west: { kind: 'glacier', at: [34, 38] },
      east: { kind: 'glacier', at: [96, 94] },
    },
    roads: {
      west: 'icefall',
    },
  },
  // The far south: ash and fire, and the Maw at the end of it.
  emberfall: {
    name: 'Emberfall',
    seed: 167,
    arrive: 'forge',
    places: {
      ash: { kind: 'ashfield', at: [64, 64] },
      volcano: { kind: 'volcano', at: [96, 34] },
      moor: { kind: 'moor', at: [30, 40] },
      forge: { kind: 'village', at: [58, 70] },
    },
    roads: {
      east: 'giantsteps',
      west: 'cinderreach',
    },
  },
  cinderreach: {
    name: 'Cinderreach',
    seed: 173,
    arrive: 'ash',
    places: {
      ash: { kind: 'ashfield', at: [64, 64] },
      volcano: { kind: 'volcano', at: [38, 38] },
      cone: { kind: 'volcano', at: [96, 92] },
    },
    roads: {
      north: 'tombsands',
      east: 'emberfall',
      south: 'ashkeep',
      west: 'maw',
    },
  },
  ashkeep: {
    name: 'Ashkeep',
    seed: 179,
    arrive: 'keep',
    places: {
      ash: { kind: 'ashfield', at: [64, 64] },
      keep: { kind: 'ruins', at: [64, 54] },
      gate: { kind: 'ruins', at: [90, 88] },
      volcano: { kind: 'volcano', at: [36, 90] },
    },
    roads: {
      north: 'cinderreach',
    },
  },
  maw: {
    name: 'The Maw',
    seed: 181,
    arrive: 'ash',
    places: {
      ash: { kind: 'ashfield', at: [64, 70] },
      maw: { kind: 'volcano', at: [64, 50] },
      cone: { kind: 'volcano', at: [30, 88] },
    },
    roads: {
      east: 'cinderreach',
    },
  },
}

/** Every level, by its id. Every road has a road back on the side across,
 * every level is reached from Mossvale, and every place is a kind of ground
 * terrain.ts grows.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { FEATURES } from './features.ts'
 * let lvs = Object.values(LEVELS)
 * let roads = (lv: Level) => Object.entries(lv.roads) as [Side, string][]
 * let oneWay = lvs.flatMap((lv) =>
 *   roads(lv).filter(([side, to]) => LEVELS[to]?.roads[ACROSS[side]] != lv.id)
 * )
 * assertEquals(oneWay, [])
 * assertEquals(Object.keys(HOPS).length, lvs.length)
 * let unknown = lvs.flatMap((lv) =>
 *   Object.values(lv.places).filter((p) => !FEATURES[p.kind])
 * )
 * assertEquals(unknown, [])
 * assertEquals(lvs.filter((lv) => !lv.places[lv.arrive]), [])
 * ```
 */
export let LEVELS: Record<string, Level> = Object.fromEntries(
  Object.entries(ROWS).map(([id, lv]) => [id, { id, ...lv }]),
)

/** Where a new hero first stands. */
export let HOME = 'mossvale'

/** How many roads each level lies from home, and so how dangerous it is:
 * the creatures that live in it climb with it (homes.ts `suits`).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([HOPS.mossvale, HOPS.birchmere, HOPS.ashkeep], [0, 1, 8])
 * ```
 */
export let HOPS: Record<string, number> = ((hops: Record<string, number>) => {
  let queue = Object.keys(hops)
  for (let id of queue) {
    for (let to of Object.values(LEVELS[id].roads)) {
      if (hops[to] == undefined) {
        hops[to] = hops[id] + 1
        queue.push(to)
      }
    }
  }
  return hops
})({ [HOME]: 0 })
