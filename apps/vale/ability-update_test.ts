// An update changes shipped fields only, never a person's competing design.
import { equal, test } from '@yaks/testing'
import { graph, token } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { cleaned, updated } from './ability-update.ts'
import words from './vocab.json' with { type: 'json' }
import { rows } from './abilities_fixture.ts'
import { ABILITIES, useAbilities } from './abilities.ts'
import { effect } from './ability-effects.ts'
import { applied, elapsed } from './status.ts'
import { planted, within } from './areas.ts'

test('targeted seed update preserves authored effects and refuses a racing edit', async () => {
  let row = rows[0],
    before = [{
      ...row,
      ability_design: {
        ...row.ability_design,
        description: 'Before',
        effects: [{ kind: 'damage', scale: 1 }],
      },
    }]
  let after = [{
    ...before[0],
    ability_design: {
      ...before[0].ability_design,
      description: 'After',
      effects: [{ kind: 'damage', scale: 2 }],
    },
  }]
  let authored = [{
    ...before[0],
    ability_design: {
      ...before[0].ability_design,
      effects: [{ kind: 'damage', scale: 3 }],
    },
  }]
  equal(updated(authored, before, after)[0].ability_design, {
    description: 'After',
  })
  let vocab = loadVocab([words]), g = graph({ storage: ram(vocab), vocab })
  await g.apply(before)
  let patches = updated(await g.read('.ability_design'), before, after)
  equal(
    patches[0].$was?.ability_design.effects,
    token(before[0].ability_design.effects),
  )
  await g.apply(patches)
  equal(updated(await g.read('.ability_design'), before, after), [])
  await g.apply(before)
  let raced = updated(await g.read('.ability_design'), before, after)
  await g.apply(authored)
  let refused = false
  try {
    await g.apply(raced)
  } catch {
    refused = true
  }
  equal(refused, true)
  equal(
    cleaned([{
      ...authored[0],
      ability_design: { ...authored[0].ability_design, dmg: 1 },
    }])[0].ability_design,
    { dmg: null },
  )
})

test('seeded Blaze leaves a burning ring and most weapon families use lasting effects', () => {
  useAbilities(rows)
  let blaze = effect(ABILITIES.blaze.effects, 'area')!
  equal(blaze.radius, 2.5)
  let area = planted(
    blaze,
    'hero',
    'mossvale',
    'Blaze',
    { x: 0, y: 0, z: 0 },
    0,
    20,
    100,
    'fire',
  )
  equal(within(area, { x: 2, z: 0 }), true)
  equal(effect(area.effects, 'damage')?.scale, .3)
  let hot = effect(ABILITIES.mend.effects, 'hot')!
  equal(elapsed(applied(hot, 'hero', 0, 'Mend', 0, 20, 100), 5000).amount, 15)
  let families = new Set(
    rows.filter((r) =>
      r.ability_design.effects.some((e) =>
        ['area', 'dot', 'hot', 'buff', 'debuff', 'bleed'].includes(e.kind)
      )
    ).map((r) => r.ability_design.weapon ?? r.ability_design.offhand),
  )
  equal(families.size >= 7, true)
})
