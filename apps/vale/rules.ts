// The rules of the vale, as plain functions over plain rows: when a creature
// is down, how hurt it is, what a level of experience takes, what a fall
// leaves, where a quest stands. Nothing here touches the page or the network,
// so every page reaches the same answer from the same rows. What there is to
// fight, carry and do is data of its own: beasts.ts, items.ts, quests.ts.
import { BEASTS } from './beasts.ts'
import { ITEMS } from './items.ts'
import type { Quest } from './quests.ts'
import { hashOf, noise, stream } from './rand.ts'

/** The xp a level of experience takes, counted from nothing.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(need(1), 0)
 * assertEquals(levelOf(need(4)), 4)
 * assertEquals(levelOf(need(4) - 1), 3)
 * ```
 */
export let need = (lvl: number): number => Math.round(40 * (lvl - 1) ** 1.7)

export let levelOf = (xp: number): number => {
  let l = 1
  while (xp >= need(l + 1)) l++
  return l
}

export let maxHp = (lvl: number): number => 90 + lvl * 16

/** The damage one blow does, before the dice. */
export let power = (lvl: number, edge = 1): number => (9 + lvl * 3) * edge

/** A blow's damage: power, give or take a fifth, and now and then a great
 * one. `roll` is a number in [0, 1). */
export let blow = (lvl: number, edge: number, roll: number) => {
  let great = roll > 0.88
  let base = power(lvl, edge) * (0.8 + (roll % 0.1) * 4)
  return { dmg: Math.round(base * (great ? 1.8 : 1)), great }
}

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

/** What a fall leaves one player to pick up: the same for every page that
 * asks, and different for every player.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(lootOf('boar', 'c1', 5, 'p1'), lootOf('boar', 'c1', 5, 'p1'))
 * ```
 */
export let lootOf = (
  kind: string,
  creature: string,
  fell: number,
  player: string,
): { kind: string; n: number }[] => {
  let r = stream(hashOf(`${creature}:${fell}:${player}`))
  let beast = BEASTS[kind]
  return (beast?.loot ?? []).flatMap(([item, chance]) =>
    r() < chance
      ? [{
        kind: item,
        n: item == 'coin' ? 1 + Math.floor(r() * beast.lvl * 3) : 1,
      }]
      : []
  )
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

/** How much a player has earned: what they helped slay, and the quests they
 * finished. */
export let xpOf = (kills: Slain[], quests: Quest[], journal: Entry[]) => {
  let done = new Set(
    journal.filter((e) => e.step == 'done').map((e) => e.quest),
  )
  return kills.reduce((n, k) => n + k.xp, 0) +
    quests.filter((q) => done.has(q.id)).reduce((n, q) => n + q.xp, 0)
}

/** The keenest blade a player carries. */
export let edgeOf = (bag: Held[]) =>
  bag.reduce((e, b) => Math.max(e, ITEMS[b.kind]?.edge ?? 1), 1)
