// Ground pulses use current occupants and a game's own effect payload.
import { equal, test } from '@yaks/testing'
import { areas, following, planted, pulse, received, within } from './areas.ts'

test('ground area hits current occupants, not original targets', () => {
  let a = planted(
    {
      kind: 'area',
      ms: 4000,
      radius: 3,
      effects: [{ kind: 'chill', share: .4 }],
    },
    'caster',
    'mossvale',
    'Blaze',
    { x: 0, y: 0, z: 0 },
    0,
    { power: 20, element: 'fire' },
  )
  equal(a.power, 20)
  equal(a.effects, [{ kind: 'chill', share: .4 }])
  equal(areas([a, {}, null]), [a])
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
