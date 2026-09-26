// The rules of the vale, as plain functions over plain rows: when a creature
// is down, how hurt it is, what a level of experience takes, what a fall
// leaves, where a quest stands. Nothing here touches the page or the network,
// so every page reaches the same answer from the same rows. What there is to
// fight, carry and do is data of its own: beasts.ts, items.ts, quests.ts.
import { spoil, tierOf } from './arms.ts'
import { BEASTS } from './beasts.ts'
import type { Quest } from './quests.ts'
import { hashOf, noise, stream } from './rand.ts'

/** The xp a level of experience takes, counted from nothing. A creature's
 * xp grows about as its level does, and each level takes more of them than
 * the last: a handful of slimes for the second, a few dozen kills, half of
 * it from quests, for each level out by the Maw. The lands climb two
 * creature levels a hop from Mossvale, so a hero who does what a land asks
 * arrives at the next one about its level.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(need(1), 0)
 * assertEquals(levelOf(need(4)), 4)
 * assertEquals(levelOf(need(4) - 1), 3)
 * ```
 */
export let need = (lvl: number): number => Math.round(80 * (lvl - 1) ** 2.4)

export let levelOf = (xp: number): number => {
  let l = 1
  while (xp >= need(l + 1)) l++
  return l
}

export let maxHp = (lvl: number): number => 90 + lvl * 16

/** The damage one blow does, before the dice: more for a higher level, and
 * `dmg` times that for the weapon it is struck with (arms.ts).
 *
 * A hero who takes up what each land gives keeps pace with what lives there:
 * at a creature's level, with a plain sword of its country, they fell it in
 * a handful of blows, in every land, and in its country's plate they take
 * more of its bites to fall than they would bare. A boss wants friends.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * import { tierOf } from './arms.ts'
 * import { BEASTS } from './beasts.ts'
 * import { ITEMS } from './items.ts'
 * let plate = (t: number) => ['helm', 'cuirass', 'greaves'].map((n) => ITEMS[n + t])
 * for (let b of Object.values(BEASTS).filter((b) => !b.boss)) {
 *   let t = tierOf(b.lvl)
 *   let blows = b.hp / power(b.lvl, ITEMS[`sword${t}`].dmg)
 *   assert(blows > 1 && blows < 12, `${b.name}: ${blows} blows`)
 *   let armour = plate(t).reduce((n, p) => n + p.armour!, 0)
 *   let hp = plate(t).reduce((n, p) => n + p.hp!, maxHp(b.lvl))
 *   assert(hp / through(b.dmg, armour) > 1.4 * maxHp(b.lvl) / b.dmg, b.name)
 * }
 * ```
 */
export let power = (lvl: number, dmg = 1): number => (9 + lvl * 3) * dmg

/** A blow's damage: `might`, give or take a fifth, and now and then a great
 * one, more often with `luck`; a `sure` blow is always great. `roll` is a
 * number in [0, 1).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(blow(12, 0.95).great, true)
 * assertEquals(blow(12, 0.5).great, false)
 * assertEquals(blow(12, 0.5, true).great, true)
 * assertEquals(blow(12, 0.8, false, 0.1).great, true)
 * ```
 */
export let blow = (might: number, roll: number, sure = false, luck = 0) => {
  let great = sure || roll > 0.88 - luck
  let base = might * (0.8 + (roll % 0.1) * 4)
  return { dmg: Math.round(base * (great ? 1.8 : 1)), great }
}

/** What a bite of `dmg` takes from a hero wearing `armour`: the armour
 * turns that much of it, and never more than three quarters.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals([through(20, 0), through(20, 6), through(20, 30)], [20, 14, 5])
 * ```
 */
export let through = (dmg: number, armour: number): number =>
  Math.max(Math.ceil(dmg / 4), Math.round(dmg - armour))

export type Slain = {
  creature: string
  by: string
  kind: string
  at: number
  xp: number
}

