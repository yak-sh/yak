// A page's fixed-detail charts. Growth supplies cells before the map opens;
// missing explored cells are requested once, independently of its viewport.
import type { Spot } from './levels.ts'
import type { Box } from './mapview.ts'
import { CHUNK, chunkKey } from './terrain.ts'

export type Chart<T> = { image: T; box: Box }

/** Chunk cells intersecting a square, including negative coordinates. */
export let cellsOf = ([x, z, side]: Box): Spot[] => {
  let cells: Spot[] = []
  for (
    let ck = Math.floor(z / CHUNK);
    ck < Math.ceil((z + side) / CHUNK);
    ck++
  ) {
    for (
      let ci = Math.floor(x / CHUNK);
      ci < Math.ceil((x + side) / CHUNK);
      ci++
    ) {
      cells.push([ci, ck])
    }
  }
  return cells
}

/** Keep both completed charts and concurrent requests until designs change. */
export let chartbook = <T>() => {
  type Held = { ready: boolean; image?: T; pending: Promise<T> }
  let kept = new Map<number, Held>()
  let keep = (cell: Spot, make: () => T | Promise<T>) => {
    let key = chunkKey(...cell)
    let got = kept.get(key)
    if (!got) {
      let hold: Held = {
        ready: false,
        pending: Promise.resolve().then(make).then((image) => {
          hold.image = image
          hold.ready = true
          return image
        }),
      }
      got = hold
      kept.set(key, hold)
      hold.pending.catch(() => {
        if (kept.get(key) == hold) kept.delete(key)
      })
    }
    return got.pending
  }
  return {
    keep,
    clear: () => kept.clear(),
    read: async (
      box: Box,
      visible: (cell: Spot) => boolean,
      load: (cell: Spot) => Promise<T>,
    ): Promise<Chart<T>[]> => {
      let cells = cellsOf(box).filter(visible)
      let charts = new Array<Chart<T>>(cells.length),
        pending: Promise<void>[] = []
      for (let [i, cell] of cells.entries()) {
        let hold = kept.get(chunkKey(...cell))
        let put = (image: T) => {
          charts[i] = {
            image,
            box: [cell[0] * CHUNK, cell[1] * CHUNK, CHUNK],
          }
        }
        if (hold?.ready) put(hold.image!)
        else pending.push(keep(cell, () => load(cell)).then(put))
      }
      await Promise.all(pending)
      return charts
    },
  }
}
