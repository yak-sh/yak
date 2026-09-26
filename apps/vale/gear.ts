// What a hero wears, from their equip rows: the newest row for each slot says
// what is in it, and one naming no item takes the slot off. Rows are only
// ever added, so a guest, who can only add rows, keeps their gear. What is
// worn must still be in the bag: a thing spent or given up is off. A weapon
// held in both hands leaves no hand for anything else, so of the two, the one
// chosen last is held. What the worn things add up to is the hero's kit: how
// their blows land (`HANDLES`), and how much of a bite they turn.
//
// A slot the hero never chose for takes the best they carry for it
// (`firsts`), so a hero handed a sword holds it without opening their bag.
// Once chosen, a slot holds what was chosen.
import { ARMS, HANDLES, type Slot, SLOTS } from './arms.ts'
import { ITEMS } from './items.ts'
import type { Held } from './rules.ts'

export type Equip = { slot: string; item: string; at: number }
export type Worn = Partial<Record<Slot, Held>>

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

/** What each slot holds.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let bag = [
 *   { eid: 's', kind: 'sword1', n: 1 },
 *   { eid: 'b', kind: 'bow1', n: 1 },
 *   { eid: 'h', kind: 'shield1', n: 1 },
 * ]
 * let worn = (...rows: [string, string, number][]) =>
 *   Object.fromEntries(
 *     Object.entries(
 *       wornOf(rows.map(([slot, item, at]) => ({ slot, item, at })), bag),
 *     ).map(([s, h]) => [s, h!.kind]),
 *   )
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
 * ```
 */
export let wornOf = (rows: Equip[], bag: Held[]): Worn => {
  let held = new Map(bag.map((h) => [h.eid, h]))
  let last = newest(rows)
  let worn: Worn = {}
  for (let s of SLOTS) {
    let h = held.get(last.get(s)?.item ?? '')
    if (h && ITEMS[h.kind]?.slot == s) worn[s] = h
  }
  let main = worn.main && ITEMS[worn.main.kind]
  if (worn.off && HANDLES[main?.family ?? '']?.hands == 2) {
    if (last.get('off')!.at > last.get('main')!.at) delete worn.main
    else delete worn.off
  }
  return worn
}

/** How a hero fights, from what they wear: their weapon's family and how it
 * handles (bare fists with none), and what everything worn adds. */
export type Kit = {
  family: string
  /** how hard a blow lands, against bare level */
  dmg: number
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
}

/** A hero's kit.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { ITEMS } from './items.ts'
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
 * ```
 */
export let kitOf = (worn: Worn): Kit => {
  let main = worn.main ? ITEMS[worn.main.kind] : undefined
  let family = main?.family && HANDLES[main.family] ? main.family : 'fists'
  let h = HANDLES[family]
  let kit: Kit = {
    family,
    dmg: main?.dmg ?? h.dmg,
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
  }
  for (let w of Object.values(worn)) {
    let t = ITEMS[w.kind]
    kit.armour += t?.armour ?? 0
    kit.hp += t?.hp ?? 0
    kit.speed += t?.speed ?? 0
    kit.force += t?.force ?? 0
    kit.luck += t?.luck ?? 0
  }
  for (let k of ['speed', 'force', 'luck'] as const) {
    kit[k] = Math.round(kit[k] * 100) / 100
  }
  return kit
}

/** How good a thing is to wear, to choose the best of several. */
let rank = (kind: string) => {
  let t = ITEMS[kind]
  return (t?.tier ?? 0) * 1000 + (t?.dmg ?? 0) * 100 + (t?.armour ?? 0) * 10 +
    (t?.hp ?? 0) / 10
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
      .sort((a, b) => rank(b.kind) - rank(a.kind))[0]
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
