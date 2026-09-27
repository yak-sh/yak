// What a hero wears, from their equip rows: the newest row for each slot says
// what is in it, and one naming no item takes the slot off. Rows are only
// ever added, so a guest, who can only add rows, keeps their gear. What is
// worn must still be in the bag: a thing spent or given up is off. A weapon
// held in both hands leaves no hand for anything else, so of the two, the one
// chosen last is held. A second blade goes in the other hand only for a hero
// whose skills let it (skills.ts `hand`), chosen since they learned it, and
// beside one of its family in the first: forgetting the skill by a fire puts
// it back in the bag. What the worn things add up to is the hero's kit: how
// their blows land (`HANDLES`), and how much of a bite they turn.
//
// A slot the hero never chose for takes the best they carry for it
// (`firsts`), so a hero handed a sword holds it without opening their bag.
// Once chosen, a slot holds what was chosen.
import { ARMS, HANDLES, type Slot, SLOTS } from './arms.ts'
import { ITEMS } from './items.ts'
import { piece, POWERS, type Powers, RARITIES } from './rarity.ts'
import type { Held } from './rules.ts'
import { type Learned, SKILLS } from './skills.ts'

export type Equip = { slot: string; item: string; at: number }
export type Worn = Partial<Record<Slot, Held>>
export type Hand = 'main' | 'off'

// The newest row for each slot; of two at once, the one naming the later
// item, so every page picks the same.
let newest = (rows: Equip[]) => {
  let last = new Map<string, Equip>()
  for (let r of rows) {
    let was = last.get(r.slot)
    if (!was || r.at > was.at || (r.at == was.at && r.item > was.item)) {
      last.set(r.slot, r)
    }
  }
  return last
}

// Whether a skill lets the other hand hold a weapon of `family`.
let lets = (skill: string, family = '') =>
  !!family && SKILLS[skill]?.hand == family

/** The two hands settled, the side chosen `last` kept where they clash: a
 * blade in the other hand only beside another of its family in the first,
 * and a weapon for both hands alone.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let h = (kind: string, eid = kind) => ({ eid, kind, n: 1 })
 * let kinds = (w: Worn) => Object.values(w).map((x) => x!.kind)
 * assertEquals(kinds(hands({ main: h('bow1'), off: h('shield1') }, 'off')), [
 *   'shield1',
 * ])
 * assertEquals(kinds(hands({ main: h('sword1'), off: h('dagger1') }, 'off')), [
 *   'sword1',
 * ])
 * assertEquals(
 *   kinds(hands({ main: h('dagger2'), off: h('dagger1') }, 'off')),
 *   ['dagger2', 'dagger1'],
 * )
 * ```
 */
export let hands = (worn: Worn, last: Hand): Worn => {
  let w = { ...worn }
  let main = ITEMS[w.main?.kind ?? ''], off = ITEMS[w.off?.kind ?? '']
  if (
    off?.slot == 'main' &&
    (off.family != main?.family || w.off?.eid == w.main?.eid)
  ) delete w.off
  else if (w.main && w.off && HANDLES[main?.family ?? '']?.hands == 2) {
    delete w[last == 'off' ? 'main' : 'off']
  }
  return w
}

