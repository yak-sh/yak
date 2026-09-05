import { assertEquals } from '@std/assert'
import { place } from './place.ts'
import { overlaps, rect } from './geom.ts'

let size = { w: 100, h: 100 }

Deno.test('place: an empty wall starts at the origin', () => {
  assertEquals(place([], size), { x: 0, y: 0 })
})

Deno.test('place: beside the wall when there is no gap to fill', () => {
  let pins = [{ x: 0, y: 0, w: 100, h: 100 }]
  assertEquals(place(pins, size), { x: 124, y: 0 })
})

Deno.test('place: the first gap, read left to right and top to bottom', () => {
  // a row of three with the middle one missing
  let pins = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 248, y: 0, w: 100, h: 100 },
  ]
  assertEquals(place(pins, size), { x: 124, y: 0 })
})

Deno.test('place: never lands on anything already pinned', () => {
  let pins = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 124, y: 0, w: 100, h: 100 },
    { x: 0, y: 124, w: 100, h: 100 },
  ]
  let at = place(pins, size)
  let box = { ...at, ...size }
  assertEquals(pins.some((p) => overlaps(box, rect(p))), false)
})

Deno.test('place: a zero-size card still advances, never loops', () => {
  let pins = [{ x: 0, y: 0, w: 10, h: 10 }]
  assertEquals(place(pins, { w: 0, h: 0 }, 0), { x: 0, y: 0 })
})
