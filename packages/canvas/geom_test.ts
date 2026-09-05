import { assertEquals } from '@std/assert'
import { bounds, overlaps, rect, top } from './geom.ts'

let at = (x: number, y: number, w = 10, h = 10) => ({ x, y, w, h })

Deno.test('rect: an unsaid corner is the origin, an unsaid size is none', () => {
  assertEquals(rect({}), { x: 0, y: 0, w: 0, h: 0 })
  assertEquals(rect({ x: 3, y: 4 }), { x: 3, y: 4, w: 0, h: 0 })
})

Deno.test('overlaps: sharing area, not an edge', () => {
  assertEquals(overlaps(at(0, 0), at(5, 5)), true)
  assertEquals(overlaps(at(0, 0), at(10, 0)), false) // beside, touching
  assertEquals(overlaps(at(0, 0), at(11, 0)), false)
  assertEquals(overlaps(at(0, 0, 100, 100), at(40, 40)), true) // contained
})

Deno.test('bounds: the box around everything, undefined for nothing', () => {
  assertEquals(bounds([]), undefined)
  assertEquals(bounds([at(0, 0), at(20, 30)]), { x: 0, y: 0, w: 30, h: 40 })
  assertEquals(bounds([at(-5, -5)]), { x: -5, y: -5, w: 10, h: 10 })
})

Deno.test('top: the frontmost z, 0 when the wall is empty', () => {
  assertEquals(top([]), 0)
  assertEquals(top([{ z: 2 }, { z: 7 }, {}]), 7)
})
