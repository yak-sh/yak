// An item's level is stable in its tier, changes what it gives, and keeps a
// hero from wearing gear they have not reached yet.
import { assert, assertEquals } from '@std/assert'
import { tierRange } from './arms.ts'
import { sortLine } from './compare.ts'
import { canWear, firsts, wornOf } from './gear.ts'
import { ITEMS } from './items.ts'
import { seedItems } from './items_fixture.ts'
import { itemLevel, piece } from './rarity.ts'

seedItems()

Deno.test('item levels stay with their piece and refine its power', () => {
  for (let kind of Object.keys(ITEMS).filter((k) => ITEMS[k].slot)) {
    let [lo, hi] = tierRange(ITEMS[kind].tier!)
    let lvl = itemLevel('one-piece', kind)!
    assert(lvl >= lo && lvl <= hi, kind)
    assertEquals(itemLevel('one-piece', kind), lvl)
    let old = piece({ eid: 'old', kind })
    assertEquals(old.lvl, lo)
    assertEquals(old, piece({ eid: 'old', kind, lvl: lo }))
  }
  assertEquals(itemLevel('one-piece', 'tonic'), undefined)
  let low = piece({ eid: 's', kind: 'sword1', lvl: 1 })
  let high = piece({ eid: 's', kind: 'sword1', lvl: 12 })
  assert(high.dmg! > low.dmg!)
  assert(sortLine(high).startsWith('Level 12 · '))
  assert(!sortLine(high).includes('levels 1–12'))
  let shield = (lvl: number) => piece({ eid: 'h', kind: 'shield1', lvl })
  assert(shield(12).armour! > shield(1).armour!)
})

Deno.test('gear waits for its item level before it can be worn', () => {
  let h = { eid: 's', kind: 'sword1', n: 1, lvl: 8 }
  let low = { eid: 't', kind: 'sword1', n: 1, lvl: 1 }
  let rows = [{ slot: 'main', item: 's', at: 1 }]
  assertEquals(canWear(h, 7), false)
  assertEquals(wornOf(rows, [h], 7), {})
  assertEquals(firsts([], [h, low], 7), [{ slot: 'main', item: 't' }])
  assertEquals(canWear(h, 8), true)
  assertEquals(wornOf(rows, [h], 8).main, h)
  assertEquals(firsts([], [h], 8), [{ slot: 'main', item: 's' }])
})
