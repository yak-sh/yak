// Village streets reach the buildings as placed, and their grown ground is
// walkable at the voxel size a nearby hero sees.
import { assert, assertEquals } from '@std/assert'
import { LEVELS } from './levels.ts'
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

let villages = Object.keys(LEVELS).flatMap((id) => {
  let at = hearthOf(id)
  return at ? [villagesNear(...at, 1)[0]] : []
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
    let at = (j: number) =>
      [cx + j % 93 - 46, cz + Math.floor(j / 93) - 46] as [number, number]
    for (let [j] of street.cells) {
      let [x, z] = at(j), cold = groundAt(v, x, z)
      let ci = chunkOf(x), ck = chunkOf(z), key = chunkKey(ci, ck)
      if (!v.patches.has(key)) v.patches.set(key, v.grow(ci, ck))
      assertEquals(groundAt(v, x, z), cold, `${id}: cold and grown ground`)
    }
    for (let [j] of street.cells) {
      let [x, z] = at(j), y = groundAt(v, x, z)
      for (let next of [j + 1, j + 93]) {
        if (next == j + 1 && j % 93 == 92 || !street.cells.has(next)) {
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
  let cottage = builtOf('palmwell').find((p) => p.kind.startsWith('cottage.'))!
  let b = buildingOf(v, cottage)!, z = b.foot[3]
  let plot = groundAt(v, b.x, z + 1)
  let edge = groundAt(v, b.x, z + 2)
  let slope = groundAt(v, b.x, z + 4)
  assertEquals(plot, b.y)
  assert(plot > edge && edge > slope)
  assert(
    propsNear(v, b.x, z + 2.2, 3).some((p) => p.kind.startsWith('retaining.')),
  )
})
