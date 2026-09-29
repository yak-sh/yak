// The bag lists wearable pieces before grouped supplies, with item level
// taking priority over rarity and older pieces using their tier's first level.
import { assertEquals } from '@std/assert'
import { seedItems } from './items_fixture.ts'
import { carried } from './pack.ts'

seedItems()

Deno.test('the bag orders gear by item level, then rarity', () => {
  let h = (eid: string, kind: string, lvl?: number, rarity?: 'legendary') => ({
    eid,
    kind,
    n: 1,
    lvl,
    rarity,
  })
  let worn = h('worn', 'sword2', 18)
  let bag = [
    h('low-fine', 'sword1', 1, 'legendary'),
    h('same-common', 'sword1', 12),
    h('same-fine', 'sword1', 12, 'legendary'),
    h('legacy', 'sword2'),
    worn,
    h('jelly-a', 'jelly'),
    { ...h('jelly-b', 'jelly'), n: 2 },
    h('tusk', 'tusk'),
  ]
  assertEquals(
    carried({ bag, worn: { main: worn } }).map(({ h, n }) => [h.eid, n]),
    [
      ['legacy', 1],
      ['same-fine', 1],
      ['same-common', 1],
      ['low-fine', 1],
      ['tusk', 1],
      ['jelly-a', 3],
    ],
  )
})
