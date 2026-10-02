// A page moving a hero and creatures respects pace per mover, not per page.
import { equal, test } from '@yaks/testing'
import { admission } from './admission.ts'

let movers = (at: number) =>
  ['hero', 'first', 'second', 'third'].map((eid) => ({
    entity: { eid },
    position: { x: at, z: 0 },
    motion: { vx: 1 },
  }))

test('several movers keep relaying together at their declared pace', () => {
  let now = 0
  let admit = admission(() => 100, () => now)
  for (; now <= 3000; now += 100) equal(admit(movers(now)), 'accept')
})

test('one mover cannot spend another movers relay allowance', () => {
  let now = 0
  let admit = admission(() => 100, () => now)
  let first = movers(0).slice(0, 1)
  equal(admit(first), 'accept')
  now = 16
  equal(admit(first), 'accept')
  now = 32
  equal(admit(first), 'skip')
  now = 48
  equal(admit(movers(0).slice(1)), 'accept')
})
