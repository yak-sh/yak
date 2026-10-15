// A model's boxes mesh as one solid, so no two faces share a plane.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { cuboids } from './boxes.ts'
import { fights, out, pack } from './mesh.ts'

test('a band round a box, as a helm over hair, draws nothing twice in a plane', () => {
  let band = cuboids(out(), [
    [[0, 0, 0], [1, 1, 1], 0xffffff],
    [[0, 0.4, 0], [1, 0.2, 1], 0xff0000],
  ])
  assertEquals(fights(pack(band)), [])
})
