// Generated country remains the same on every page and gets harder outward.
import { test } from '@yaks/testing'
import { seedBuildings } from './buildings_fixture.ts'
import { assert, assertEquals } from '@std/assert'
import { foeOf } from './danger.ts'
import { dens, homesOf } from './homes.ts'
import { frontierId } from './frontier.ts'
import { hopsOf, levelAt, levelOf, LEVELS, SIZE } from './levels.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()
import { regionOf } from './regions.ts'
import { roadsOf } from './ways.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

seedBuildings()

test('frontier cells grow named lands with their own terrain and wildlife', () => {
  let near = levelAt(5, 0), far = levelAt(10, 0)
  assertEquals(levelOf(near.id), near)
  assertEquals(levelOf('frontier_0_0'), undefined)
  assert(near.name.length > 4)
  assert(near.wild && near.look && Object.keys(near.places).length > 3)
  assertEquals(regionOf(5 * SIZE + SIZE / 2, SIZE / 2), near.id)
  assert(dens(near).length > 0)
  assert(homesOf(near.id).length > 0)
  assert(hopsOf(far.id) > hopsOf(near.id))
  let beast = dens(near)[0].beast
  assert(foeOf(beast, far.id)!.lvl > foeOf(beast, near.id)!.lvl)
})

test('roads carry the frontier into authored country and onward', () => {
  let edge = levelAt(5, 0)
  assertEquals(edge.id, frontierId(5, 0))
  assertEquals(LEVELS.frostpine.cell, [4, 0])
  let roads = roadsOf(edge.id)
  assert(roads.some((r) => [r.from, r.to].includes('frostpine')))
  assert(roads.some((r) => [r.from, r.to].includes(frontierId(6, 0))))
})
