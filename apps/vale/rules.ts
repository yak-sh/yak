// The rules of the vale, as plain functions over plain rows: what a creature
// is, when one is down, what a level takes, where a quest stands. Nothing here
// touches the page or the network, so every page reaches the same answer from
// the same rows.
import { hashOf, noise, stream } from './rand.ts'

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
  loot: [string, number][]
  /** how big it is drawn, and how far a blow must reach it */
  size: number
}

export let BEASTS: Record<string, Beast> = {
  slime: {
    name: 'Moss slime',
    lvl: 1,
    hp: 32,
    dmg: 4,
    speed: 2.2,
    xp: 14,
    reach: 1.3,
    aggro: 0,
    respawn: 20,
    loot: [['jelly', 0.8], ['coin', 0.5]],
    size: 0.9,
  },
  boar: {
    name: 'Bristleboar',
    lvl: 3,
    hp: 80,
    dmg: 8,
    speed: 4,
    xp: 34,
    reach: 1.7,
    aggro: 7,
    respawn: 30,
    loot: [['tusk', 0.65], ['coin', 0.7], ['tonic', 0.12]],
    size: 1.1,
  },
  crag: {
    name: 'Cragback',
    lvl: 5,
    hp: 170,
    dmg: 13,
    speed: 2.4,
    xp: 80,
    reach: 2,
    aggro: 6,
    respawn: 40,
    loot: [['shard', 0.6], ['coin', 0.9], ['tonic', 0.25]],
    size: 1.5,
  },
  thornback: {
    name: 'Old Thornback',
    lvl: 8,
    hp: 1100,
    dmg: 21,
    speed: 3.6,
    xp: 600,
    reach: 3,
    aggro: 10,
    respawn: 180,
    loot: [['crown', 1], ['coin', 1], ['tonic', 1]],
    size: 2.4,
  },
}

export type Thing = {
  name: string
  icon: string
  heals?: number
  edge?: number
}

export let ITEMS: Record<string, Thing> = {
  jelly: { name: 'Slime jelly', icon: '🟢' },
  tusk: { name: 'Boar tusk', icon: '🦷' },
  shard: { name: 'Crag shard', icon: '🔷' },
  crown: { name: 'Thorn crown', icon: '👑' },
  coin: { name: 'Coin', icon: '🪙' },
  tonic: { name: 'Mossberry tonic', icon: '🧪', heals: 60 },
  blade2: { name: 'Boarsbane', icon: '🗡️', edge: 1.4 },
  blade3: { name: 'Cragcleaver', icon: '⚔️', edge: 1.9 },
}

/** The xp a level takes, counted from nothing.
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

export type Pose = {
  x?: number
  y?: number
  z?: number
  yaw?: number
  gait?: string
  swing?: number
  hp?: number
  max?: number
  lvl?: number
  foe?: string
  dmg?: number
  life?: number
}

/** A creature's hit points: its most, less what every player is dealing it in
 * this life. */
export let hpOf = (
  eid: string,
  most: number,
  life: number,
  poses: Pose[],
): number => {
  let dealt = 0
  for (let p of poses) {
    if (p.foe == eid && (p.life ?? 0) == life) dealt += p.dmg ?? 0
  }
  return Math.max(0, most - dealt)
}

/** Who a creature is after: the player dealing it most in this life. */
export let hunter = (
  eid: string,
  life: number,
  poses: [string, Pose][],
): string | null => {
  let best: string | null = null, most = 0
  for (let [who, p] of poses) {
    if (p.foe == eid && (p.life ?? 0) == life && (p.dmg ?? 0) > most) {
      most = p.dmg ?? 0
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
  return BEASTS[kind].loot.flatMap(([item, chance]) =>
    r() < chance
      ? [{
        kind: item,
        n: item == 'coin' ? 1 + Math.floor(r() * BEASTS[kind].lvl * 3) : 1,
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

export type Quest = {
  eid: string
  step: number
  goal: string
  target: string
  count: number
  xp: number
  gift?: string
  title: string
  body: string
}

export type Entry = { quest: string; step: string; at: number }
export type Held = { eid: string; kind: string; n: number }

/** Where one player stands with each quest, in order: done, taken (with how
 * far along), open to take, or not yet. */
export let questsOf = (
  quests: Quest[],
  journal: Entry[],
  kills: Slain[],
  bag: Held[],
) => {
  let sorted = [...quests].sort((a, b) => a.step - b.step)
  let taken = new Map<string, number>()
  let done = new Set<string>()
  for (let e of journal) {
    if (e.step == 'taken') taken.set(e.quest, e.at)
    if (e.step == 'done') done.add(e.quest)
  }
  let open = true
  return sorted.map((q) => {
    let state = done.has(q.eid)
      ? 'done'
      : taken.has(q.eid)
      ? 'taken'
      : open
      ? 'open'
      : 'locked'
    if (state != 'done') open = false
    let since = taken.get(q.eid) ?? Infinity
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
    quests.filter((q) => done.has(q.eid)).reduce((n, q) => n + q.xp, 0)
}

/** The keenest blade a player carries. */
export let edgeOf = (bag: Held[]) =>
  bag.reduce((e, b) => Math.max(e, ITEMS[b.kind]?.edge ?? 1), 1)
