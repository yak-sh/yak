// Ground pulses select current occupants, and allied recipients own healing.
import { equal, test } from '@yaks/testing'
import { fits } from './ability-design.ts'
import { type Ability, abilityStats } from './abilities.ts'
import { graph } from '@yaks/graph'
import { admitSchema } from '@yaks/graph/schema'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import words from './vocab.json' with { type: 'json' }

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
