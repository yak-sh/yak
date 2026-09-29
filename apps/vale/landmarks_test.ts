// Frontier landmarks grow through the world's ordinary ground and prop doors.
import { assert } from '@std/assert'
import { levelAt } from './levels.ts'
import { spotOf } from './regions.ts'
import { builtOf, propsNear, rise, vale, wallsNear, WATER } from './terrain.ts'
import { bridgePartsIn, roadsOf } from './ways.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

let landmark = (kind: string) => {
  for (let gz = -2; gz <= 2; gz++) {
    for (let gx = 5; gx <= 8; gx++) {
      let lv = levelAt(gx, gz)
      let name = Object.keys(lv.places).find((name) =>
        lv.places[name].kind == kind
      )
      if (name) return { lv, name, at: spotOf(lv.id, name)! }
    }
  }
  throw new Error(`No ${kind} grew in the nearby frontier`)
}

Deno.test('frontier valleys shape the ground and castles stand in it', () => {
  let valley = landmark('valley')
  let [x, z] = valley.at
  assert(rise(x + 35, z) > rise(x, z) + 2)

  let castle = landmark('castle')
  let built = builtOf(castle.lv.id)
  assert(built.some((p) => p.kind == 'walltower'))
  assert(built.some((p) => p.kind == 'rampart'))
  let standing = propsNear(vale(1), ...castle.at, 20)
  assert(standing.some((p) => p.kind == 'walltower'))
  assert(standing.some((p) => p.kind == 'rampart'))
})

Deno.test('a river crossing has stone parapets and a clear dry deck', () => {
  let road = roadsOf('clovermead').find((r) =>
    [r.from, r.to].sort().join('/') == 'clovermead/fernwood'
  )!
  let [x0, z0, x1, z1] = road.c.box
  let parts = bridgePartsIn(x0 - 4, z0 - 4, x1 + 4, z1 + 4)
  assert(parts.some((p) => p.kind == 'bridgewall'))
  assert(parts.some((p) => p.kind == 'bridgepost'))
  let mid = parts[Math.floor(parts.length / 2)]
  let i = Array.from(road.c.xs.keys()).find((i) =>
    Math.hypot(road.c.xs[i] - mid.x, road.c.zs[i] - mid.z) < 3
  )!
  let x = road.c.xs[i], z = road.c.zs[i]
  assert(rise(x, z) > WATER)
  assert(propsNear(vale(1), x, z, 6).some((p) => p.kind == 'bridgewall'))
  assert(
    wallsNear(vale(1), x, z).every((w) =>
      Math.hypot(w.x - x, w.z - z) > w.r + 0.5
    ),
  )

  let north = roadsOf('elderglade').find((r) =>
    [r.from, r.to].sort().join('/') == 'elderglade/frontier_0_-3'
  )!
  let [w, n, e, s] = north.c.box
  let turned = bridgePartsIn(w - 4, n - 4, e + 4, s + 4)
    .find((p) => p.kind == 'bridgewall' && p.turn == 1)!
  assert(
    wallsNear(vale(1), turned.x, turned.z).some((wall) =>
      Math.abs(wall.x - turned.x) < 0.01 &&
      Math.abs(wall.z - turned.z) > 0.4 &&
      Math.abs(wall.z - turned.z) < 0.7
    ),
  )
})
