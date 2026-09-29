// The map's veil follows the world's irregular region boundaries. A small
// raster keeps sampling off the page thread and scales to the panel's canvas.
import type { Box } from './mapview.ts'
import { regionOf } from './regions.ts'

export let FOG_SIZE = 160

/** RGBA veil: unvisited ground remains visible through ninety percent shade. */
export let veil = (
  [x, z, side]: Box,
  visited: ReadonlySet<string>,
  size = FOG_SIZE,
): Uint8ClampedArray<ArrayBuffer> => {
  let px = new Uint8ClampedArray(size * size * 4)
  let m = side / size
  for (let k = 0; k < size; k++) {
    for (let i = 0; i < size; i++) {
      let at = (i + k * size) * 4
      px[at] = 34
      px[at + 1] = 35
      px[at + 2] = 31
      px[at + 3] = visited.has(regionOf(x + (i + 0.5) * m, z + (k + 0.5) * m))
        ? 0
        : 230
    }
  }
  return px
}
