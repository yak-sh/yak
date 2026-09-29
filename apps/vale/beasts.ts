// The creatures of the vale are store rows, seeded from seed/beasts/.
// Each row says how it fights, what it leaves, where it lives, and how it is
// drawn. Body plans remain code in bodies/; a new kind picks one by name.
//
// Where it lives is by the kind of place (`haunts`) and by its level: every
// land whose habitat it suits (homes.ts `suits`) and that has a place of that
// kind (levels.ts) grows that
// many of it around each one, or around the share of them its odds pick, so
// a new creature appears wherever it belongs without any level naming it.
import { comp, str } from './bundle.ts'
import type { Bundle } from './net.ts'
import type { Biped } from './bodies/biped.ts'
import type { Bird } from './bodies/bird.ts'
import type { Crag } from './bodies/crag.ts'
import type { Crawler } from './bodies/crawler.ts'
import type { Flier } from './bodies/flier.ts'
import type { Hopper } from './bodies/hopper.ts'
import type { Quadruped } from './bodies/quadruped.ts'
import type { Seal } from './bodies/seal.ts'
import type { Serpent } from './bodies/serpent.ts'
import type { Slime } from './bodies/slime.ts'
import type { Wisp } from './bodies/wisp.ts'

/** Every body plan, by name, and what a look in it says. */
export type Plans = {
  biped: Biped
  bird: Bird
  crag: Crag
  crawler: Crawler
  flier: Flier
  hopper: Hopper
  quadruped: Quadruped
  seal: Seal
  serpent: Serpent
  slime: Slime
  wisp: Wisp
}

/** How a creature is drawn: which body plan, in which colours, and how many
 * times its plan's own size. */
export type Look = {
  [P in keyof Plans]: { plan: P; scale?: number } & Plans[P]
}[keyof Plans]

/** Where a creature lives: around each place of a kind (features.ts
 * `FEATURES`), between `beyond` and `within` metres of it, `apart` metres
 * from its own kind, wandering `roam` metres from home. With `odds`, only
 * around that share of the places of the kind, each place picked by its own
 * name and level. */
export type Haunt = {
  near: string
  count: number
  within: number
  beyond?: number
  apart: number
  roam: number
  odds?: number
}

export type Beast = {
  name: string
  lvl: number
  hp: number
  dmg: number
  /** metres a second when it means it */
  speed: number
  xp: number
  /** how close it must be to bite */
  reach: number
  /** how near a player wakes it; 0 is never, until struck */
  aggro: number
  /** seconds from a fall until it is up again */
  respawn: number
  /** item kinds (items.ts), each with the chance of one dropping */
  loot: [string, number][]
  /** how big it is drawn, and how far a blow must reach it */
  size: number
  /** the colour of the dust a blow knocks off it */
  dust: number
  haunts: Haunt[]
  look: Look
  /** one of a kind, with a name to its plate */
  boss?: boolean
}

// Each consumer reads the same index. The store subscription replaces it,
// so a newly invented kind is visible without a reload.
export let BEASTS: Record<string, Beast> = {}

/** Install the store's current creature designs. */
export let useBeasts = (rows: Bundle[]) => {
  BEASTS = Object.fromEntries(rows.flatMap((row) => {
    let design = comp(row, 'beast_design'), kind = str(design.kind)
    return kind ? [[kind, design as Beast]] : []
  }))
}
