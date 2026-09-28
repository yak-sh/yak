// The land beyond each village: its ground, what grows there, and the
// creatures a traveler meets after leaving the old center.
import { assert } from '@std/assert'
import { Top } from './features.ts'
import { homesOf } from './homes.ts'
import { LEVELS } from './levels.ts'
import { CHUNK, patchOf, propsIn, vale } from './terrain.ts'

let ground = (id: string, x: number, z: number) => {
  let [gx, gz] = LEVELS[id].cell
  let [wx, wz] = [gx * 256 + x, gz * 256 + z]
  let [ci, ck] = [Math.floor(wx / CHUNK), Math.floor(wz / CHUNK)]
  let p = patchOf(vale(1), ci, ck)
  let [i, k] = [Math.floor(wx - ci * CHUNK), Math.floor(wz - ck * CHUNK)]
  return p.top[i + k * CHUNK]
}

Deno.test('each land has creatures beyond its old center', () => {
  for (let lv of Object.values(LEVELS)) {
    let [ox, oz] = lv.cell.map((n) => n * 256)
    assert(
      homesOf(lv.id).some(({ home: [x, z] }) =>
        Math.max(Math.abs(x - ox - 128), Math.abs(z - oz - 128)) >= 64
      ),
      lv.id,
    )
  }
})

Deno.test('the outer ground keeps the land instead of becoming a grass ring', () => {
  for (
    let { id, tops } of [
      { id: 'mirewood', tops: [Top.mud, Top.lush] },
      { id: 'stonestep', tops: [Top.heath, Top.dry] },
    ]
  ) {
    for (let [x, z] of [[105, 20], [20, 125], [235, 125], [145, 240]]) {
      assert(tops.includes(ground(id, x, z)), `${id} at ${x}, ${z}`)
    }
  }
})

Deno.test('Birchmere grows birches in its outer woods', () => {
  let [gx, gz] = LEVELS.birchmere.cell
  let birches = 0
  for (let z = 16; z < 64; z += CHUNK) {
    for (let x = 112; x < 160; x += CHUNK) {
      birches +=
        propsIn(gx * 256 / CHUNK + x / CHUNK, gz * 256 / CHUNK + z / CHUNK)
          .filter((p) => p.kind == 'birch').length
    }
  }
  assert(birches > 35, `Birchmere outer woods grew ${birches} birches`)
})
