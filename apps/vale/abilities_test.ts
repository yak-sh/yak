// Ability designs arrive from the store and shape combat and its descriptions.
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertRejects,
} from '@std/assert'
import { graph } from '@yaks/graph'
import { admitSchema } from '@yaks/graph/schema'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { ABILITIES, does, GIVES, OFF, useAbilities } from './abilities.ts'
import { DESIGN_BUDGET, fits, price } from './ability-design.ts'
import { effect } from './ability-effects.ts'
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
  let sharpened = ABILITIES.lunge.effects.map((e) =>
    e.kind == 'damage' ? { ...e, scale: 3 } : e
  )
  await g.apply([{
    entity: { eid },
    ability_design: {
      effects: sharpened,
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
      effects: [{ kind: 'damage', scale: 1.5 }],
      weapon: 'wand',
      slot: 1,
    },
  }])
  useAbilities(await g.read('.ability_design'))
  assertEquals(GIVES.wand, [newKind])
  assert(formOf(newKind, [])?.name == 'Moonflash')
})

Deno.test('composed abilities retain skill changes and price their effects', () => {
  useAbilities(rows)
  let doer = { blow: 20, max: 120 }
  assertEquals(effect(formOf('flurry', ['cuts'])!.effects, 'damage')?.hits, 5)
  assertMatch(does(ABILITIES.flurry, doer), /3 hits.*Final hit is a great blow/)
  assertMatch(does(formOf('flurry', ['cuts'])!, doer), /5 hits/)
  assertEquals(effect(ABILITIES.crosscut.effects, 'damage')?.hits, 2)
  assertMatch(does(ABILITIES.crosscut, doer), /2 hits.*Bleed Damage/)
  assertEquals(effect(ABILITIES.shadowstep.effects, 'dash')?.behind, true)
  assertMatch(does(ABILITIES.shadowstep, doer), /6 m dash.*Always a great blow/)
  assertEquals(
    effect(formOf('crush', ['earthbreaker'])!.effects, 'stun')?.ms,
    1500,
  )
  assertEquals(
    effect(formOf('lunge', ['relentless'])!.effects, 'renew')?.kind,
    'renew',
  )
  for (let a of Object.values(ABILITIES)) {
    assert(fits(a), `${a.name}: ${price(a)} / ${DESIGN_BUDGET}`)
  }
  assert(!fits({ ...ABILITIES.flurry, cool: 1000 }))
})

Deno.test('Store admits an invented ability only within its effect budget', async () => {
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab, plugins: [admitSchema(vocab)] })
  let row = (kind: string, effects: unknown[]) => [{
    entity: { eid: uuidOf(`mossvale/ability/${kind}`) },
    ability_design: {
      kind,
      name: kind,
      icon: 'sparkles',
      description: 'An invented spell',
      shape: 'one',
      pose: 'cast',
      cool: 3000,
      effects,
    },
  }]
  await g.apply(row('small', [{ kind: 'damage', scale: 1 }]))
  assertEquals((await g.read('.ability_design')).length, 1)
  await assertRejects(
    () => g.apply(row('giant', [{ kind: 'damage', scale: 10 }])),
    Error,
    'power budget',
  )
  await assertRejects(
    () =>
      g.apply(row('double', [
        { kind: 'damage', scale: 1 },
        { kind: 'damage', scale: 1 },
      ])),
  )
  await assertRejects(() =>
    g.apply([{
      entity: { eid: uuidOf('mossvale/ability/empty') },
      ability_design: {
        kind: 'empty',
        name: 'empty',
        icon: 'sparkles',
        description: 'An empty spell',
        shape: 'one',
        pose: 'cast',
        cool: 3000,
      },
    }])
  )
  assertEquals((await g.read('.ability_design')).length, 1)
})
