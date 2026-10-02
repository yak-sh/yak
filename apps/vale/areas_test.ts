// Ground pulses select current occupants, and allied recipients own healing.
import { equal, test } from '@yaks/testing'
import { following, planted, pulse, received, within } from './areas.ts'
import { fits } from './ability-design.ts'
import { type Ability, abilityStats } from './abilities.ts'
import { graph } from '@yaks/graph'
import { admitSchema } from '@yaks/graph/schema'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import words from './vocab.json' with { type: 'json' }

test('ground area hits current occupants, not original targets', () => {
  let a = planted(
    {
      kind: 'area',
      ms: 4000,
      radius: 3,
      effects: [{ kind: 'damage', scale: .4 }],
    },
    'caster',
    'mossvale',
    'Blaze',
    { x: 0, y: 0, z: 0 },
    0,
    20,
    100,
    'fire',
  )
  let occupants = [{ id: 'edge', x: 3, z: 0 }, { id: 'outside', x: 3.1, z: 0 }]
  equal(occupants.filter((m) => within(a, m)).map((m) => m.id), ['edge'])
  occupants[0].x = 4
  occupants[1].x = 2
  equal(occupants.filter((m) => within(a, m)).map((m) => m.id), ['outside'])
  equal(pulse(a, 999), false)
  equal(pulse(a, 2500), true)
  equal(following(a, 2500), 3000)
  equal(pulse({ ...a, next: 3000 }, 2500), false)
  equal(pulse(a, 4001), false)
  // An allied page observes the same pulse even after the caster advances.
  equal(received({ ...a, next: 3000 }, 2500), 2000)
  equal(received({ ...a, next: 3000 }, 2600), 2000)
  equal(received(a, 4500), 0)
})

test('Store and descriptions share the ground effect authored shape', async () => {
  let a: Ability = {
    name: 'Ring',
    icon: 'sparkles',
    description: 'A lasting ring',
    shape: 'ring',
    pose: 'cast',
    far: 3,
    cool: 8000,
    effects: [{
      kind: 'area',
      ms: 4000,
      radius: 3,
      effects: [{ kind: 'damage', scale: .4 }],
    }],
  }
  equal(fits(a), true)
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab, plugins: [admitSchema(vocab)] })
  await g.apply([{
    entity: { eid: crypto.randomUUID() },
    ability_design: { kind: 'ring', ...a },
  }])
  equal(abilityStats(a, { blow: 20, max: 100 }), [
    '3 m radius',
    '3 m ground area for 4 s: 8 Damage per pulse',
  ])
})
