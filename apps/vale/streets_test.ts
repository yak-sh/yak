// Village streets reach the buildings as placed, and their grown ground is
// walkable at the voxel size a nearby hero sees.
import { assert, assertEquals } from '@std/assert'
import { seedBuildings } from './buildings_fixture.ts'
import { LEVELS } from './levels.ts'
import { halfOf, KINDS } from './props.ts'
import { EDGE } from './streets.ts'
import { ROAD, roadsOf } from './ways.ts'
import {
  buildingOf,
  builtOf,
  chunkKey,
  chunkOf,
  groundAt,
  hearthOf,
  propsNear,
  streetsOf,
  vale,
  villagesNear,
} from './terrain.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

seedBuildings()

let villages = Object.keys(LEVELS).flatMap((id) => {
  let at = hearthOf(id)
  return at ? [villagesNear(...at, 1)[0]] : []
})

let gap = (
  p: { kind: string; turn?: number; x: number; z: number },
  x: number,
  z: number,
) => {
  let [w, d] = halfOf(p.kind, p.turn)
  return Math.hypot(
    Math.max(0, Math.abs(x - p.x) - w),
    Math.max(0, Math.abs(z - p.z) - d),
  )
}

Deno.test('village roads join the streets without crossing plots', () => {
  let v = vale(), side = EDGE * 2 + 1
  for (let village of villages) {
    let built = builtOf(village.level)
    let street = streetsOf(v, village)
    for (let road of roadsOf(village.level)) {
      let at = road.from == village.level
        ? [road.c.xs[0], road.c.zs[0]] as [number, number]
        : [road.c.xs.at(-1)!, road.c.zs.at(-1)!] as [number, number]
      assert(street.lay(...at, v.rise(...at))?.path, village.level)
    }
    for (let entry of street.entries) {
      assert(street.lay(...entry, v.rise(...entry))?.path, village.level)
    }
    for (let p of built) {
      for (let road of roadsOf(village.level)) {
        for (let i = 0; i < road.c.xs.length; i++) {
          assert(
            gap(p, road.c.xs[i], road.c.zs[i]) >= ROAD + 0.4,
            `${village.level}: ${p.kind} on road`,
          )
        }
      }
      if (KINDS[p.kind].raise) continue
      for (let [j] of street.cells) {
        let x = village.at[0] + j % side - EDGE
        let z = village.at[1] + Math.floor(j / side) - EDGE
        assert(gap(p, x, z) >= 0.9, `${village.level}: ${p.kind} on street`)
      }
    }
  }
})

Deno.test('each placed village door opens onto a clear street', () => {
  let v = vale()
  for (let village of villages) {
    let street = streetsOf(v, village)
    let buildings = builtOf(village.level).flatMap((p) => {
      let b = buildingOf(v, p)
      return b && Math.hypot(b.x - village.at[0], b.z - village.at[1]) < 44
        ? [b]
        : []
    })
    assertEquals(street.doors.length, buildings.flatMap((b) => b.doors).length)
    for (let b of buildings) {
      for (let d of b.doors) {
        let x = d.hinge[0] + d.along[0] * d.wide / 2 - d.into[0] * 2.4
        let z = d.hinge[2] + d.along[1] * d.wide / 2 - d.into[1] * 2.4
        assert(street.lay(x, z, b.y)?.path, `${village.level}: ${b.kind}`)
        assert(
          Math.abs(groundAt(v, x, z) - b.y) <= 0.55,
          `${village.level}: ${b.kind} landing`,
        )
        for (let other of buildings) {
          if (other == b) continue
          assert(
            x <= other.foot[0] - 0.5 || x >= other.foot[2] + 0.5 ||
              z <= other.foot[1] - 0.5 || z >= other.foot[3] + 0.5,
            `${village.level}: ${b.kind} doorway meets ${other.kind}`,
          )
        }
      }
    }
  }
})

Deno.test('grown streets climb by walkable steps and match cold ground', () => {
  let v = vale()
  for (let id of ['mossvale', 'stonestep', 'dustmere', 'palmwell']) {
    let village = villages.find((p) => p.level == id)!
    let street = streetsOf(v, village), [cx, cz] = village.at
    let side = EDGE * 2 + 1
    let at = (j: number) =>
      [cx + j % side - EDGE, cz + Math.floor(j / side) - EDGE] as [
        number,
        number,
      ]
    for (let [j] of street.cells) {
      let [x, z] = at(j), cold = groundAt(v, x, z)
      let ci = chunkOf(x), ck = chunkOf(z), key = chunkKey(ci, ck)
      if (!v.patches.has(key)) v.patches.set(key, v.grow(ci, ck))
      assertEquals(groundAt(v, x, z), cold, `${id}: cold and grown ground`)
    }
    for (let [j] of street.cells) {
      let [x, z] = at(j), y = groundAt(v, x, z)
      for (let next of [j + 1, j + side]) {
        if (next == j + 1 && j % side == side - 1 || !street.cells.has(next)) {
          continue
        }
        let [a, c] = at(next)
        assert(
          Math.abs(groundAt(v, a, c) - y) <= 0.55,
          `${id}: rise at ${x}, ${z}`,
        )
      }
    }
  }
})

Deno.test('a hillside plot levels into its retaining wall', () => {
  let v = vale()
  let slopes = 0
  for (let p of builtOf('palmwell')) {
    let b = buildingOf(v, p)
    if (!b) continue
    let [w, n, e, s] = b.foot
    for (
      let [x, z, dx, dz] of [
        [b.x, s, 0, 1],
        [b.x, n, 0, -1],
        [e, b.z, 1, 0],
        [w, b.z, -1, 0],
      ]
    ) {
      let [plot, edge, slope] = [1, 2, 4].map((out) =>
        groundAt(v, x + dx * out, z + dz * out)
      )
      if (plot != b.y || plot <= edge || edge <= slope) continue
      slopes++
      assert(
        propsNear(v, x + dx * 2.2, z + dz * 2.2, 3).some((p) =>
          p.kind.startsWith('retaining.')
        ),
        `${p.kind} downhill wall`,
      )
    }
  }
  assert(slopes > 0)
})
