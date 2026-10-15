// Tick deadlines, expiry and modifiers are independent of frames and peers.
import { equal, test } from '@yaks/testing'
import { applied, carries, factor, refreshed } from './status.ts'
import { changed } from './ability-effects.ts'
import { type Ability, abilityStats } from './abilities.ts'
import { graph } from '@yaks/graph'
import { admitSchema } from '@yaks/graph/schema'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import words from './vocab.json' with { type: 'json' }

test('new lasting effects are admitted, described and skill-replaced', async () => {
  let effects = changed([{ kind: 'dot', scale: 1, ms: 4000 }], [
    { kind: 'dot', scale: 2, ms: 6000 },
    { kind: 'debuff', stat: 'speed', share: .2, ms: 4000 },
  ])
  let a: Ability = {
    name: 'Chill',
    icon: 'sparkles',
    description: 'A cold gust',
    shape: 'one',
    pose: 'cast',
    cool: 4000,
    effects,
  }
  let vocab = loadVocab([words])
  let g = graph({ storage: ram(vocab), vocab, plugins: [admitSchema(vocab)] })
  await g.apply([{
    entity: { eid: crypto.randomUUID() },
    ability_design: { kind: 'chill', ...a },
  }])
  equal(abilityStats(a, { blow: 20, max: 100 }), [
    '40 Damage over 6 s',
    '-20% speed for 4 s',
  ])
  equal(effects.length, 2)
  let refused = false
  try {
    await g.apply([{
      entity: { eid: crypto.randomUUID() },
      ability_design: {
        kind: 'too-short',
        ...a,
        effects: [{ kind: 'dot', scale: 1, ms: 500 }],
      },
    }])
  } catch {
    refused = true
  }
  equal(refused, true)
})

test('Mossvale supplies periodic amounts, modifier signs and accepted kinds', () => {
  let burn = applied(
    { kind: 'dot', scale: 2, ms: 4000 },
    'foe',
    7,
    'Burn',
    0,
    20,
    100,
    'burn',
  )
  let slow = applied(
    { kind: 'debuff', stat: 'speed', share: .4, ms: 3000 },
    'foe',
    7,
    'Slow',
    0,
    20,
    100,
  )
  equal(burn.amount, 10)
  equal(factor([slow], 'foe', 'speed', 1000, 7), .6)
  equal(factor([slow], 'foe', 'speed', 1000, 8), 1)
  equal(carries([burn, { ...burn, kind: 'not-mossvale' }]), [burn])
  equal(refreshed([burn], { ...burn, next: 2000, amount: 50 })[0].amount, 10)
})
