// A page's fixed-detail charts. Growth supplies cells before the map opens;
// missing explored cells are requested once, independently of its viewport.
export type Cell = [number, number]
export type ChartBox = [number, number, number]

export type Chart<T> = { image: T; box: ChartBox }

/** Chunk cells intersecting a square, including negative coordinates. */
export let cellsOf = ([x, z, side]: ChartBox, chunkSize: number): Cell[] => {
  let cells: Cell[] = []
  for (
    let ck = Math.floor(z / chunkSize);
    ck < Math.ceil((z + side) / chunkSize);
    ck++
  ) {
    for (
      let ci = Math.floor(x / chunkSize);
      ci < Math.ceil((x + side) / chunkSize);
      ci++
    ) {
      cells.push([ci, ck])
    }
  }
  return cells
}

/** A cache of completed and concurrent chunk charts. */
export type Chartbook<T> = {
  keep: (cell: Cell, make: () => T | Promise<T>) => Promise<T>
  clear: () => void
  read: (
    box: ChartBox,
    visible: (cell: Cell) => boolean,
    load: (cell: Cell) => Promise<T>,
  ) => Promise<Chart<T>[]>
}

/** Keep both completed charts and concurrent requests until designs change. */
export let chartbook = <T>(chunkSize: number): Chartbook<T> => {
  type Held = { ready: boolean; image?: T; pending: Promise<T> }
  let kept = new Map<string, Held>()
  let keep = ([ci, ck]: Cell, make: () => T | Promise<T>) => {
    let key = `${ci},${ck}`
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
      box: ChartBox,
      visible: (cell: Cell) => boolean,
      load: (cell: Cell) => Promise<T>,
    ): Promise<Chart<T>[]> => {
      let cells = cellsOf(box, chunkSize).filter(visible)
      let charts = new Array<Chart<T>>(cells.length),
        pending: Promise<void>[] = []
      for (let [i, cell] of cells.entries()) {
        let hold = kept.get(`${cell[0]},${cell[1]}`)
        let put = (image: T) => {
          charts[i] = {
            image,
            box: [cell[0] * chunkSize, cell[1] * chunkSize, chunkSize],
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
