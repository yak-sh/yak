import { test } from '@yaks/testing'
import { seedBuildings } from './buildings_fixture.ts'
import { seedBeasts } from './beasts_fixture.ts'
import { seedFigures } from './figures_fixture.ts'
import { beastOf } from './beasts.ts'
import { assert, assertEquals } from '@std/assert'
import { NEAR } from './ears.ts'
import { ambience, noises } from './noises.ts'
import { builtOf, groundAt, hearthOf, vale } from './terrain.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

seedBuildings()
seedBeasts()
seedFigures()

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

test('a creature cries with its own sound row', () => {
  let body = { x: 0, y: 5, z: 0, vy: 0, yaw: 0, speed: 0, gait: 'idle' }
  let scene = (beast: string, bite: number) => ({
    body,
    others: [],
    mobs: [{ eid: 'it', beast, body, down: false, bite }],
  })
  for (let name of ['wolf', 'slime', 'hen']) {
    let hear = noises()
    let beast = beastOf(`beast:${name}`)!
    hear(scene(beast.eid, -1), 'hero', 1 / 60, () => 1)
    assertEquals(
      hear(scene(beast.eid, 0.1), 'hero', 1 / 60, () => 1)
        .filter((n) => n.type == 'cry').map((n) => n.sfx),
      [beast.cry],
    )
  }
})

let creatureScene = (bite = -1, down = false) => {
  let body = { x: 0, y: 5, z: 0, vy: 0, yaw: 0, speed: 0, gait: 'idle' }
  return {
    body,
    others: [],
    mobs: [{
      eid: 'wolf',
      beast: beastOf('beast:wolf')!.eid,
      body,
      down,
      bite,
    }],
  }
}

test('wandering creatures call rarely instead of filling the soundscape', () => {
  let hear = noises(), scene = creatureScene()
  assertEquals(hear(scene, 'hero', 1 / 60, () => 0.0005), [])
  let cries = hear(scene, 'hero', 1 / 60, () => 0)
  assertEquals(cries.map((n) => n.type), ['cry'])
  assertEquals(hear(scene, 'hero', 1, () => 0), [])
  assertEquals(hear(scene, 'hero', 7, () => 0).length, 1)
  assertEquals(hear(creatureScene(-1, true), 'hero', 120, () => 0), [])
})

test('repeated bites leave a pause between cries and creatures keep separate voices', () => {
  let hear = noises()
  let cries = (bite: number, dt: number) =>
    hear(creatureScene(bite), 'hero', dt, () => 1)
  assertEquals(cries(0.1, 0.1).length, 1)
  assertEquals(cries(-1, 1), [])
  assertEquals(cries(0.1, 1), [])
  assertEquals(cries(-1, 6), [])
  assertEquals(cries(0.1, 0.1).length, 1)
  let scene = creatureScene(0.1)
  scene.mobs[0].eid = 'another-wolf'
  assertEquals(hear(scene, 'hero', 0.1, () => 1).length, 1)
})
