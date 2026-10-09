import { assertEquals, assertNotEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { chart, chartPatch, chartRegions } from './chart.ts'
import { Top } from './features.ts'
import { useThemes } from './levels.ts'
import { adopt, CHUNK, flat, patchOf, vale } from './terrain.ts'
import { rows, seedThemes } from './themes_fixture.ts'

seedThemes()

let ground = (voxel: number, height = 8) => {
  let p = flat(height, [], [], voxel).grow(0, 0)
  p.layers[0].fill(height / voxel)
  p.top.fill(Top.grass)
  return p
}

let pixel = (px: Uint8ClampedArray, x: number, z: number) =>
  Array.from(px.slice((x + z * CHUNK) * 4, (x + z * CHUNK + 1) * 4))

test('the map paints adopted ground without growing it again', () => {
  let v = flat(8, [], [], 0.25), p = ground(v.voxel)
  adopt(v, p)
  v.grow = () => {
    throw new Error('charted ground must already be grown')
  }
  let px = chartPatch(patchOf(v, 0, 0))
  assertEquals(px.length, CHUNK * CHUNK * 4)
  assertEquals(px, chartPatch(p))
})

test('the same flat cover and water paint alike at finer and coarser voxel edges', () => {
  for (let height of [8, 0]) {
    let px = chartPatch(ground(1, height))
    for (let voxel of [0.125, 0.25, 0.5, 2]) {
      assertEquals(chartPatch(ground(voxel, height)), px)
    }
  }
  assertNotEquals(
    pixel(chartPatch(ground(1, 8)), 8, 8),
    pixel(chartPatch(ground(1, 0)), 8, 8),
  )
})

test('updated theme colours repaint already-grown ground and water', () => {
  let land = ground(1, 8), water = ground(1, 0)
  let before = [chartPatch(land), chartPatch(water)]
  let changed = rows.map((row) =>
    row.theme_design.land == 'mossvale'
      ? {
        ...row,
        theme_design: {
          ...row.theme_design,
          look: {
            ground: { grass: 0x123456 },
            water: [0x102030, 0x102030, 0x102030],
          },
        },
      }
      : row
  )
  try {
    useThemes(changed)
    assertEquals(pixel(chartPatch(land), 8, 8), [0x12, 0x34, 0x56, 255])
    assertEquals(pixel(chartPatch(water), 8, 8), [0x10, 0x20, 0x30, 255])
  } finally {
    seedThemes()
  }
  assertEquals(chartPatch(land), before[0])
  assertEquals(chartPatch(water), before[1])
})

test('map pixels sample cover at their centres at every grown detail', () => {
  let reference: Uint8ClampedArray | undefined
  for (let voxel of [1, 0.25, 2]) {
    let p = ground(voxel), C = p.n - 2
    let sand = Math.ceil(8 / voxel - 0.5)
    for (let k = 0; k < C; k++) {
      p.top.fill(Top.sand, k * C + sand, (k + 1) * C)
    }
    let px = chartPatch(p)
    if (reference) assertEquals(px, reference)
    else reference = px
    assertNotEquals(pixel(px, 7, 8), pixel(px, 8, 8))
  }
})

test('charted region names omit neighbours that own no chart pixel', () => {
  let p = ground(0.25)
  p.regions = ['mossvale', 'birchmere', 'unused']
  let C = p.n - 2
  p.region.fill(0)
  p.other.fill(2)
  for (let k = 0; k < C; k++) p.region[C - 1 + k * C] = 1
  assertEquals([...chartRegions(p)], ['mossvale'])
  for (let k = 0; k < C; k++) p.region[C - 2 + k * C] = 1
  assertEquals([...chartRegions(p)], ['mossvale', 'birchmere'])
})

test('the grown halo lights hills from the north-west', () => {
  let bare = pixel(chartPatch(ground(1)), 8, 8)
  for (let direction of [-1, 1]) {
    let p = ground(1)
    for (let j = 0; j < p.layers[0].length; j++) {
      p.layers[0][j] = 16 + direction * (j % p.n - 8)
    }
    let lit = pixel(chartPatch(p), 8, 8)
    assertEquals(
      lit.slice(0, 3).every((c, i) =>
        direction > 0 ? c > bare[i] : c < bare[i]
      ),
      true,
    )
  }
})

test('supplied roofs and tall props appear over grown ground', () => {
  let p = ground(0.25), bare = chartPatch(p)
  let roof = chartPatch(p, [{ kind: 'well', seed: 0, x: 8, z: 8 }])
  assertEquals(pixel(roof, 8, 8), [0xa9, 0x55, 0x3a, 255])
  assertEquals(pixel(roof, 0, 0), pixel(bare, 0, 0))
  let trees = chartPatch(p, [{ kind: 'oak', seed: 0, x: 8, z: 8 }])
  assertNotEquals(pixel(trees, 8, 8), pixel(bare, 8, 8))
  assertEquals(pixel(trees, 0, 0), pixel(bare, 0, 0))
})

test('a chart grows each chunk once even when larger than the terrain cache', () => {
  let v = vale(16), old = { grow: v.grow, plant: v.plant, patches: v.patches }
  let ground = flat(16, [], [], 16), visits = new Map<string, number>()
  v.patches = new Map()
  v.plant = () => []
  v.grow = (ci, ck) => {
    let key = `${ci},${ck}`
    visits.set(key, (visits.get(key) ?? 0) + 1)
    return ground.grow(ci, ck)
  }
  try {
    let px = chart(0, 0, 240, 16)
    assertEquals(px.length, 15 * 15 * 4)
    assertEquals([...visits.values()].every((n) => n == 1), true)
  } finally {
    Object.assign(v, old)
  }
})
