// Creature designs enter through the app store and shape the world on a page.
import { assert, assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { BEASTS, useBeasts } from './beasts.ts'
import { rows } from './beasts_fixture.ts'
import { seedItems } from './items_fixture.ts'
import { foeOf } from './danger.ts'
import { dens, homesNear } from './homes.ts'
import { LEVELS } from './levels.ts'
import { uuidOf } from './rand.ts'
import { wares } from './stock.ts'
import words from './vocab.json' with { type: 'json' }
import { seedThemes } from './themes_fixture.ts'
import { seedBuildings } from './buildings_fixture.ts'

seedThemes()
seedBuildings()

Deno.test('a creature design added to the store inhabits its chosen land', async () => {
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply(rows)
  seedItems()
  useBeasts(await g.read('.beast_design'))
  assertEquals(Object.keys(BEASTS).length, rows.length)
  assertEquals(wares('mossvale').has('moonmoth'), false)
  assertEquals(wares('mossvale').has('ivory'), false)
  let nearby = () => homesNear(128, 128, 90).some((h) => h.kind == 'moonmoth')
  assertEquals(nearby(), false)

  let slime = rows.find((row) => row.beast_design.kind == 'slime')!
  let eid = uuidOf('mossvale/beast/moonmoth')
  await g.apply([{
    entity: { eid },
    beast_design: {
      ...slime.beast_design,
      kind: 'moonmoth',
      name: 'Moonmoth',
      loot: [['ivory', 1]],
    },
  }])
  useBeasts(await g.read('.beast_design'))
  assert(dens(LEVELS.mossvale).some((den) => den.kind == 'moonmoth'))
  assert(nearby())
  assert(wares('mossvale').has('moonmoth'))
  assert(wares('mossvale').has('ivory'))

  let before = foeOf('moonmoth', 'mossvale').hp
  await g.apply([{ entity: { eid }, beast_design: { hp: 64 } }])
  useBeasts(await g.read('.beast_design'))
  assert(foeOf('moonmoth', 'mossvale').hp > before)

  await g.apply([{ entity: { eid }, beast_design: { haunts: [] } }])
  useBeasts(await g.read('.beast_design'))
  assertEquals(
    dens(LEVELS.mossvale).some((den) => den.kind == 'moonmoth'),
    false,
  )
  assertEquals(wares('mossvale').has('moonmoth'), false)
  assertEquals(wares('mossvale').has('ivory'), false)
  assertEquals(nearby(), false)
})
