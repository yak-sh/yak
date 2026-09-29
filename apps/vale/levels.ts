// The levels: the lands of one world, each grown from its seed and its places
// by terrain.ts. Their ground cover and look are store designs seeded from
// seed/themes.json, so every page and worker grows the same land.
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
// Mossvale, and the further from it by road, the wilder. The first 40 levels
// are rows under levels/; frontier.ts grows the rest from their cells.
import type { Top } from './features.ts'
import { comp, str } from './bundle.ts'
import { frontier, frontierCell, frontierId } from './frontier.ts'
import type { Bundle } from './net.ts'
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
  /** the authored theme whose places and cover grew a frontier land */
  source?: string
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
  /** the authored family's wildlife band, when distance sets danger alone */
  habitat?: number
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

/** A level's geography, as its land's file writes it. */
export type Row = Omit<Level, 'id' | 'wild' | 'look'>

/** The region's cover and look, authored or invented in the store. */
export type Theme = {
  land: string
  wild: string
  look?: Look
  /** an authored model for the unbounded frontier, in stable order */
  frontier?: number
}

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
 * import { seedThemes } from './themes_fixture.ts'
 * seedThemes()
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

let themes: Record<string, Theme> = {}
let frontierThemes: string[] = []

/** Replace the region themes with the store's current designs. */
export let useThemes = (rows: Bundle[]) => {
  let previous = frontierThemes.join(',')
  themes = Object.fromEntries(rows.flatMap((row) => {
    let design = comp(row, 'theme_design'), land = str(design.land)
    return land ? [[land, design as Theme]] : []
  }))
  LEVELS = Object.fromEntries(
    Object.entries(ROWS).map(([id, lv]) => [
      id,
      { id, ...lv, wild: themes[id]?.wild, look: themes[id]?.look },
    ]),
  )
  frontierThemes = Object.values(themes).filter((t) =>
    t.frontier != null && LEVELS[t.land]
  ).sort((a, b) => a.frontier! - b.frontier!).map((t) => t.land)
  cells = new Map(Object.values(LEVELS).map((lv) => [lv.cell.join(','), lv]))
  grown.clear()
  return previous != frontierThemes.join(',')
}

/** Where a new hero first stands. */
export let HOME = 'mossvale'

/** How many roads each level lies from home, and so how dangerous it is:
 * encounters scale with it (danger.ts `landLevel`).
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

let cells = new Map(Object.values(LEVELS).map((lv) => [lv.cell.join(','), lv]))
let grown = new Map<string, Level>()

/** The named land in a cell, authored or grown from its coordinates. */
export let levelAt = (gx: number, gz: number): Level => {
  let key = `${gx},${gz}`
  let known = cells.get(key)
  if (known) return known
  let got = grown.get(key)
  if (got) return got
  if (grown.size >= 256) grown.delete(grown.keys().next().value!)
  got = frontier(gx, gz, LEVELS, HOPS, frontierThemes)
  grown.set(key, got)
  return got
}

/** Resolve a land id without requiring an ever-growing table of regions. */
export let levelOf = (id: string): Level | undefined => {
  let cell = frontierCell(id)
  return LEVELS[id] ??
    (cell && frontierId(...cell) == id && !cells.has(cell.join(','))
      ? levelAt(...cell)
      : undefined)
}

/** Encounter distance from Mossvale, retaining authored roads' difficulty. */
export let hopsOf = (id: string): number => {
  if (HOPS[id] != undefined) return HOPS[id]
  let cell = frontierCell(id)
  return cell ? Math.max(1, Math.ceil(Math.hypot(...cell) * 1.5)) : 0
}
