// A changed design changes the rendered building without changing its kind.
import { test } from '@yaks/testing'
import { assert } from '@std/assert'
import { BUILDINGS } from '../buildings.ts'
import type { Bundle } from '../net.ts'
import { builtOf, installBuildingDesigns, vale } from '../terrain.ts'
import rows from '../seed/buildings/plans.json' with { type: 'json' }
import { seedThemes } from '../themes_fixture.ts'

test('an edited building design replaces its visible shape', () => {
  seedThemes()
  installBuildingDesigns(rows as Bundle[])
  let before = BUILDINGS['cottage.plaster'].raise!(0).vox.size
  let v = vale(),
    spot = builtOf('mossvale').find((p) => p.kind == 'cottage.plaster')!
  let first = v.buildings(spot.x, spot.z, 0).find((b) => b.kind == spot.kind)!
  let edited = rows.map((row) =>
    row.building_design.kind == 'cottage'
      ? {
        ...row,
        building_design: {
          ...row.building_design,
          details: [
            ...row.building_design.details ?? [],
            { kind: 'place', piece: 'barrel', at: [0, 4] },
          ],
        },
      }
      : row
  )
  try {
    installBuildingDesigns(edited as Bundle[])
    assert(BUILDINGS['cottage.plaster'].raise!(0).vox.size > before)
    let next = v.buildings(spot.x, spot.z, 0).find((b) => b.kind == spot.kind)!
    assert(next.solid.runs.length > first.solid.runs.length)
  } finally {
    installBuildingDesigns(rows as Bundle[])
  }
})
