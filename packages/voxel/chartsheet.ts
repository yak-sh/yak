// Place each chunk's pixels into a larger canvas once, so a view draws only
// a handful of sheets. Sheets keep the same detail at every scale.
import type { Chart } from './chartbook.ts'

type Pixels = Uint8ClampedArray<ArrayBuffer>
type Canvas<T> = { image: T; put: (px: Pixels, x: number, z: number) => void }

export let chartsheet = <T>(
  size: number,
  make: () => Canvas<T>,
): (charts: Chart<Pixels>[]) => Chart<T>[] => {
  let kept = new Map<string, Canvas<T>>()
  let placed = new Map<string, Pixels>()
  return (charts: Chart<Pixels>[]): Chart<T>[] => {
    let visible = new Map<string, Chart<T>>()
    for (let { image: px, box: [x, z] } of charts) {
      let gx = Math.floor(x / size), gz = Math.floor(z / size)
      let key = `${gx},${gz}`, cell = `${x},${z}`
      let canvas = kept.get(key)
      if (!canvas) kept.set(key, canvas = make())
      if (placed.get(cell) != px) {
        canvas.put(px, x - gx * size, z - gz * size)
        placed.set(cell, px)
      }
      visible.set(key, {
        image: canvas.image,
        box: [gx * size, gz * size, size],
      })
    }
    return [...visible.values()]
  }
}
