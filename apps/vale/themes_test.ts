// A changed region design reaches authored lands and already-grown frontier.
import { test } from '@yaks/testing'
import { assertEquals, assertNotEquals } from '@std/assert'
import { seedBuildings } from './buildings_fixture.ts'
import { levelAt, levelOf, useThemes } from './levels.ts'
import { blend } from './regions.ts'
import {
  installThemeDesigns,
  patchOf,
  refreshTerrain,
  vale,
} from './terrain.ts'
import rows from './seed/themes.json' with { type: 'json' }

test('region themes replace the cover and look of a land and its frontier', () => {
  useThemes(rows)
  let before = levelAt(5, 0)
  let changed = rows.map((row) => ({
    ...row,
    theme_design: {
      ...row.theme_design,
      look: { ...row.theme_design.look, sky: 0x123456 },
    },
  }))
  try {
    useThemes(changed)
    assertEquals(levelOf('birchmere')?.look?.sky, 0x123456)
    assertEquals(levelAt(5, 0).look?.sky, 0x123456)
    assertEquals(levelAt(5, 0).id, before.id)
    assertEquals(levelAt(5, 0).places, before.places)
  } finally {
    useThemes(rows)
  }
})

test('a changed ground cover repaints an already-grown chunk', () => {
  useThemes(rows)
  seedBuildings()
  let v = vale(1), before = patchOf(v, 3, 9)
  let changed = rows.map((row) =>
    row.theme_design.land == 'mossvale'
      ? { ...row, theme_design: { ...row.theme_design, wild: 'ashfield' } }
      : row
  )
  try {
    useThemes(changed)
    refreshTerrain()
    assertNotEquals([...patchOf(v, 3, 9).top], [...before.top])
  } finally {
    useThemes(rows)
    refreshTerrain()
  }
})

test('frontier boundaries follow changed region themes', () => {
  installThemeDesigns(rows)
  let before = blend(1280, -128)
  let changed = rows.map((row) => ({
    ...row,
    theme_design: {
      ...row.theme_design,
      frontier: row.theme_design.land == 'fernwood' ? 0 : undefined,
    },
  }))
  try {
    installThemeDesigns(changed)
    assertNotEquals(blend(1280, -128), before)
  } finally {
    installThemeDesigns(rows)
  }
})
