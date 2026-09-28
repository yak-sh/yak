// Saved upgrade gains replay the same, and the crafting and upgrade ranges
// contain the pieces those rolls can make.
import { assert, assertEquals } from '@std/assert'
import { tierRange } from './arms.ts'
import { itemStats, numbers, statValue, stepRange, versus } from './compare.ts'
import { ITEMS } from './items.ts'
import {
  GEAR_STATS,
  piece,
  RARITIES,
  statRange,
  UP_MAX,
  UP_MIN,
  upgradeGain,
  upgradeRange,
} from './rarity.ts'
import { MOST, upgradesOf } from './upgrade.ts'

Deno.test('upgrade rows preserve old steps and replay new rolls', () => {
  let row = upgradeGain('upgrade-one')
  assert(row >= UP_MIN && row <= UP_MAX)
  assert(
    new Set(Array.from({ length: 40 }, (_, i) => upgradeGain(String(i)))).size >
      1,
  )
  let old = [{ item: 's' }, { item: 's' }]
  assertEquals(upgradesOf(old).get('s'), { plus: 2 })
  let mixed = upgradesOf([...old, { item: 's', gain: row }]).get('s')!
  assertEquals(mixed, { plus: 3, gain: 0.2 + row })
  let h = { eid: 's', kind: 'sword2', lvl: 13, plus: 2 }
  assertEquals(piece({ eid: 'r', kind: 'robe3', plus: 2 }).hp, 8)
  let current = { ...h, ...mixed }
  let [low, high] = upgradeRange(current)
  assertEquals([low.lvl, high.lvl], [h.lvl, h.lvl])
  assertEquals([low.plus, high.plus], [4, 4])
  let rolled = piece({ ...current, plus: 4, gain: mixed.gain! + row })
  assert(rolled.dmg! >= piece(low).dmg! && rolled.dmg! <= piece(high).dmg!)
  let capped = upgradesOf(
    Array.from({ length: MOST + 2 }, () => ({ item: 's', gain: row })),
  )
  assertEquals(capped.get('s')!.plus, MOST)
  let ordered = Array.from({ length: MOST + 1 }, (_, i) => ({
    item: 's',
    eid: String(i),
    at: i,
    gain: UP_MIN + i / 100,
  }))
  assertEquals(upgradesOf(ordered), upgradesOf(ordered.reverse()))
})

Deno.test('each upgrade roll stays within a visible range', () => {
  for (let kind of Object.keys(ITEMS).filter((k) => ITEMS[k].slot)) {
    let h = { eid: 'x', kind, lvl: tierRange(ITEMS[kind].tier!)[0] }
    let [lo, hi] = upgradeRange(h), [a, b] = [piece(lo), piece(hi)]
    assert(GEAR_STATS.some((s) => a[s] != b[s]), kind)
    let got = piece({ ...h, plus: 1, gain: upgradeGain(kind) })
    for (let s of GEAR_STATS) {
      let n = got[s] ?? 0
      assert(n >= (a[s] ?? 0) && n <= (b[s] ?? 0), `${kind} ${s}`)
    }
  }
})

Deno.test('craft preview bounds contain the gear that can roll', () => {
  for (let kind of Object.keys(ITEMS).filter((k) => ITEMS[k].slot)) {
    let [lo, hi] = tierRange(ITEMS[kind].tier!)
    let bounds = statRange(kind)
    for (let rarity of RARITIES) {
      for (let eid of ['one', 'two', 'three']) {
        for (let lvl of [lo, hi]) {
          let p = piece({ eid, kind, rarity, lvl })
          for (let stat of GEAR_STATS) {
            let n = p[stat] ?? 0, [a, b] = bounds[stat] ?? [0, 0]
            assert(n >= a && n <= b, `${kind} ${rarity} ${lvl} ${stat}`)
          }
        }
      }
    }
  }
  assertEquals(statRange('tonic'), {})
})

Deno.test('upgrade preview shows current values and possible next values', () => {
  let h = { eid: 's', kind: 'sword2', n: 1, lvl: 13 }
  let [lo, hi] = upgradeRange(h)
  let side = (x: typeof h & { plus?: number; gain?: number }) => ({
    label: 'Now',
    p: piece(x),
    worn: { main: x },
  })
  let html = stepRange(
    { lvl: 13, learned: [] },
    side(h),
    side({ ...h, ...lo }),
    side({ ...h, ...hi }),
  )
  assert(html.includes('Upgrade to +1: current → possible result'))
  assert(html.includes('Weapon power '))
  assert(html.includes('Attack '))
  assert(html.includes(statValue('dmg', piece(h).dmg!)))
  assert(!html.includes('a blow'))
})

Deno.test('item stats and equipped hero changes read separately', () => {
  let h = { eid: 's', kind: 'sword2', n: 1, lvl: 13 }
  let hero = { lvl: 13, learned: [] }
  let p = piece(h)
  let card = versus(
    hero,
    { label: 'In your bag', p, worn: { main: h } },
    { label: 'Worn', worn: {} },
  )
  let own = itemStats(p)
  let attack = numbers(hero, { main: h }).blow
  assert(own.includes(`${statValue('dmg', p.dmg!)} Weapon power`))
  assert(!own.includes(' Attack</span>'))
  assert(card.indexOf('Weapon power') < card.indexOf('If equipped'))
  assert(card.includes(`>${attack}</em>`))
  assert(card.includes('Attack '))
  assert(!card.includes('a blow'))
})
