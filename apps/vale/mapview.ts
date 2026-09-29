// The square of world ground a map shows. Pan and zoom change this value;
// drawing and pointer input both use it, so markers agree with the ground.
import { LEVELS, SIZE, type Spot } from './levels.ts'
import { clamp } from './rand.ts'

export type Box = [number, number, number]

let cells = Object.values(LEVELS).map((l) => l.cell)
let west = Math.min(...cells.map(([x]) => x)) * SIZE
let east = (Math.max(...cells.map(([x]) => x)) + 1) * SIZE
let north = Math.min(...cells.map(([, z]) => z)) * SIZE
let south = (Math.max(...cells.map(([, z]) => z)) + 1) * SIZE
let side = Math.max(east - west, south - north)

/** The authored lands in one square. The same scale frames nearby frontier. */
export let WORLD: Box = [
  (west + east - side) / 2,
  (north + south - side) / 2,
  side,
]
export let NEAR = 320

/** A square centred near `at` in the unbounded world. */
export let view = (at: Spot, size = NEAR): Box => [
  at[0] - size / 2,
  at[1] - size / 2,
  size,
]

/** Reopen the nearby chart where it was while the hero stays near its centre. */
export let reopen = (at: Spot, was: Box | null): Box => {
  if (!was) return view(at)
  let [x, z, size] = was, margin = size / 4
  return at[0] >= x + margin && at[0] <= x + size - margin &&
      at[1] >= z + margin && at[1] <= z + size - margin
    ? was
    : view(at)
}

/** Drag the chart by a fraction of its visible side. */
export let pan = (box: Box, dx: number, dz: number): Box =>
  view([box[0] + box[2] * (0.5 - dx), box[1] + box[2] * (0.5 - dz)], box[2])

/** Keep the same ground point between two fingers as they move and spread. */
export let pinch = (
  box: Box,
  from: Spot,
  to: Spot,
  factor: number,
): Box => {
  let size = clamp(box[2] * factor, NEAR, WORLD[2])
  return [
    box[0] + from[0] * box[2] - to[0] * size,
    box[1] + from[1] * box[2] - to[1] * size,
    size,
  ]
}

/** Zoom around a point on the chart, given as a fraction from its top left. */
export let zoom = (box: Box, factor: number, at: Spot = [0.5, 0.5]): Box =>
  pinch(box, at, at, factor)

/** A world point on the chart, from zero to one across and down. */
export let place = (
  [x, z, size]: Box,
  [px, pz]: Spot,
): Spot => [(px - x) / size, (pz - z) / size]
