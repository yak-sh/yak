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
export let ZOOMS = [...[320, 640, 1280, 2560].filter((n) => n < side), side]

/** A square centred near `at` in the unbounded world. */
export let view = (at: Spot, size = ZOOMS[0]): Box => [
  Math.round(at[0] - size / 2),
  Math.round(at[1] - size / 2),
  size,
]

/** Drag the chart by a fraction of its visible side. */
export let pan = (box: Box, dx: number, dz: number): Box =>
  view([box[0] + box[2] * (0.5 - dx), box[1] + box[2] * (0.5 - dz)], box[2])

/** Zoom around a point on the chart, given as a fraction from its top left. */
export let zoom = (box: Box, step: number, [u, v]: Spot = [0.5, 0.5]): Box => {
  let i = ZOOMS.indexOf(box[2])
  let size = ZOOMS[clamp(i + step, 0, ZOOMS.length - 1)]
  return view([
    box[0] + u * box[2] + (0.5 - u) * size,
    box[1] + v * box[2] + (0.5 - v) * size,
  ], size)
}

/** A world point on the chart, from zero to one across and down. */
export let place = (
  [x, z, size]: Box,
  [px, pz]: Spot,
): Spot => [(px - x) / size, (pz - z) / size]
