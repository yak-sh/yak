import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { cellsOf } from './chartbook.ts'
import { coverage } from './chartcover.ts'
import { SIZE } from './levels.ts'
import { WORLD } from './mapview.ts'
import { regionCandidates, regionOf } from './regions.ts'
import { CHUNK } from './terrain.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

let regionsIn = ([ci, ck]: [number, number]) => {
  let ids = new Set<string>()
  for (let z = 0; z < CHUNK; z++) {
    for (let x = 0; x < CHUNK; x++) {
      ids.add(regionOf(ci * CHUNK + x + 0.5, ck * CHUNK + z + 0.5))
    }
  }
  return ids
}

test('candidate regions contain every sampled owner along warped borders and frontier', () => {
  for (
    let [x, z, side] of [[-32, 48, 320], [-320, -320, SIZE], [5000, 64, 96]]
  ) {
    let candidates = regionCandidates(x, z, side)
    for (let dz = 0.5; dz < side; dz += 7) {
      for (let dx = 0.5; dx < side; dx += 7) {
        assert(candidates.has(regionOf(x + dx, z + dz)))
      }
    }
  }
})

test('coverage retains explored slivers outside the region lattice cell', () => {
  let cover = coverage(), known = new Set(['mossvale']), bent = false
  for (let cell of cellsOf([-32, 48, 320])) {
    let visible = regionsIn(cell).has('mossvale')
    assertEquals(cover(cell, known), visible)
    if (
      visible &&
      (cell[0] < 0 || cell[0] >= SIZE / CHUNK || cell[1] >= SIZE / CHUNK)
    ) bent = true
  }
  assert(bent)
})

test('WORLD cells far from explored ground need no detailed sampling', () => {
  let samples = 0
  let cover = coverage(() => {
    samples++
    throw new Error('unknown ground must be pruned before sampling')
  })
  for (let cell of cellsOf([WORLD[0], WORLD[1], SIZE])) {
    assertEquals(cover(cell, new Set(['mossvale'])), false)
  }
  assertEquals(samples, 0)
})

test('grown region metadata bypasses geometry and retires with the charts', () => {
  let samples = 0,
    cover = coverage((x, z) => {
      samples++
      return regionOf(x, z)
    })
  cover.keep([0, 0], ['kept'])
  assertEquals(cover([0, 0], new Set(['kept'])), true)
  assertEquals(cover([0, 0], new Set(['mossvale'])), false)
  assertEquals(samples, 0)
  cover.clear()
  assertEquals(cover([0, 0], new Set(['mossvale'])), true)
  assert(samples > 0)
})

test('new exploration resumes a boundary scan without sampling any pixel twice', () => {
  let cell = cellsOf([-32, 48, 320]).find((cell) => regionsIn(cell).size > 1)!
  assert(cell)
  let ids = [...regionsIn(cell)], visits = new Map<string, number>()
  let cover = coverage((x, z) => {
    let key = `${x},${z}`
    visits.set(key, (visits.get(key) ?? 0) + 1)
    return regionOf(x, z)
  })
  for (let id of ids) assertEquals(cover(cell, new Set([id])), true)
  for (let id of ids) assertEquals(cover(cell, new Set([id])), true)
  assert([...visits.values()].every((n) => n == 1))
})
