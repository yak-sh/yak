// Mouse casts land along their ray, bounded by reach, without a chosen foe.
import { equal, test } from '@yaks/testing'
import { seedDesigns } from './designs_fixture.ts'
import { ABILITIES } from './abilities.ts'
import { HANDLES } from './arms.ts'
import { type Kit, kitOf } from './gear.ts'
import { beastId } from './beasts.ts'
import { cursor, groundRay, landing, pickRay } from './aim.ts'
import { aimOf, takenBy } from './strike.ts'

seedDesigns()
test('mouse ray meets terrain; pointer lock uses the centre', () => {
  equal(cursor(75, 25, 100, 100, false), [0.5, 0.5])
  equal(cursor(75, 25, 100, 100, true), [0, 0])
  let p = groundRay({ x: 0, y: 4, z: 0 }, { x: 0, y: -0.5, z: 0.5 }, () => 0)
  equal(p, { x: 0, y: 0, z: 4 })
  equal(landing({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 20 }, 8), {
    x: 0,
    y: 0,
    z: 8,
  })
})

test('a cast with no selected target lands at the mouse', () => {
  let beast = beastId('beast:slime')!
  let mark = (eid: string, x: number, z: number) => ({
    eid,
    beast,
    down: false,
    near: Math.hypot(x, z),
    body: { x, z },
  })
  let mobs = [mark('mouse', 4, 0), mark('ahead', 0, 4)]
  let me = { x: 0, z: 0, yaw: Math.PI / 2 }
  let kit: Kit = { ...kitOf({}), ...HANDLES.staff, family: 'staff' }
  let point = { x: 4, y: 0, z: 0 }
  equal(
    takenBy(ABILITIES.blaze, mobs, me, kit, null, point)
      .map((m) => m.eid),
    ['mouse'],
  )
  equal(takenBy(ABILITIES.blaze, mobs, me, kit, null).length, 0)
})

test('mouse chooses a foe and a click keeps the explicitly chosen foe', () => {
  let beast = beastId('beast:slime')!
  let at = (eid: string, x: number, z: number) => ({
    eid,
    beast,
    down: false,
    near: Math.hypot(x, z),
    body: { x, z },
  })
  let mobs = [at('near', 0, 2), at('mouse', 4, 2)]
  let kit: Kit = { ...kitOf({}), ...HANDLES.bow, family: 'bow' }
  let point = { x: 4, y: 0, z: 2 }
  equal(aimOf(mobs, { x: 0, z: 0, yaw: 0 }, kit, '', [], point)?.eid, 'mouse')
  equal(
    aimOf(mobs, { x: 0, z: 0, yaw: 0 }, kit, '', [], point, 'near')?.eid,
    'near',
  )
  equal(
    aimOf(
      [{ ...mobs[0], down: true }, mobs[1]],
      { x: 0, z: 0, yaw: 0 },
      kit,
      '',
      [],
      point,
      'near',
    )?.eid,
    'mouse',
  )
  let marks = mobs.map((m) => ({
    ...m,
    body: { ...m.body, y: 1 },
    radius: 0.5,
  }))
  equal(
    pickRay(marks, { x: 4, y: 1, z: -5 }, { x: 0, y: 0, z: 1 })?.eid,
    'mouse',
  )
  equal(pickRay(marks, { x: 4, y: 1, z: -5 }, { x: 0, y: 0, z: 1 }, 2), null)
})
