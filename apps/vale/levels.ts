// The levels: the lands of one world, each grown from its seed and its places
// by terrain.ts, so every page grows the same one and none of it is stored.
// Each lies in a cell of its own on a lattice of squares SIZE metres on a side
// (regions.ts), Mossvale's at the origin, and holds the ground nearer its
// places than any other level's: a region with a border as ragged as the
// ground's (regions.ts). A place is a kind of ground (features.ts: a village,
// woods, a marsh, dunes, a volcano, ruins, …) at a point; the creatures that
// live around each kind come from beasts.ts, the people who stand at them
// from quests.ts. A kind that spreads over a whole level (a marsh, a moor,
// dunes, snow, ash) sets its mood, and the smaller places stand in it.
//
// Roads join levels next to each other: each runs from where a hero arrives in
// the one to where they arrive in the other, and a level's road on a side
// leads to the level in the cell that way. Every level is reached from
// Mossvale, and the further from it by road, the wilder. A new level is a row
// in its land's file under levels/.
import type { Top } from './features.ts'
import { COAST } from './levels/coast.ts'
import { DEEP } from './levels/deep.ts'
import { FIRE } from './levels/fire.ts'
import { FROST } from './levels/frost.ts'
import { HILLS } from './levels/hills.ts'
import { MARSH } from './levels/marsh.ts'
import { SANDS } from './levels/sands.ts'
import { VALE } from './levels/vale.ts'

/** A point on the ground, in metres `[east, south]`: in a level's row, from
 * the north-west corner of its cell, which is SIZE metres on a side;
 * anywhere else, from the world's origin, the north-west corner of
 * Mossvale's. */
export type Spot = [number, number]

/** A level's side, and its cell's, in metres. */
export let SIZE = 256

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
  /** its cell on the lattice, `[east, south]` in cells from Mossvale's */
  cell: [number, number]
  /** where a new hero first stands, and where the roads start: one of the
   * places */
  arrive: string
  places: Record<string, Place>
  /** the level each side's road leads to */
  roads: Partial<Record<Side, string>>
  /** the kind of place the land is where none of its places holds, up to
   * the mountains at its rim: what covers it, grows and lies on it; grass,
   * oaks, pines and rock if none */
  wild?: string
  look?: Look
}

/** How a level looks beyond its shape: the colour of its ground by what tops
 * it (features.ts `Top`), and of its water, deep, shallow and the sheen on it;
 * the colour its sky, fog and light lean toward and how far, 0 to 1; how near
 * its haze closes in (2 is twice as near); and what drifts in its air (air.ts
 * `AIRS`). */
export type Look = {
  ground?: Partial<Record<keyof typeof Top, number>>
  water?: [number, number, number]
  sky?: number
  tint?: number
  haze?: number
  air?: string
}

/** A level as its land's file writes it. */
export type Row = Omit<Level, 'id'>

let ROWS: Record<string, Row> = {
  ...VALE,
  ...COAST,
  ...MARSH,
  ...HILLS,
  ...DEEP,
  ...SANDS,
  ...FROST,
  ...FIRE,
}

/** Every level, by its id. Every road has a road back on the side across,
 * and leads to a level in the next cell that way, a step aside at most;
 * every level has a cell of its own and is reached from Mossvale; and every
 * place, and each level's wild, is a kind of ground terrain.ts grows.
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
 * let STEP = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }
 * let astray = lvs.flatMap((lv) =>
 *   roads(lv).filter(([side, to]) => {
 *     let [dx, dz] = [0, 1].map((a) => LEVELS[to].cell[a] - lv.cell[a])
 *     let [sx, sz] = STEP[side]
 *     return sx ? dx != sx || Math.abs(dz) > 1 : dz != sz || Math.abs(dx) > 1
 *   })
 * )
 * assertEquals(astray, [])
 * assertEquals(new Set(lvs.map((lv) => `${lv.cell}`)).size, lvs.length)
 * assertEquals(Object.keys(HOPS).length, lvs.length)
 * let unknown = lvs.flatMap((lv) =>
 *   Object.values(lv.places).filter((p) => !FEATURES[p.kind])
 * )
 * assertEquals(unknown, [])
 * assertEquals(lvs.filter((lv) => lv.wild && !FEATURES[lv.wild]), [])
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
