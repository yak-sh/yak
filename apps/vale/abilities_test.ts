// Ability designs arrive from the store and shape combat and its descriptions.
import { assert, assertEquals, assertMatch, assertNotMatch } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { ABILITIES, does, GIVES, OFF, useAbilities } from './abilities.ts'
import { rows } from './abilities_fixture.ts'
import { uuidOf } from './rand.ts'
import { formOf, SKILLS } from './skills.ts'
import words from './vocab.json' with { type: 'json' }

Deno.test('store ability designs drive grants, skill forms and descriptions', async () => {
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply(rows)
  useAbilities(await g.read('.ability_design'))

  assertEquals(Object.keys(ABILITIES).length, rows.length)
  assertEquals(GIVES.sword, ['cleave', 'lunge'])
  assertEquals(OFF.shield, 'block')
  let doer = { blow: 20, max: 120 }
  for (let [id, ability] of Object.entries(ABILITIES)) {
    assert(does(ability, doer).startsWith(`${ability.description}. `), id)
    for (let [skill, row] of Object.entries(SKILLS)) {
      if (row.ability == id) assert(does(formOf(id, [skill])!, doer))
    }
  }
  assertEquals(
    does(formOf('mend', ['kindness'])!, doer),
    'Read a word of healing. Restores 54 Health.',
  )
  assertNotMatch(does(ABILITIES.crush, doer), /Stun/)
  assertMatch(
    does(formOf('crush', ['earthbreaker'])!, doer),
    /64 Damage · 1\.5 s Stun/,
  )

  let eid = uuidOf('mossvale/ability/lunge')
  await g.apply([{
    entity: { eid },
    ability_design: {
      dmg: 3,
      description: 'A sharper charge',
    },
  }])
  useAbilities(await g.read('.ability_design'))
  assertEquals(
    does(ABILITIES.lunge, doer),
    'A sharper charge. 60 Damage · 4.5 m dash. Ready again at once if it misses.',
  )

  let newKind = 'moonflash'
  await g.apply([{
    entity: { eid: uuidOf(`mossvale/ability/${newKind}`) },
    ability_design: {
      kind: newKind,
      name: 'Moonflash',
      icon: 'sparkles',
      description: 'A flash of magic',
      shape: 'one',
      pose: 'cast',
      cool: 3000,
      dmg: 1.5,
      weapon: 'wand',
      slot: 1,
    },
  }])
  useAbilities(await g.read('.ability_design'))
  assertEquals(GIVES.wand, [newKind])
  assert(formOf(newKind, [])?.name == 'Moonflash')
})
