// Tick deadlines, expiry and modifiers are independent of frames and peers.
import { equal, test } from '@yaks/testing'
import { applied, elapsed, factor, labels } from './status.ts'
import { changed } from './ability-effects.ts'
import { type Ability, abilityStats } from './abilities.ts'
import { graph } from '@yaks/graph'
import { admitSchema } from '@yaks/graph/schema'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import words from './vocab.json' with { type: 'json' }

test('damage and healing tick exactly through expiry even after a late frame', () => {
  let dot = applied(
    { kind: 'dot', scale: 2, ms: 4000 },
    'mob',
    7,
    'Burn',
    0,
    20,
    100,
  )
  equal(elapsed(dot, 999).amount, 0)
  let one = elapsed(dot, 1000)
  equal(one.amount, 10)
  equal(elapsed({ ...dot, next: one.next }, 9000).amount, 30)
  equal(elapsed({ ...dot, next: 5000 }, 9000).amount, 0)
  let hot = applied(
    { kind: 'hot', share: .3, ms: 3000 },
    'hero',
    0,
    'Mend',
    0,
    20,
    100,
  )
  equal(elapsed(hot, 3000).amount, 30)
})

test('buffs and debuffs affect only their carrier and lifetime', () => {
  let buff = applied(
    { kind: 'buff', stat: 'damage', share: .3, ms: 4000 },
    'hero',
    0,
    'Rally',
    0,
    20,
    100,
  )
  let debuff = applied(
    { kind: 'debuff', stat: 'speed', share: .4, ms: 3000 },
    'mob',
    7,
    'Slow',
    0,
    20,
    100,
  )
  equal(factor([buff, debuff], 'hero', 'damage', 1000), 1.3)
  equal(factor([buff, debuff], 'mob', 'speed', 1000, 7), .6)
  equal(factor([debuff], 'mob', 'speed', 1000, 8), 1)
  equal(factor([buff], 'hero', 'damage', 4000), 1)
  equal(labels([buff], 1000), 'Rally 3s')
})

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
})
