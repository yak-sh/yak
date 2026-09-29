// No thing's look draws two faces the depth buffer cannot tell apart (mesh.ts
// `fights`): arms and armour of every tier, what is gathered, and loot, as
// each lies on the ground and flies to a hero (items.ts `meshed`).
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { seedBeasts } from './beasts_fixture.ts'
import { recipes } from './craft.ts'
import { rack } from './gear.ts'
import { ITEMS, meshed, useItems } from './items.ts'
import { rows, seedItems } from './items_fixture.ts'
import { fights, pack } from './mesh.ts'
import { uuidOf } from './rand.ts'
import { piece } from './rarity.ts'
import { faces } from './sprites.ts'
import { wares } from './stock.ts'
import words from './vocab.json' with { type: 'json' }

seedItems()

test('no look fights itself', () => {
  let fighting = Object.entries(ITEMS)
    .map(([kind, t]) => [kind, fights(pack(meshed(t.look))).length])
    .filter(([, n]) => n)
  assertEquals(Object.fromEntries(fighting), {})
})

test('item designs in the store feed gear, recipes and stock', async () => {
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply(rows)
  useItems(await g.read('.item_design'))
  seedBeasts()
  assertEquals(Object.keys(ITEMS).length, rows.length)
  assert(faces(ITEMS.jelly.look, 64, 4, ITEMS.jelly.view).length > 0)

  let base = rows.find((row) => row.item_design.kind == 'sword1')!
  let eid = uuidOf('mossvale/item/moonblade1')
  await g.apply([{
    entity: { eid },
    item_design: {
      ...base.item_design,
      kind: 'moonblade1',
      name: 'Moonblade',
      dmg: 2,
    },
  }])
  useItems(await g.read('.item_design'))
  assertEquals(recipes().moonblade1.at, 'forge')
  assert(rack().includes('moonblade1'))
  assert(wares('mossvale').has('moonblade1'))
  assertEquals(piece({ eid: 'one', kind: 'moonblade1' }).name, 'Moonblade')

  await g.apply([{
    entity: { eid },
    item_design: { name: 'Bright moonblade', dmg: 3 },
  }])
  useItems(await g.read('.item_design'))
  assertEquals(
    piece({ eid: 'one', kind: 'moonblade1' }).name,
    'Bright moonblade',
  )
  assertEquals(piece({ eid: 'one', kind: 'moonblade1' }).dmg, 3)

  await g.apply([{ entity: { eid }, $delete: true }])
  useItems(await g.read('.item_design'))
  assertEquals(recipes().moonblade1, undefined)
  assertEquals(rack().includes('moonblade1'), false)
  assertEquals(wares('mossvale').has('moonblade1'), false)
})