/** What each slot holds, for a hero who knows `known` (skills.ts
 * `learnedOf`).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { type Learned, learnedOf } from './skills.ts'
 * type Row = [string, string, number]
 * let bag = [
 *   { eid: 's', kind: 'sword1', n: 1 },
 *   { eid: 'b', kind: 'bow1', n: 1 },
 *   { eid: 'h', kind: 'shield1', n: 1 },
 *   { eid: 'd', kind: 'dagger2', n: 1 },
 *   { eid: 'e', kind: 'dagger1', n: 1 },
 * ]
 * let wear = (known: Learned[]) => (...rows: Row[]) =>
 *   Object.fromEntries(
 *     Object.entries(
 *       wornOf(rows.map(([slot, item, at]) => ({ slot, item, at })), bag, known),
 *     ).map(([s, h]) => [s, h!.kind]),
 *   )
 * let worn = wear([])
 * assertEquals(worn(['main', 's', 1], ['off', 'h', 2]), {
 *   main: 'sword1',
 *   off: 'shield1',
 * })
 * // An empty row takes it off; what is not in the bag is not worn.
 * assertEquals(worn(['main', 's', 1], ['main', '', 2]), {})
 * assertEquals(worn(['main', 'gone', 1]), {})
 * // A bow wants both hands: the later choice wins.
 * assertEquals(worn(['off', 'h', 1], ['main', 'b', 2]), { main: 'bow1' })
 * assertEquals(worn(['main', 'b', 1], ['off', 'h', 2]), { off: 'shield1' })
 * // A second dagger goes in the other hand only for a hero who knows Twin
 * // daggers, chosen since they learned it, beside a dagger in the first.
 * let twin = wear([{ skill: 'twin', at: 5 }])
 * let pair: Row[] = [['main', 'd', 6], ['off', 'e', 7]]
 * assertEquals(twin(...pair), { main: 'dagger2', off: 'dagger1' })
 * assertEquals(worn(...pair), { main: 'dagger2' })
 * assertEquals(twin(['main', 'd', 1], ['off', 'e', 2]), { main: 'dagger2' })
 * assertEquals(twin(['main', 's', 6], ['off', 'e', 7]), { main: 'sword1' })
 * assertEquals(twin(['main', 'd', 6], ['off', 'd', 7]), { main: 'dagger2' })
 * // Forgetting it by a fire puts the dagger back in the bag, and learning it
 * // again leaves it there until it is chosen again.
 * let learns = (at: number) =>
 *   ['keen', 'cuts', 'twin'].map((skill, i) => ({ skill, at: at + i }))
 * let knows = (respecs: number[], ...rows: Learned[]) =>
 *   wear(learnedOf(rows, respecs, 5))(...pair)
 * assertEquals(knows([], ...learns(1)), { main: 'dagger2', off: 'dagger1' })
 * assertEquals(knows([20], ...learns(1)), { main: 'dagger2' })
 * assertEquals(knows([20], ...learns(1), ...learns(30)), { main: 'dagger2' })
 * ```
 */
export let wornOf = (
  rows: Equip[],
  bag: Held[],
  known: Learned[] = [],
): Worn => {
  let held = new Map(bag.map((h) => [h.eid, h]))
  let last = newest(rows)
  let worn: Worn = {}
  for (let s of SLOTS) {
    let r = last.get(s), h = held.get(r?.item ?? ''), t = ITEMS[h?.kind ?? '']
    if (!r || !h || !t) continue
    if (
      t.slot == s ||
      (s == 'off' && known.some((k) => lets(k.skill, t.family) && k.at < r.at))
    ) worn[s] = h
  }
  let later = (last.get('off')?.at ?? 0) > (last.get('main')?.at ?? 0)
  return hands(worn, later ? 'off' : 'main')
}

/** Whether a hero wearing `worn` who knows `learned` could hold `kind` in the
 * other hand too: a blade their skills let it hold, beside one of its family
 * in the first.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let w = { main: { eid: 'a', kind: 'dagger1', n: 1 } }
 * assertEquals(twins('dagger2', w, ['keen', 'cuts', 'twin']), true)
 * assertEquals(twins('dagger2', w, ['keen', 'cuts']), false)
 * assertEquals(twins('sword2', w, ['twin']), false)
 * assertEquals(twins('dagger2', {}, ['twin']), false)
 * ```
 */
export let twins = (kind: string, worn: Worn, learned: string[]): boolean => {
  let t = ITEMS[kind]
  return t?.slot == 'main' &&
    ITEMS[worn.main?.kind ?? '']?.family == t.family &&
    learned.some((id) => lets(id, t.family))
}

/** How a hero fights, from what they wear: their weapon's family and how it
 * handles (bare fists with none), and what everything worn adds. */
