// The creatures of the vale: one row per kind. A row says what the creature
// is in a fight, what it leaves behind, where it lives, and how it is drawn:
// a body plan from bodies/ in colours of its own. The rows live in beasts/,
// a file for each kind of country: the meadows, the woods, the waters, the
// heights, the deep places under the woods, the sands, the frost and the
// fire. A new creature is a row there, and a new body plan, when none of the
// existing ones will do, is one more file in bodies/.
//
// Where it lives is by the kind of place (`haunts`) and by its level: every
// level whose danger it suits (homes.ts `suits`, two creature levels for each
// portal from home) and that has a place of that kind (levels.ts) grows that
// many of it around each one, or around the share of them its odds pick, so
// a new creature appears wherever it belongs without any level naming it.
import { DEEP } from './beasts/deep.ts'
import { FIRE } from './beasts/fire.ts'
import { FROST } from './beasts/frost.ts'
import { HEIGHTS } from './beasts/heights.ts'
import { MEADOW } from './beasts/meadow.ts'
import { SANDS } from './beasts/sands.ts'
import { WATERS } from './beasts/waters.ts'
import { WOODS } from './beasts/woods.ts'
import type { Biped } from './bodies/biped.ts'
import type { Bird } from './bodies/bird.ts'
import type { Crag } from './bodies/crag.ts'
import type { Crawler } from './bodies/crawler.ts'
import type { Flier } from './bodies/flier.ts'
import type { Hopper } from './bodies/hopper.ts'
import type { Quadruped } from './bodies/quadruped.ts'
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

export let BEASTS: Record<string, Beast> = {
  ...MEADOW,
  ...WOODS,
  ...WATERS,
  ...HEIGHTS,
  ...DEEP,
  ...SANDS,
  ...FROST,
  ...FIRE,
}
