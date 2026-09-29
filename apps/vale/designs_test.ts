// A watched design edit keeps unrelated ground and refreshes the ground,
// buildings and collision where the changed design reaches.
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import buildings from './seed/buildings/plans.json' with { type: 'json' }
import themes from './seed/themes.json' with { type: 'json' }
import type { Bundle } from './net.ts'
import {
  adopt,
  builtOf,
  chunkOf,
  installBuildingDesigns,
  installThemeDesigns,
  patchOf,
  usedRegions,
  vale,
} from './terrain.ts'

Deno.test('one land theme keeps another land’s cached terrain', () => {
  let rows = themes as Bundle[]
  installThemeDesigns(rows)
  installBuildingDesigns(buildings as Bundle[])
  let v = vale(1), near = v.grow(-8, 8), far = v.grow(8, 8)
  adopt(v, near)
  adopt(v, far)
  let edited = themes.map((row) =>
    row.theme_design.land == 'birchmere'
      ? { ...row, theme_design: { ...row.theme_design, wild: 'meadow' } }
      : row
  ) as Bundle[]
  try {
    let affects = installThemeDesigns(edited)
    assert(affects(-8, 8, usedRegions(near)))
    assert(!affects(8, 8, usedRegions(far)))
    assertNotEquals(patchOf(v, -8, 8), near)
    assertEquals(patchOf(v, 8, 8), far)
  } finally {
    installThemeDesigns(rows)
  }
})

Deno.test('one building plan refreshes its terrain and collision', () => {
  let rows = buildings as Bundle[]
  installThemeDesigns(themes as Bundle[])
  installBuildingDesigns(rows)
  let v = vale(1)
  let p = builtOf('mossvale').find((p) => p.kind == 'cottage.plaster')!
  assert(p)
  let ci = chunkOf(p.x), ck = chunkOf(p.z)
  let before = v.buildings(p.x, p.z, 2).find((b) => b.kind == p.kind)!
  let local = v.grow(ci, ck), distant = v.grow(100, 100)
  adopt(v, local)
  adopt(v, distant)
  let edited = buildings.map((row) =>
    row.building_design.kind == 'cottage'
      ? {
        ...row,
        building_design: {
          ...row.building_design,
          size: [row.building_design.size[0] + 2, row.building_design.size[1]],
        },
      }
      : row
  ) as Bundle[]
  try {
    let { affects, kinds } = installBuildingDesigns(edited)
    assertEquals([...kinds], ['cottage'])
    assert(affects(ci, ck))
    assert(!affects(100, 100))
    assertNotEquals(patchOf(v, ci, ck), local)
    assertEquals(patchOf(v, 100, 100), distant)
    let after = v.buildings(p.x, p.z, 4).find((b) => b.kind == p.kind)!
    assert(after)
    assertNotEquals(after.foot, before.foot)
    let a = v.grow(ci, ck), b = v.grow(ci + 1, ck), n = a.n
    assertEquals(
      Array.from({ length: n }, (_, k) => a.layers[0][n - 1 + k * n]),
      Array.from({ length: n }, (_, k) => b.layers[0][1 + k * n]),
    )
  } finally {
    installBuildingDesigns(rows)
  }
})