export type Kit = {
  family: string
  /** how hard a blow lands, against bare level */
  dmg: number
  /** with a blade in the other hand too, how hard its blows land; blows
   * alternate hands (`handOf`), quicker than one blade's. 0 with none */
  twin: number
  pace: number
  reach: number
  arc: number
  hands: number
  shot?: 'arrow' | 'bolt'
  armour: number
  hp: number
  speed: number
  force: number
  luck: number
  /** what the legendaries worn do (rarity.ts) */
  powers: Powers
}

// Two blades strike this much of one's pace apart, a hand at a time.
let TWIN = 0.8

/** A hero's kit: each piece worn as it rolled (rarity.ts).
 *
 * ```ts
 * import { assert, assertEquals } from '@std/assert'
 * import { ITEMS } from './items.ts'
 * import type { Rarity } from './rarity.ts'
 * import { blow } from './rules.ts'
 * let kit = (...kinds: string[]) =>
 *   kitOf(Object.fromEntries(
 *     kinds.map((kind) => [ITEMS[kind].slot!, { eid: kind, kind, n: 1 }]),
 *   ))
 * assertEquals(kit().family, 'fists')
 * assertEquals(kit('hammer3').hands, 2)
 * // Plate turns more than leather, and leather runs faster.
 * assertEquals(kit('cuirass2').armour > kit('jerkin2').armour, true)
 * assertEquals(kit('jerkin2', 'boots2').speed, 0.08)
 * assertEquals(kit('robe1', 'tome1').force, 0.13)
 * // Two daggers strike quicker than one, and neither they nor a sword and
 * // shield is better at everything. At every tier, the daggers land more a
 * // second, more than a dagger with a tome or a torch beside it, but not
 * // half again as much as a sword and shield, which reach further and turn
 * // more of every bite.
 * let pair = (main: string, off: string) =>
 *   kitOf({
 *     main: { eid: 'a', kind: main, n: 1 },
 *     off: { eid: 'b', kind: off, n: 1 },
 *   })
 * let rolls = Array.from({ length: 1000 }, (_, i) => i / 1000)
 * let rate = (k: Kit) => {
 *   let dealt = (k.twin ? [k.dmg, k.twin] : [k.dmg]).flatMap((d) =>
 *     rolls.map((r) => blow(100 * d * (1 + k.force), r, false, k.luck).dmg)
 *   )
 *   return dealt.reduce((a, b) => a + b) / dealt.length / k.pace
 * }
 * for (let t = 1; t <= 5; t++) {
 *   let twin = pair(`dagger${t}`, `dagger${t}`)
 *   let guard = pair(`sword${t}`, `shield${t}`)
 *   let one = [`tome${t}`, `torch${t}`].map((o) => rate(pair(`dagger${t}`, o)))
 *   assert(twin.pace < kit(`dagger${t}`).pace)
 *   assert(rate(twin) > Math.max(...one) && rate(twin) > rate(guard))
 *   assert(rate(twin) < 1.5 * rate(guard))
 *   assert(guard.reach > twin.reach && guard.armour > twin.armour)
 * }
 * // A finer piece does more, and a legendary brings its power.
 * let axe = (rarity: Rarity) =>
 *   kitOf({ main: { eid: 'x', kind: 'axe2', n: 1, rarity } })
 * assertEquals(axe('epic').dmg > axe('common').dmg, true)
 * assertEquals(Object.keys(axe('legendary').powers).length, 1)
 * ```
 */
