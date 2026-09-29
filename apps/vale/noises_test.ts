import { test } from '@yaks/testing'
import { seedBuildings } from './buildings_fixture.ts'
import { seedBeasts } from './beasts_fixture.ts'
import { assert, assertEquals } from '@std/assert'
import { NEAR } from './ears.ts'
import { ambience, noises } from './noises.ts'
import { builtOf, groundAt, hearthOf, vale } from './terrain.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

seedBuildings()
seedBeasts()

test('village fire is near the square but not beyond surrounding buildings', () => {
  // The fire loop uses NEAR's exponential panner: by the outer homes its
  // gain is a small fraction of what is heard beside the hearth.
  let { refDistance, rolloffFactor, distanceModel } = NEAR.pan
  assert(distanceModel == 'exponential')
  let volume = (d: number) =>
    (Math.max(d, refDistance) / refDistance) ** -rolloffFactor
  assert(volume(8) > 0.1 && volume(28) < 0.02)
  let v = vale()
  for (let id of ['mossvale', 'stonestep', 'dustmere', 'palmwell']) {
    let [x, z] = hearthOf(id)!
    let heard = (dx: number) =>
      ambience(v, [x + dx, groundAt(v, x, z) + 1, z])
        .some((a) => a.id == `hearth:${x},${z}`)
    assert(heard(8), `${id}: fire missing near the square`)
    let farthest = Math.max(
      ...builtOf(id).filter((p) =>
        /^(house|farmhouse|smithy|inn|hall)\./.test(p.kind)
      ).map((p) => Math.hypot(p.x - x, p.z - z)),
    )
    assert(farthest < 30, `${id}: buildings exceed fire range`)
    assert(!heard(farthest + 10), `${id}: fire heard beyond buildings`)
  }
})

test('a wolf bite keeps its kind for the recorded cry', () => {
  let body = { x: 0, y: 5, z: 0, vy: 0, yaw: 0, speed: 0, gait: 'idle' }
  let scene = (kind: string, bite: number) => ({
    body,
    others: [],
    mobs: [{ eid: 'wolf-1', kind, body, down: false, bite }],
  })
  for (let kind of ['wolf', 'direwolf', 'frostwolf']) {
    let hear = noises()
    hear(scene(kind, -1), 'hero', 1 / 60, () => 1)
    assertEquals(
      hear(scene(kind, 0.1), 'hero', 1 / 60, () => 1)
        .filter((n) => n.type == 'cry').map((n) => n.kind),
      [kind],
    )
  }
})
