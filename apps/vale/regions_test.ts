import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { blend, blendsIn } from './regions.ts'
import { seedThemes } from './themes_fixture.ts'

seedThemes()

test('a chunk searches fewer sites without changing either blended region or its share', () => {
  // Interiors, warped borders, negative cells and generated frontier regions.
  for (
    let [x, z] of [[0, 0], [-32, 48], [128, 32], [128, 128], [256, 128], [
      -256,
      -256,
    ], [
      4992,
      64,
    ]]
  ) {
    let read = blendsIn(x, z, x + 16, z + 16)
    for (let k = 0; k <= 16; k += 0.5) {
      for (let i = 0; i <= 16; i += 0.5) {
        assertEquals(read(x + i, z + k), blend(x + i, z + k))
      }
    }
    assertEquals(read(x - 1, z + 8), blend(x - 1, z + 8))
  }
})

test('a wide region search keeps both nearest regions without a shared neighbourhood', () => {
  let read = blendsIn(-512, -512, 512, 512)
  for (let z = -512; z <= 512; z += 64) {
    for (let x = -512; x <= 512; x += 64) {
      assertEquals(read(x, z), blend(x, z))
    }
  }
})
