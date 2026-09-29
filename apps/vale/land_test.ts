// The land beyond each village: its ground, what grows there, and the
// creatures a traveler meets after leaving the old center.
import { assert } from '@std/assert'
import { Top } from './features.ts'
import { homesOf } from './homes.ts'
import { LEVELS, SIZE } from './levels.ts'
import { CHUNK, patchOf, propsIn, vale } from './terrain.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

let ground = (id: string, x: number, z: number) => {
  let [gx, gz] = LEVELS[id].cell
  let [wx, wz] = [gx * SIZE + x, gz * SIZE + z]
  let [ci, ck] = [Math.floor(wx / CHUNK), Math.floor(wz / CHUNK)]
  let p = patchOf(vale(1), ci, ck)
  let [i, k] = [Math.floor(wx - ci * CHUNK), Math.floor(wz - ck * CHUNK)]
  return p.top[i + k * CHUNK]
}

Deno.test('each land has creatures beyond its old center', () => {
  let mid = SIZE / 2, outer = SIZE / 4
  for (let lv of Object.values(LEVELS)) {
    let [ox, oz] = lv.cell.map((n) => n * SIZE)
    assert(
      homesOf(lv.id).some(({ home: [x, z] }) =>
        Math.max(Math.abs(x - ox - mid), Math.abs(z - oz - mid)) >= outer
      ),
      lv.id,
    )
  }
})

Deno.test('the outer ground keeps the land instead of becoming a grass ring', () => {
  let mid = SIZE / 2, margin = CHUNK + 4
  for (
    let { id, tops } of [
      { id: 'mirewood', tops: [Top.mud, Top.lush] },
      { id: 'stonestep', tops: [Top.heath, Top.dry] },
    ]
  ) {
    for (
      let [x, z] of [
        [mid - 23, margin],
        [margin, mid - 3],
        [SIZE - margin - 1, mid - 3],
        [mid + 17, SIZE - CHUNK],
      ]
    ) {
      assert(tops.includes(ground(id, x, z)), `${id} at ${x}, ${z}`)
    }
  }
})

Deno.test('Birchmere grows birches in its outer woods', () => {
  let [gx, gz] = LEVELS.birchmere.cell
  let birches = 0
  for (let z = CHUNK; z < SIZE / 4; z += CHUNK) {
    for (let x = SIZE / 2 - CHUNK; x < SIZE / 2 + CHUNK * 2; x += CHUNK) {
      birches +=
        propsIn(gx * SIZE / CHUNK + x / CHUNK, gz * SIZE / CHUNK + z / CHUNK)
          .filter((p) => p.kind == 'birch').length
    }
  }
  assert(birches > 35, `Birchmere outer woods grew ${birches} birches`)
})
