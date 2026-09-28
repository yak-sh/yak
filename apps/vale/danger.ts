// A land gives its inhabitants their encounter level. Their species still
// decides where they live, how they fight, and what they leave. The same
// species can therefore remain recognizable on either side of a road while
// each land asks a stronger hero to cross it.
import { GRADE, tierOf } from './arms.ts'
import { type Beast, BEASTS } from './beasts.ts'
import { HOPS } from './levels.ts'
import { maxHp, need, power } from './progress.ts'

export let landLevel = (hops: number): number => Math.min(60, 1 + 7 * hops)

export let foeLevel = (b: Beast, hops: number): number =>
  Math.min(
    60,
    landLevel(hops) +
      Math.max(0, Math.min(6, b.lvl - (2 * hops + 1))),
  )

let oldGrade = (lvl: number): number =>
  GRADE[Math.min(4, Math.ceil(lvl / 4) - 1)]

let oldNeed = (lvl: number): number => 90 + lvl * 16
let oldPower = (lvl: number): number => 9 + lvl * 3
let gain = (lvl: number): number => need(lvl + 1) - need(lvl)

/** The numbers for a species in one land, preserving its own strength
 * relative to its neighbors on the old scale. */
export let foeAt = (b: Beast, hops: number): Beast => {
  let lvl = foeLevel(b, hops)
  let oldBlow = oldPower(b.lvl) * oldGrade(b.lvl)
  let newBlow = power(lvl) * GRADE[tierOf(lvl) - 1]
  return {
    ...b,
    lvl,
    hp: Math.max(1, Math.round(b.hp * newBlow / oldBlow * (b.boss ? 1.8 : 1))),
    dmg: Math.max(
      1,
      Math.round(
        b.dmg * 1.5 * maxHp(lvl) / oldNeed(b.lvl) * (b.boss ? 1.5 : 1),
      ),
    ),
    xp: Math.max(1, Math.round(b.xp * gain(lvl) / gain(b.lvl))),
  }
}

let cache = new Map<string, Beast>()

export let foeOf = (kind: string, level: string): Beast => {
  let key = `${kind}:${level}`
  let found = cache.get(key)
  if (found) return found
  let beast = foeAt(BEASTS[kind], HOPS[level] ?? 0)
  cache.set(key, beast)
  return beast
}

/** Far stronger foes conceal their level so a skull warns before a fight. */
export let skull = (foe: number, hero: number): boolean => foe - hero >= 10
