// The creatures of the vale are store rows, seeded from seed/beasts/. A
// creature is an entity with whichever aspects it needs, each a component of
// its own: beast_design (what it is called, and for now how it is drawn),
// combat (how it fights), loot (what it leaves) and sounds (the sfx rows it
// cries and steps with). A creature without combat can't be fought.
//
// Where it lives is a den row of its own (homes.ts): every land whose habitat
// suits it and that has a place of the den's kind (levels.ts) grows that many
// of it around each one, or around the share of them its odds pick, so a new
// creature appears wherever it belongs without any level naming it. A
// creature with no den lives nowhere until it is spawned.
//
// Everything refers to a creature by its eid. Its alias key, such as
// beast:boar, is the readable name quests and seeds use (names.ts);
// `beastId` takes either. Body plans remain code in bodies/; a look picks one by name.
import { comp, num, str } from './bundle.ts'
import { named } from './names.ts'
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

/** How a creature fights, at its own level (vocab.json `combat`). */
export type Combat = {
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
  /** one of a kind, with a name to its plate */
  boss?: boolean
}

/** Where a creature lives (vocab.json `den`): around each place of a kind
 * (features.ts `FEATURES`), between `beyond` and `within` metres of it,
 * `apart` metres from its own kind, wandering `roam` metres from home, up
 * again `respawn` seconds after a fall. With `odds`, only around that share
 * of the places of the kind, each place picked by its own name and level. */
export type Den = {
  eid: string
  beast: string
  near: string
  count: number
  within: number
  beyond?: number
  apart: number
  roam: number
  odds?: number
  respawn: number
}

export type Beast = {
  eid: string
  name: string
  /** how big it is drawn, and how far a blow must reach it */
  size: number
  /** the colour of the dust a blow knocks off it */
  dust: number
  look: Look
  combat?: Combat
  /** item kinds (items.ts), each with the chance of one dropping */
  drops: [string, number][]
  /** the sfx rows it cries and steps with */
  cry?: string
  step?: string
  dens: Den[]
}

/** A creature as it fights in one land (danger.ts `foeAt`). */
export type Fighter = Beast & Combat

// Each consumer reads the same index, by eid. A store subscription replaces
// it, so a newly invented creature is visible without a reload.
export let BEASTS: Record<string, Beast> = {}

/** The eid of the creature an eid or an alias such as beast:boar names.
 *
 * ```ts
 * import { seedDesigns } from './designs_fixture.ts'
 * seedDesigns()
 * import { assertEquals } from '@std/assert'
 * let boar = beastId('beast:boar')!
 * assertEquals([BEASTS[boar].name, beastId(boar)], ['Bristleboar', boar])
 * assertEquals(beastId('beast:dragon'), undefined)
 * ```
 */
export let beastId = (ref: string): string | undefined => {
  let eid = BEASTS[ref] ? ref : named(ref)
  return eid && BEASTS[eid] ? eid : undefined
}

/** The creature an eid or an alias names. */
export let beastOf = (ref: string): Beast | undefined =>
  BEASTS[beastId(ref) ?? '']

let held = {
  beasts: [] as Bundle[],
  dens: [] as Bundle[],
}

let drops = (v: unknown): [string, number][] =>
  Array.isArray(v)
    ? v.flatMap((d) =>
      Array.isArray(d) && typeof d[0] == 'string' ? [[d[0], num(d[1])]] : []
    )
    : []

let denOf = (row: Bundle): Den[] => {
  let d = comp(row, 'den'), beast = str(d.beast)
  return beast
    ? [{
      eid: row.entity.eid,
      beast,
      near: str(d.near),
      count: num(d.count),
      within: num(d.within),
      ...d.beyond != null && { beyond: num(d.beyond) },
      apart: num(d.apart),
      roam: num(d.roam),
      ...d.odds != null && { odds: num(d.odds) },
      respawn: num(d.respawn),
    }]
    : []
}

let combatOf = (row: Bundle): Combat | undefined => {
  let f = row.combat ? comp(row, 'combat') : null
  return f
    ? {
      lvl: num(f.lvl, 1),
      hp: num(f.hp, 1),
      dmg: num(f.dmg),
      speed: num(f.speed),
      xp: num(f.xp),
      reach: num(f.reach, 1),
      aggro: num(f.aggro),
      ...f.boss == true && { boss: true },
    }
    : undefined
}

// The index again, from the rows held: a new object, so every cache read
// off the old one (homes.ts, danger.ts, stock.ts) is made again.
let index = () => {
  let dens = new Map<string, Den[]>()
  for (let d of held.dens.flatMap(denOf)) {
    dens.set(d.beast, [...dens.get(d.beast) ?? [], d])
  }
  BEASTS = Object.fromEntries(held.beasts.flatMap((row) => {
    let design = comp(row, 'beast_design'), name = str(design.name)
    if (!name) return []
    let eid = row.entity.eid, sounds = comp(row, 'sounds')
    let beast: Beast = {
      eid,
      name,
      size: num(design.size, 1),
      dust: num(design.dust),
      look: design.look as Look,
      combat: combatOf(row),
      drops: drops(comp(row, 'loot').drops),
      ...typeof sounds.cry == 'string' && { cry: sounds.cry },
      ...typeof sounds.step == 'string' && { step: sounds.step },
      dens: dens.get(eid) ?? [],
    }
    return [[eid, beast]]
  }))
}

// Install one kind of row. The same rows again keep the index, and so what is
// found from it (homes.ts).
let use = (kind: keyof typeof held) => (rows: Bundle[]) => {
  if (rows == held[kind]) return
  held[kind] = rows
  index()
}

/** Install the store's creatures: beast_design rows with their combat, loot and
 * sounds. */
export let useBeasts = use('beasts')

/** Install the store's den rows. */
export let useDens = use('dens')
