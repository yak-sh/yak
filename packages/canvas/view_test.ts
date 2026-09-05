import { assertEquals } from '@std/assert'
import { frame, visible, world, ZOOM_MAX, ZOOM_MIN, zoomed } from './view.ts'

let cam = { x: 0, y: 0, zoom: 1, w: 100, h: 100 }

Deno.test('world: the camera sees its window, scaled by the zoom', () => {
  assertEquals(world(cam), { x: -50, y: -50, w: 100, h: 100 })
  // zoomed in, the same window covers half as much plane
  assertEquals(world({ ...cam, zoom: 2 }), { x: -25, y: -25, w: 50, h: 50 })
})

Deno.test('visible: what overlaps the view, in the order given', () => {
  let pins = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 500, y: 0, w: 10, h: 10 },
    { x: -55, y: 0, w: 10, h: 10 }, // just inside the left edge
  ]
  assertEquals(visible(cam, pins), [pins[0], pins[2]])
})

Deno.test('zoomed: held inside the one range every move shares', () => {
  assertEquals(zoomed(1), 1)
  assertEquals(zoomed(0), ZOOM_MIN)
  assertEquals(zoomed(99), ZOOM_MAX)
})

Deno.test('frame: centres on the pins and pulls back to fit', () => {
  let pins = [{ x: 0, y: 0, w: 200, h: 100 }]
  let f = frame(pins, { w: 100, h: 100 })
  assertEquals({ x: f.x, y: f.y }, { x: 100, y: 50 })
  assertEquals(f.zoom, 0.45) // 100/200, less the 0.9 breathing room
  assertEquals({ w: f.w, h: f.h }, { w: 100, h: 100 })
})

Deno.test('frame: an empty wall looks the same from anywhere', () => {
  assertEquals(frame([], { w: 100, h: 100 }), {
    x: 0,
    y: 0,
    zoom: 1,
    w: 100,
    h: 100,
  })
})

Deno.test('frame: unmeasured cards still spread the bounds the zoom fits', () => {
  let f = frame([{ x: 10, y: 10 }, { x: 30, y: 10 }], { w: 100, h: 100 })
  // 20 units wide, no height at all: the width is what constrains it
  assertEquals({ x: f.x, y: f.y, zoom: f.zoom }, {
    x: 20,
    y: 10,
    zoom: ZOOM_MAX,
  })
})

Deno.test('frame: content with no extent frames at 1:1', () => {
  let f = frame([{ x: 5, y: 5 }], { w: 100, h: 100 })
  assertEquals({ x: f.x, y: f.y, zoom: f.zoom }, { x: 5, y: 5, zoom: 1 })
})