/**
 * When a creature last fell, and whether it is still down. A fall is the
 * first slain row after it was last up; every row within its respawn of that
 * one is somebody else's share of the same fall.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let rows = [{ at: 1000 }, { at: 1500 }]
 * assertEquals(fallOf(rows, 20, 10000), { down: true, fell: 1000 })
 * assertEquals(fallOf(rows, 20, 30000), { down: false, fell: 1000 })
 * assertEquals(fallOf([...rows, { at: 40000 }], 20, 45000), {
 *   down: true,
 *   fell: 40000,
 * })
 * assertEquals(fallOf([], 20, 0), { down: false, fell: 0 })
 * ```
 */
export let fallOf = (
  rows: { at: number }[],
  respawn: number,
  now: number,
): { down: boolean; fell: number } => {
  let fell = 0
  for (let r of [...rows].sort((a, b) => a.at - b.at)) {
    if (!fell || r.at >= fell + respawn * 1000) fell = r.at
  }
  return { down: !!fell && now < fell + respawn * 1000, fell }
}

/** A player's fight: the creature, which of its lives, and the damage they
 * have dealt it in that life (the `fight` component). */
export type Fight = { foe: string; life: number; dmg: number }

/** A creature's hit points: its most, less what every player is dealing it in
 * this life.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let a = { foe: 'c1', life: 5, dmg: 10 }, b = { foe: 'c1', life: 5, dmg: 4 }
 * assertEquals(hpOf('c1', 32, 5, [a, b]), 18)
 * assertEquals(hpOf('c1', 32, 9, [a, b]), 32) // a new life starts whole
 * ```
 */
export let hpOf = (
  eid: string,
  most: number,
  life: number,
  fights: Fight[],
): number => {
  let dealt = 0
  for (let f of fights) if (f.foe == eid && f.life == life) dealt += f.dmg
  return Math.max(0, most - dealt)
}

/** Who a creature is after: the player dealing it most in this life. */
export let hunter = (
  eid: string,
  life: number,
  fights: [string, Fight][],
): string | null => {
  let best: string | null = null, most = 0
  for (let [who, f] of fights) {
    if (f.foe == eid && f.life == life && f.dmg > most) {
      most = f.dmg
      best = who
    }
  }
  return best
}

// How often a fall leaves a piece of gear of its country's tier (arms.ts); a
// boss always does.
let SPOILS = 0.08

/** What a fall leaves one player to pick up: the same for every page that
 * asks, and different for every player. Now and then, a piece of gear, most
 * often a weapon of the `family` they hold.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * import { ITEMS } from './items.ts'
 * assertEquals(lootOf('boar', 'c1', 5, 'p1'), lootOf('boar', 'c1', 5, 'p1'))
 * // The Cinder Wyrm always leaves gear of the last tier.
 * let wyrm = lootOf('cinderwyrm', 'c2', 5, 'p1').map((l) => ITEMS[l.kind])
 * assert(wyrm.some((t) => t.slot && t.tier == 5))
 * ```
 */
export let lootOf = (
  kind: string,
  creature: string,
  fell: number,
  player: string,
  family = '',
): { kind: string; n: number }[] => {
  let r = stream(hashOf(`${creature}:${fell}:${player}`))
  let beast = BEASTS[kind]
  let found = (beast?.loot ?? []).flatMap(([item, chance]) =>
    r() < chance
      ? [{
        kind: item,
        n: item == 'coin' ? 1 + Math.floor(r() * beast.lvl * 3) : 1,
      }]
      : []
  )
  if (beast && r() < (beast.boss ? 1 : SPOILS)) {
    found.push({ kind: spoil(tierOf(beast.lvl), r, family), n: 1 })
  }
  return found
}

/** Where a creature wanders when nothing is after it, as a function of time
 * alone, so every page puts it in the same place. */
export let wander = (
  home: [number, number],
  roam: number,
  seed: number,
  t: number,
): [number, number] => {
  let s = seed % 997
  let a = noise(t * 0.035, s, 7) * Math.PI * 4
  let r = roam * (0.25 + 0.75 * noise(t * 0.05, s + 13, 8))
  return [home[0] + Math.cos(a) * r, home[1] + Math.sin(a) * r]
}

export type Entry = { quest: string; step: string; at: number }
export type Held = { eid: string; kind: string; n: number }

