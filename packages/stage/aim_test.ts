import { equal, test } from '@yaks/testing'
import { cursor, groundRay, landing, pickRay } from './aim.ts'

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

test('picking returns nearest sphere before the ground regardless of order', () => {
  let marks = [8, 3].map((z) => ({
    eid: String(z),
    body: { x: 0, y: 1, z },
    radius: 0.5,
  }))
  equal(pickRay(marks, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 })?.eid, '3')
  equal(pickRay(marks, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 2), null)
})
