// The camera: what a window can see, and where to point it.
//
// A camera is a centre, a scale, and the size of the window looking through
// it. Centre rather than corner, because that is the point every gesture
// preserves — zooming keeps the middle still, and a window that changes size
// keeps showing the same thing.
//
// So the whole of "what is on screen" is one rectangle, `world()`, and every
// other question here is asked of it.

import type { Camera, Pin } from './comp.ts'
import { bounds, overlaps, type Rect, rect, type Size } from './geom.ts'

/** How far out a camera may pull back. */
export let ZOOM_MIN = 0.1

/** How far in a camera may push. */
export let ZOOM_MAX = 4

/** A zoom held inside the range every camera move shares, so a pinch and a
 * fit-to-content cannot disagree about how far is too far. */
export let zoomed = (z: number): number =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

/**
 * The part of the plane a camera can see, in canvas units. Zooming in shows
 * less of the plane, so the window's pixel size is divided by the scale.
 */
export let world = (cam: Camera): Rect => ({
  x: cam.x - cam.w / 2 / cam.zoom,
  y: cam.y - cam.h / 2 / cam.zoom,
  w: cam.w / cam.zoom,
  h: cam.h / cam.zoom,
})

/**
 * The pins on screen — everything overlapping what the camera sees, in the
 * order given. This is the one question a renderer asks every frame, so it is
 * a filter over plain objects and nothing more.
 */
export let visible = <T extends Pin>(cam: Camera, pins: T[]): T[] => {
  let seen = world(cam)
  return pins.filter((p) => overlaps(seen, rect(p)))
}

/**
 * The camera that frames everything: centred on the pins, pulled back until
 * they fit, with `fill` of the window given over to them (the rest is the
 * breathing room around the edge). Nothing pinned frames the origin at 1:1 —
 * an empty wall looks the same from anywhere.
 *
 * The zoom is set by whichever axes the content actually spans: cards with no
 * measured size still spread the bounds apart, and that spread is what gets
 * fitted. Content with no extent at all — one unmeasured card, or several
 * stacked on the same spot — constrains nothing, and frames at 1:1.
 */
export let frame = (pins: Pin[], size: Size, fill = 0.9): Camera => {
  let b = bounds(pins)
  if (!b) return { x: 0, y: 0, zoom: 1, ...size }
  let fits = [
    ...(b.w > 0 ? [size.w / b.w] : []),
    ...(b.h > 0 ? [size.h / b.h] : []),
  ]
  return {
    x: b.x + b.w / 2,
    y: b.y + b.h / 2,
    zoom: fits.length ? zoomed(Math.min(...fits) * fill) : 1,
    ...size,
  }
}
