import { assertEquals, assertNotEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { chartKey } from './chartkey.ts'
import { rows as themes } from './themes_fixture.ts'
import { rows as buildings } from './buildings_fixture.ts'
import manifest from './tiles/manifest.json' with { type: 'json' }
import { comp } from './bundle.ts'

test('shipped tiles match seed designs irrespective of graph identity and order', async () => {
  let key = await chartKey(themes, buildings)
  assertEquals(key, manifest.key)
  let reordered = themes.toReversed().map((row) => ({
    ...row,
    entity: { eid: crypto.randomUUID() },
  }))
  assertEquals(await chartKey(reordered, buildings.toReversed()), key)
  let stored = themes.map((row) => ({
    ...row,
    theme_design: { look: null, frontier: null, ...comp(row, 'theme_design') },
  }))
  let plans = buildings.map((row) => ({
    ...row,
    building_design: {
      works: null,
      chimney: null,
      ...comp(row, 'building_design'),
    },
  }))
  assertEquals(await chartKey(stored, plans), key)
  assertNotEquals(await chartKey(themes.slice(1), buildings), key)
})
