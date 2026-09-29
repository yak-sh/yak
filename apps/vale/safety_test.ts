// The villages' square and streets and the ways between places shelter a
// traveler, while creatures still live in the country beside them.
import { assert, assertEquals } from '@std/assert'
import { BEASTS } from './beasts.ts'
import { homesOf } from './homes.ts'
import { inVillage, prowl, rest, sheltered } from './sim.ts'
import { EDGE } from './streets.ts'
import { flat, hearthOf, streetsOf, vale, villageOf } from './terrain.ts'
import { lanesIn, nearWay, roadsOf } from './ways.ts'
import { seedBeasts } from './beasts_fixture.ts'

seedBeasts()

Deno.test('the fire and traveled paths shelter a traveler', () => {
  let v = vale(), hearth = hearthOf('mossvale')!
  assert(inVillage(...hearth))
  assertEquals(inVillage(hearth[0] + 20, hearth[1]), false)
  assert(sheltered(v, hearth[0] + 20, hearth[1]))

  let village = villageOf('mossvale')!
  let street = streetsOf(v, village), side = EDGE * 2 + 1
  for (let [j] of street.cells) {
    let x = hearth[0] + j % side - EDGE
    let z = hearth[1] + Math.floor(j / side) - EDGE
    assert(sheltered(v, x, z), `street at ${x}, ${z}`)
  }

  let c = roadsOf('mossvale').find((r) => r.to == 'reedmarsh')!.c
  let i = Math.floor(c.xs.length / 2)
  let dx = c.xs[i + 1] - c.xs[i - 1]
  let dz = c.zs[i + 1] - c.zs[i - 1]
  let len = Math.hypot(dx, dz)
  let [x, z] = [c.xs[i], c.zs[i]]
  assert(sheltered(v, x, z))
  assertEquals(nearWay(x - dz / len * 8, z + dx / len * 8, 3.5), false)
  let lane = lanesIn(0, 0, 256, 256, 0)[0]
  assert(sheltered(v, lane.xs[0], lane.zs[0]))
})

Deno.test('creatures live and wander off traveled paths', () => {
  let v = vale()
  for (let id of ['mossvale', 'birchmere', 'fernwood']) {
    let homes = homesOf(id)
    assert(homes.length > 0)
    for (let h of homes) {
      assert(!sheltered(v, ...h.home), `${id}: ${h.kind} home`)
      for (let t of [0, 22_500, 45_000, 90_000]) {
        let b = rest(v, h.home, h.roam, h.seed, t)
        assert(!sheltered(v, b.x, b.z), `${id}: ${h.kind} wander`)
        for (let i = 1; i < 10; i++) {
          let x = h.home[0] + (b.x - h.home[0]) * i / 10
          let z = h.home[1] + (b.z - h.home[1]) * i / 10
          assert(!sheltered(v, x, z), `${id}: ${h.kind} crossed a path`)
        }
      }
    }
  }
  assert(homesOf('mossvale').some((h) => h.kind == 'slime'))
  assert(homesOf('mossvale').some((h) => h.kind == 'thornback'))
  assert(homesOf('birchmere').some((h) => h.kind == 'slime'))
})

Deno.test('a creature pursuing a traveler stops at a road', () => {
  let c = roadsOf('mossvale').find((r) => r.to == 'reedmarsh')!.c
  let i = Math.floor(c.xs.length / 2)
  let dx = c.xs[i + 1] - c.xs[i - 1]
  let dz = c.zs[i + 1] - c.zs[i - 1]
  let len = Math.hypot(dx, dz)
  let [x, z] = [c.xs[i] - dz / len * 8, c.zs[i] + dx / len * 8]
  let v = flat(6)
  v.world = true
  let b = { x, y: 6, z, vy: 0, yaw: 0, speed: 0, gait: 'idle' }
  for (let j = 0; j < 100; j++) {
    b = prowl(v, b, BEASTS.boar, [x, z], 8, 1, j * 50, 0.05, {
      x: c.xs[i],
      z: c.zs[i],
    })
    assert(!sheltered(v, b.x, b.z))
  }
  assert(Math.hypot(b.x - x, b.z - z) > 2)
})
