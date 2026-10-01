// A land gives its inhabitants their encounter level. Their species still
// decides where they live, how they fight, and what they leave. The same
// species can therefore remain recognizable on either side of a road while
// each land asks a stronger hero to cross it.
import { GRADE, tierOf } from './arms.ts'
import { type Beast, BEASTS, type Combat, type Fighter } from './beasts.ts'
import { hopsOf } from './levels.ts'
import { maxHp, need, power } from './progress.ts'

export let landLevel = (hops: number): number => Math.min(60, 1 + 7 * hops)

export let foeLevel = (f: Combat, hops: number): number =>
  Math.min(
    60,
    landLevel(hops) +
      Math.max(0, Math.min(6, f.lvl - (2 * hops + 1))),
  )

let oldGrade = (lvl: number): number =>
  GRADE[Math.min(4, Math.ceil(lvl / 4) - 1)]

let oldNeed = (lvl: number): number => 90 + lvl * 16
let oldPower = (lvl: number): number => 9 + lvl * 3
let gain = (lvl: number): number => need(lvl + 1) - need(lvl)

/** A species' numbers at encounter level `lvl`, preserving its own strength
 * relative to its neighbors on the old scale. */
let scaled = (b: Beast, f: Combat, lvl: number): Fighter => {
  let oldBlow = oldPower(f.lvl) * oldGrade(f.lvl)
  let newBlow = power(lvl) * GRADE[tierOf(lvl) - 1]
  return {
    ...b,
    ...f,
    lvl,
    hp: Math.max(1, Math.round(f.hp * newBlow / oldBlow * (f.boss ? 1.8 : 1))),
    dmg: Math.max(
      1,
      Math.round(
        f.dmg * 1.5 * maxHp(lvl) / oldNeed(f.lvl) * (f.boss ? 1.5 : 1),
      ),
    ),
    xp: Math.max(1, Math.round(f.xp * gain(lvl) / gain(f.lvl))),
  }
}

/** The numbers for a species in one land; nothing for a creature that can't
 * be fought. */
export let foeAt = (b: Beast, hops: number): Fighter | undefined =>
  b.combat && scaled(b, b.combat, foeLevel(b.combat, hops))

let cache = new Map<string, Fighter | undefined>()
let from = BEASTS

// A creature's numbers, kept by `key` while the creature index stands.
let kept = (key: string, find: () => Fighter | undefined) => {
  if (from != BEASTS) {
    cache.clear()
    from = BEASTS
  }
  if (cache.has(key)) return cache.get(key)
  let found = find()
  if (cache.size >= 256) cache.delete(cache.keys().next().value!)
  cache.set(key, found)
  return found
}

/** A creature, by eid, as it fights in a land; nothing for one that can't
 * be fought, or that the store has not got. */
export let foeOf = (beast: string, level: string): Fighter | undefined =>
  kept(`${beast}:${level}`, () => {
    let b = BEASTS[beast]
    return b && foeAt(b, hopsOf(level))
  })

/** A creature, by eid, as it fights at encounter level `lvl`, wherever it
 * stands: what a spawned creature fights at, and what a creature already
 * met fights at again. The same numbers as {@link foeOf} gives for a land
 * whose level it is.
 *
 * ```ts
 * import { seedDesigns } from './designs_fixture.ts'
 * seedDesigns()
 * import { assertEquals } from '@std/assert'
 * import { beastId } from './beasts.ts'
 * let boar = beastId('beast:boar')!
 * let met = foeOf(boar, 'mossvale')!
 * assertEquals(fighter(boar, met.lvl), met)
 * assertEquals(fighter(boar, 30)!.lvl, 30)
 * assertEquals(fighter(boar, 30)!.hp > met.hp, true)
 * ```
 */
export let fighter = (beast: string, lvl: number): Fighter | undefined =>
  kept(`${beast}@${lvl}`, () => {
    let b = BEASTS[beast]
    return b?.combat && scaled(b, b.combat, lvl)
  })

/** Far stronger foes conceal their level so a skull warns before a fight. */
export let skull = (foe: number, hero: number): boolean => foe - hero >= 10