export let kitOf = (worn: Worn): Kit => {
  let main = worn.main ? piece(worn.main) : undefined
  let off = worn.off ? piece(worn.off) : undefined
  let family = main?.family && HANDLES[main.family] ? main.family : 'fists'
  let h = HANDLES[family]
  let twin = off?.slot == 'main' ? off.dmg ?? 0 : 0
  let kit: Kit = {
    family,
    dmg: main?.dmg ?? h.dmg,
    twin,
    pace: h.pace,
    reach: h.reach,
    arc: h.arc,
    hands: h.hands,
    shot: h.shot,
    armour: 0,
    hp: 0,
    speed: 0,
    force: 0,
    luck: h.luck ?? 0,
    powers: {},
  }
  let haste = 0
  for (let w of Object.values(worn)) {
    let t = piece(w)
    kit.armour += t.armour ?? 0
    kit.hp += t.hp ?? 0
    kit.speed += t.speed ?? 0
    kit.force += t.force ?? 0
    kit.luck += t.luck ?? 0
    haste += t.haste ?? 0
    for (let p of POWERS) {
      let n = t.legend?.powers[p]
      if (n) kit.powers[p] = (kit.powers[p] ?? 0) + n
    }
  }
  kit.pace = Math.round(h.pace * (twin ? TWIN : 1) * (1 - haste))
  for (let k of ['speed', 'force', 'luck'] as const) {
    kit[k] = Math.round(kit[k] * 100) / 100
  }
  return kit
}

/** Which hand a hero's `n`th blow is struck with: with a blade in each, the
 * other one every other blow. Every page counts a hero's blows alike (play.ts
 * `fight.swing`), so every page sees the same hand.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let a = { eid: 'a', kind: 'dagger1', n: 1 }
 * let one = kitOf({ main: a }), two = kitOf({ main: a, off: { ...a, eid: 'b' } })
 * assertEquals([1, 2, 3, 4].map((n) => handOf(two, n)), [
 *   'main',
 *   'off',
 *   'main',
 *   'off',
 * ])
 * assertEquals([1, 2].map((n) => handOf(one, n)), ['main', 'main'])
 * ```
 */
export let handOf = (kit: Kit, n: number): Hand =>
  kit.twin && n % 2 == 0 ? 'off' : 'main'

/** How good a thing is to wear, to choose the best of several. */
let rank = (h: Held) => {
  let t = piece(h)
  return (t.tier ?? 0) * 1000 + RARITIES.indexOf(t.rarity) * 150 +
    (t.dmg ?? 0) * 100 + (t.armour ?? 0) * 10 + (t.hp ?? 0) / 10
}

/** What to put on in each slot the hero never chose for: the best they
 * carry for it. The other hand is left alone while both hands are full.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let bag = [
 *   { eid: 'a', kind: 'sword1', n: 1 },
 *   { eid: 'b', kind: 'blade3', n: 1 },
 *   { eid: 'c', kind: 'robe1', n: 1 },
 *   { eid: 'd', kind: 'jelly', n: 3 },
 * ]
 * assertEquals(firsts([], bag), [
 *   { slot: 'main', item: 'b' },
 *   { slot: 'body', item: 'c' },
 * ])
 * // Chosen once, a slot is left to the hero, even empty.
 * assertEquals(firsts([{ slot: 'main', item: '', at: 1 }], bag), [
 *   { slot: 'body', item: 'c' },
 * ])
 * ```
 */
export let firsts = (rows: Equip[], bag: Held[]) => {
  let chosen = new Set(rows.map((r) => r.slot))
  let worn = wornOf(rows, bag)
  let out: { slot: Slot; item: string }[] = []
  for (let s of SLOTS) {
    if (chosen.has(s)) continue
    let best = bag.filter((h) => ITEMS[h.kind]?.slot == s)
      .sort((a, b) => rank(b) - rank(a))[0]
    if (!best) continue
    if (s == 'off') {
      let hand = out.find((o) => o.slot == 'main')
      let kind = hand
        ? bag.find((h) => h.eid == hand.item)?.kind
        : worn.main?.kind
      if (HANDLES[ITEMS[kind ?? '']?.family ?? '']?.hands == 2) continue
    }
    out.push({ slot: s, item: best.eid })
  }
  return out
}

/** What the rack by a village's fire holds: a plain thing of the first tier
 * for every hand and every weight, for any hero to take and try. */
export let RACK: string[] = Object.keys(ARMS).filter((k) =>
  ARMS[k].tier == 1 && ARMS[k].slot != 'trinket'
)
