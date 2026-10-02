// Fixed cells of ground, charted once. Views only choose and place levels of
// their pyramid; a new design version retires the previous atlas.
import { SIZE, type Spot } from './levels.ts'
import type { Box } from './mapview.ts'

export let TILE_SIZES = [256, 128, 64, 32]
export type Tile<T> = { image: T; box: Box }

/** Cells intersecting a square, including negative world coordinates. */
export let cellsOf = ([x, z, side]: Box): Spot[] => {
  let cells: Spot[] = []
  for (let gz = Math.floor(z / SIZE); gz < Math.ceil((z + side) / SIZE); gz++) {
    for (
      let gx = Math.floor(x / SIZE);
      gx < Math.ceil((x + side) / SIZE);
      gx++
    ) {
      cells.push([gx, gz])
    }
  }
  return cells
}

/** Smaller levels average the detailed chart; they never regrow terrain. */
export let pyramid = (pixels: Uint8ClampedArray<ArrayBuffer>) => {
  let levels = [pixels]
  for (let size of TILE_SIZES.slice(1)) {
    let parent = levels.at(-1)!, px = new Uint8ClampedArray(size * size * 4)
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        let from = (x * 2 + z * 2 * size * 2) * 4
        for (let c = 0; c < 4; c++) {
          px[(x + z * size) * 4 + c] = Math.round(
            (
              parent[from + c] + parent[from + 4 + c] +
              parent[from + size * 8 + c] + parent[from + size * 8 + 4 + c]
            ) / 4,
          )
        }
      }
    }
    levels.push(px)
  }
  return levels
}

/** Keep completed and concurrent requests, shared by every map on a page. */
export let atlas = <T>(load: (cell: Spot, version: number) => Promise<T[]>) => {
  let version: number | undefined
  let kept = new Map<string, Promise<T[]>>()
  return async (box: Box, next: number): Promise<Tile<T>[]> => {
    if (version != next) {
      version = next
      kept.clear()
    }
    let level = TILE_SIZES.findLastIndex((size) => size >= SIZE * 320 / box[2])
    level = Math.max(0, level)
    return await Promise.all(
      cellsOf(box).map(async (cell) => {
        let key = cell.join(',')
        let got = kept.get(key)
        if (!got) {
          got = load(cell, next)
          kept.set(key, got)
          got.catch(() => {
            if (kept.get(key) == got) kept.delete(key)
          })
        }
        let images = await got
        return {
          image: images[level],
          box: [cell[0] * SIZE, cell[1] * SIZE, SIZE] as Box,
        }
      }),
    )
  }
}
