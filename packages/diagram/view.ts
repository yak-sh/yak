// The part of a drawing's sheet that is in view, as a reader zooms and pans
// it. Pure: a view and a gesture in, the next view out, never smaller than a
// sixth of the sheet nor larger than all of it, and never off its edge.
import type { Layout } from './layout.ts'

/** The part of the sheet in view: `[x, y, width, height]`, in its units. */
export type View = [number, number, number, number]

/** How far in a reader can zoom: a sixth of the sheet across. */
const DEEPEST = 6

/** The whole sheet. */
export let whole = ({ width, height }: Layout): View => [0, 0, width, height]

// A view kept to the sheet: no larger than it, no smaller than DEEPEST lets,
// and wholly on it.
let kept = (layout: Layout, [x, y, w, h]: View): View => {
  let k = Math.min(1, Math.max(1 / DEEPEST, w / layout.width))
  w = layout.width * k
  h = layout.height * k
  x = Math.max(0, Math.min(layout.width - w, x))
  y = Math.max(0, Math.min(layout.height - h, y))
  return [x, y, w, h]
}

/**
 * Zoom by `k` (above 1 closer, below 1 farther) about a point given as
 * fractions of the view, which stays where it is.
 *
 * ```ts
 * import { layout, whole, zoom } from '@yaks/diagram'
 * import { equal } from '@yaks/testing'
 *
 * let sheet = layout([], { width: 600, height: 400 })
 * equal(zoom(sheet, whole(sheet), 2, [.5, .5]), [150, 100, 300, 200])
 * equal(zoom(sheet, whole(sheet), .5, [.5, .5]), [0, 0, 600, 400])
 * ```
 */
export let zoom = (
  layout: Layout,
  [x, y, w, h]: View,
  k: number,
  [fx, fy]: [number, number],
): View => {
  let [, , nw, nh] = kept(layout, [x, y, w / k, h / k])
  return kept(layout, [x + fx * (w - nw), y + fy * (h - nh), nw, nh])
}

/** Move the view by dx, dy in the sheet's units. */
export let pan = (
  layout: Layout,
  [x, y, w, h]: View,
  dx: number,
  dy: number,
): View => kept(layout, [x + dx, y + dy, w, h])

/** Whether the view shows less than the whole sheet. */
export let zoomed = (layout: Layout, [, , w]: View): boolean =>
  w < layout.width - .5

/** Where a point of the sheet is, as fractions of the view. */
export let within = (
  [x, y, w, h]: View,
  [px, py]: [number, number],
): [number, number] => [(px - x) / w, (py - y) / h]
