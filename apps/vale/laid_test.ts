// An overlay clears every ground column its footprint touches.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { laid, LIFT } from './laid.ts'
import { flat } from './terrain.ts'

test('a high column between ring vertices lifts the whole overlay', () => {
  let v = flat((x, z) =>
    x >= 50.5 && x < 50.75 && z >= 50.25 && z < 50.5 ? 8 : 5
  )
  assertEquals(laid(v, 50, 50, 1), 8 + LIFT)
  assertEquals(laid(v, 50, 50, 0, 7), 7 + LIFT)
})
