// Creature designs enter through the app store and shape the world on a page.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { aliasDoc, aliases } from '@yaks/alias'
import { docDoc } from '@yaks/doc'
import { graph } from '@yaks/graph'
import { admitSchema } from '@yaks/graph/schema'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { beastId, BEASTS, useBeasts, useDens } from './beasts.ts'
import { useNames } from './names.ts'
import { rows } from './beasts_fixture.ts'
import { comp } from './bundle.ts'
import { seedItems } from './items_fixture.ts'
import { foeOf } from './danger.ts'
import { dens, homesNear } from './homes.ts'
import { LEVELS } from './levels.ts'
import { wares } from './stock.ts'
import words from './vocab.json' with { type: 'json' }
import { seedThemes } from './themes_fixture.ts'
import { seedBuildings } from './buildings_fixture.ts'

seedThemes()
seedBuildings()

// A store holding the seed, and a page reading it as main.ts does.
let store = async () => {
  let vocab = loadVocab([keyDoc, aliasDoc, docDoc, words], [keyKeywords])
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [keys(vocab), aliases(), admitSchema(vocab)],
  })
  await g.apply(rows)
  let read = async () => {
    useBeasts(await g.read('.beast_design ?combat ?loot ?sounds'))
    useDens(await g.read('.den'))
    useNames(await g.read('.alias .key'))
  }
  await read()
  return { g, read }
}

test('a creature design added to the store inhabits its chosen land', async () => {
  let { g, read } = await store()
  seedItems()
  assertEquals(
    Object.keys(BEASTS).length,
    rows.filter((r) => r.beast_design).length,
  )
  let nearby = () =>
    homesNear(128, 128, 90).some((h) => h.beast == beastId('beast:moonmoth'))
  assertEquals(beastId('beast:moonmoth'), undefined)
  assertEquals(wares('mossvale').has('ivory'), false)

  let slime = rows.find((r) => comp(r, 'alias').name == 'beast:slime')!
  let [made] = await g.apply([{
    entity: { eid: '$moth' },
    alias: { name: 'beast:moonmoth' },
    beast_design: { ...comp(slime, 'beast_design'), name: 'Moonmoth' },
    combat: comp(slime, 'combat'),
    loot: { drops: [['ivory', 1]] },
  }, {
    entity: { eid: '$den' },
    den: {
      beast: '$moth',
      near: 'village',
      count: 4,
      within: 40,
      beyond: 17,
      apart: 6,
      roam: 5,
      respawn: 40,
    },
  }])
  await read()
  let eid = made.entity.eid
  assertEquals(beastId('beast:moonmoth'), eid)
  assert(dens(LEVELS.mossvale).some((den) => den.beast == eid))
  assert(nearby())
  assert(wares('mossvale').has(eid))
  assert(wares('mossvale').has('ivory'))

  let before = foeOf(eid, 'mossvale')!.hp
  await g.apply([{ entity: { eid }, combat: { hp: 64 } }])
  await read()
  assert(foeOf(eid, 'mossvale')!.hp > before)

  // Without combat it can't be fought, and no deal asks for it.
  await g.apply([{ entity: { eid }, combat: null }])
  await read()
  assertEquals(foeOf(eid, 'mossvale'), undefined)
  assertEquals(wares('mossvale').has(eid), false)

  // Without a den it lives nowhere.
  let den = (await g.read('.den')).find((d) => comp(d, 'den').beast == eid)!
  await g.apply([{ entity: { eid: den.entity.eid }, $delete: true }])
  await read()
  assertEquals(dens(LEVELS.mossvale).some((d) => d.beast == eid), false)
  assertEquals(nearby(), false)
})

test('every sound a seeded creature names is a seeded sound row', async () => {
  let { g } = await store()
  let sounds = new Set((await g.read('.sfx')).map((r) => r.entity.eid))
  for (let b of Object.values(BEASTS)) {
    for (let s of [b.cry, b.step]) assert(!s || sounds.has(s), b.name)
  }
})

test('combat admission bounds full merged rows, including partial patches', async () => {
  let { g } = await store()
  let eid = crypto.randomUUID()
  let combat = {
    lvl: 1,
    hp: 250,
    dmg: 4,
    speed: 6,
    reach: 4,
    aggro: 12,
    xp: 110,
  }
  let put = (patch: Record<string, unknown>) =>
    g.apply([{ entity: { eid }, combat: patch }])
  await put(combat)
  for (
    let [field, value] of Object.entries({
      lvl: 21,
      hp: 5001,
      dmg: 81,
      speed: 6.01,
      reach: 4.01,
      aggro: 12.01,
      xp: 2201,
    })
  ) {
    await assertRejects(
      async () => put({ [field]: value }),
      Error,
      `combat.${field}`,
    )
  }
  for (
    let [field, value] of Object.entries({
      lvl: 0,
      hp: 0,
      dmg: -1,
      speed: -1,
      reach: 0,
      aggro: -1,
      xp: -1,
    })
  ) {
    await assertRejects(
      async () => put({ [field]: value }),
      Error,
      `combat.${field}`,
    )
  }
  for (let field of ['hp', 'dmg', 'xp']) {
    await assertRejects(
      async () => put({ [field]: combat[field as keyof typeof combat] + 0.1 }),
      Error,
      `combat.${field}_per_level`,
    )
  }
  await put({ lvl: 20, hp: 5000, dmg: 80, xp: 2200 })
  await assertRejects(async () => put({ lvl: 1 }), Error, 'combat.hp_per_level')
  await put({ hp: 4999 })
  // Admission checks each ordered operation, rolling back the whole batch.
  await assertRejects(
    async () =>
      g.apply([
        { entity: { eid }, combat: { lvl: 1 } },
        { entity: { eid }, combat: { hp: 250, dmg: 4, xp: 110 } },
      ]),
    Error,
    'combat.hp_per_level',
  )
  await put({ lvl: 1, hp: 250, dmg: 4, xp: 110 })
  await put({ aggro: 0, dmg: 0, speed: 0, xp: 0 })
  for (let field of Object.keys(combat)) {
    await assertRejects(
      async () => put({ [field]: null }),
      Error,
      `${field} is required`,
    )
  }
  await assertRejects(
    async () =>
      g.apply([{
        entity: { eid: crypto.randomUUID() },
        combat: { lvl: 1 },
      }]),
    Error,
    'is required',
  )
  await g.apply([{ entity: { eid }, combat: null }])
  await put(combat)
  await g.apply([{ entity: { eid }, $delete: true }])
})
