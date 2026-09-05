// Where the next card goes.
//
// A wall fills up the way a real one does: you put the new note in the first
// gap you see, reading left to right and top to bottom, and when there is no
// gap left you put it beside everything else. That is the whole rule — no
// packing, no springs, no animation to settle. It is deterministic, so two
// windows given the same wall choose the same spot.
//
// A client that knows better (a pointer position, a drop point) should place
// the card there instead; this is the answer for "somewhere sensible", which
// is what a keyboard, a search result, or a script has to work with.

import type { Pin } from './comp.ts'
import { bounds, overlaps, rect, type Size } from './geom.ts'
import type { Point } from './geom.ts'

/**
 * The top-left corner for a new card of `size`, leaving `gap` between it and
 * anything already pinned: the first free slot inside the wall's own extent,
 * or just to the right of everything when the wall is full. An empty wall
 * starts at the origin.
 */
export let place = (pins: Pin[], size: Size, gap = 24): Point => {
  let b = bounds(pins)
  if (!b) return { x: 0, y: 0 }
  let step = { x: Math.max(1, size.w + gap), y: Math.max(1, size.h + gap) }
  let free = (x: number, y: number) =>
    !pins.some((p) => overlaps({ x, y, ...size }, rect(p)))
  for (let y = b.y; y <= b.y + b.h; y += step.y) {
    for (let x = b.x; x <= b.x + b.w; x += step.x) {
      if (free(x, y)) return { x, y }
    }
  }
  return { x: b.x + b.w + gap, y: b.y }
}
