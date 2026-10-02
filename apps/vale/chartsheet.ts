// Place each chunk's pixels into a larger canvas once, so a view draws only
// a handful of sheets. Sheets keep the same detail at every scale.
import type { Chart } from './chartbook.ts'
import { SIZE } from './levels.ts'
import { pairKey } from './regions.ts'

type Pixels = Uint8ClampedArray<ArrayBuffer>
type Canvas<T> = { image: T; put: (px: Pixels, x: number, z: number) => void }

export let chartsheet = <T>(make: () => Canvas<T>) => {
  let kept = new Map<number, Canvas<T>>()
  let placed = new Map<number, Pixels>()
  return (charts: Chart<Pixels>[]): Chart<T>[] => {
    let visible = new Map<number, Chart<T>>()
    for (let { image: px, box: [x, z] } of charts) {
      let gx = Math.floor(x / SIZE), gz = Math.floor(z / SIZE)
      let key = pairKey(gx, gz), cell = pairKey(x, z)
      let canvas = kept.get(key)
      if (!canvas) kept.set(key, canvas = make())
      if (placed.get(cell) != px) {
        canvas.put(px, x - gx * SIZE, z - gz * SIZE)
        placed.set(cell, px)
      }
      visible.set(key, {
        image: canvas.image,
        box: [gx * SIZE, gz * SIZE, SIZE],
      })
    }
    return [...visible.values()]
  }
}
