// The map veil follows world regions at each view scale.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { veil } from './mapfog.ts'
import { regionOf } from './regions.ts'
import { levelAt, SIZE } from './levels.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

test('visiting one land uncovers its irregular ground only', () => {
  let box: [number, number, number] = [-32, 48, 320]
  let size = 80
  let px = veil(box, new Set(['mossvale']), size)
  let at = (i: number, k: number) => px[(i + k * size) * 4 + 3]
  let seen = false, dim = false, bent = false
  for (let k = 0; k < size; k++) {
    for (let i = 0; i < size; i++) {
      let x = box[0] + (i + 0.5) * box[2] / size
      let z = box[1] + (k + 0.5) * box[2] / size
      let clear = regionOf(x, z) == 'mossvale'
      assertEquals(at(i, k), clear ? 0 : 230)
      seen ||= clear
      dim ||= !clear
      if (
        clear != (levelAt(Math.floor(x / SIZE), Math.floor(z / SIZE)).id ==
          'mossvale')
      ) bent = true
    }
  }
  assertEquals([seen, dim, bent], [true, true, true])
})
