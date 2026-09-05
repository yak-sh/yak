// The flat geometry the rest of the package is made of: a rectangle, the box
// around a set of them, and whether two overlap. No DOM, no matrices, no
// units — a canvas unit is whatever the client decides one is.
//
// Everything here is a plain function over plain objects, so the same answers
// serve a browser laying out divs, a terminal laying out rows, and a test with
// no screen at all.

import type { Pin } from './comp.ts'

/** A place on the plane. */
export type Point = { x: number; y: number }

/** How big something is. */
export type Size = { w: number; h: number }

/** A box: its top-left corner, and its size. */
export type Rect = Point & Size

/**
 * The box a pin occupies. A pin that never said where it is sits at the
 * origin, and one that never said how big it is has no extent — which is what
 * `w: 0` means on the wire: "however big it needs to be", not yet measured.
 */
export let rect = (p: Pin): Rect => ({
  x: p.x ?? 0,
  y: p.y ?? 0,
  w: p.w ?? 0,
  h: p.h ?? 0,
})

/** Do two boxes share any area? Touching edges do not count — a box placed
 * exactly beside another is beside it, not on it. */
export let overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * The smallest box containing every pin — what "everything on the wall" is,
 * as one rectangle. Nothing pinned has no bounds, so this answers `undefined`
 * rather than inventing an empty box at the origin.
 */
export let bounds = (pins: Pin[]): Rect | undefined => {
  if (!pins.length) return undefined
  let rs = pins.map(rect)
  let x = Math.min(...rs.map((r) => r.x))
  let y = Math.min(...rs.map((r) => r.y))
  return {
    x,
    y,
    w: Math.max(...rs.map((r) => r.x + r.w)) - x,
    h: Math.max(...rs.map((r) => r.y + r.h)) - y,
  }
}

/** The frontmost stacking order in use, or 0 when nothing is pinned — so the
 * next card goes on top at `top(pins) + 1`. */
export let top = (pins: Pin[]): number =>
  pins.reduce((z, p) => Math.max(z, p.z ?? 0), 0)