/** Where one player stands with each quest, in the order given: done, taken
 * (with how far along), open to take once the quest it comes after is done,
 * or not yet.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let q = (id: string, after?: string) => ({
 *   id, giver: 'g', after, goal: 'gather' as const, target: 'jelly',
 *   count: 2, xp: 10, title: id, body: '',
 * })
 * let quests = [q('a'), q('b', 'a'), q('c')]
 * let states = (journal: Entry[]) =>
 *   questsOf(quests, journal, [], [{ eid: 'i', kind: 'jelly', n: 1 }])
 *     .map((s) => `${s.quest.id}:${s.state}:${s.have}`)
 * assertEquals(states([]), ['a:open:1', 'b:locked:1', 'c:open:1'])
 * assertEquals(
 *   states([{ quest: 'a', step: 'taken', at: 1 }, { quest: 'a', step: 'done', at: 2 }]),
 *   ['a:done:1', 'b:open:1', 'c:open:1'],
 * )
 * ```
 */
export let questsOf = (
  quests: Quest[],
  journal: Entry[],
  kills: Slain[],
  bag: Held[],
) => {
  let taken = new Map<string, number>()
  let done = new Set<string>()
  for (let e of journal) {
    if (e.step == 'taken') taken.set(e.quest, e.at)
    if (e.step == 'done') done.add(e.quest)
  }
  return quests.map((q) => {
    let state = done.has(q.id)
      ? 'done'
      : taken.has(q.id)
      ? 'taken'
      : !q.after || done.has(q.after)
      ? 'open'
      : 'locked'
    let since = taken.get(q.id) ?? Infinity
    let have = q.goal == 'slay'
      ? kills.filter((k) => k.kind == q.target && k.at >= since).length
      : bag.filter((b) => b.kind == q.target).reduce((n, b) => n + b.n, 0)
    return { quest: q, state, have: Math.min(have, q.count) }
  })
}

/** What a kill worth `xp` is to a hero of level `hero`, from a creature of
 * level `lvl`: all of it at their own level, a fifth more for each level
 * above them, to half again, and a fifth less for each level below, to
 * nothing five below. A hero outgrows a land by what it no longer teaches
 * them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(worth(100, 5, 5), 100)
 * assertEquals(worth(100, 3, 5), 60)
 * assertEquals(worth(100, 9, 5), 150)
 * assertEquals(worth(100, 1, 6), 0)
 * ```
 */
export let worth = (xp: number, lvl: number, hero: number): number =>
  Math.round(xp * Math.min(1.5, Math.max(0, 1 + (lvl - hero) / 5)))

/** How much a player has earned, in the order they earned it: each quest
 * they finished, once, and each kill they had a hand in, worth what it was
 * to the hero they were then.
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * import { BEASTS } from './beasts.ts'
 * let slimes = (n: number) =>
 *   Array.from({ length: n }, (_, i) => ({
 *     creature: `c${i}`, by: 'p', kind: 'slime', at: i, xp: 14,
 *   }))
 * // A handful of slimes makes a hero, and no number of them makes one
 * // more than five levels above a slime.
 * assert(levelOf(xpOf(slimes(10), [], [])) >= 2)
 * assertEquals(levelOf(xpOf(slimes(3000), [], [])), BEASTS.slime.lvl + 5)
 * ```
 */
export let xpOf = (kills: Slain[], quests: Quest[], journal: Entry[]) => {
  let reward = new Map(quests.map((q) => [q.id, q.xp]))
  let done = new Set<string>()
  let earned: { at: number; kill?: Slain; xp?: number }[] = [
    ...kills.map((kill) => ({ at: kill.at, kill })),
    ...journal.flatMap((e) => {
      if (e.step != 'done' || done.has(e.quest)) return []
      done.add(e.quest)
      return [{ at: e.at, xp: reward.get(e.quest) ?? 0 }]
    }),
  ]
  let xp = 0
  for (let e of earned.sort((a, b) => a.at - b.at)) {
    xp += e.kill
      ? worth(e.kill.xp, BEASTS[e.kill.kind]?.lvl ?? 1, levelOf(xp))
      : e.xp ?? 0
  }
  return xp
}
