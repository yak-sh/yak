import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { chartsheet } from './chartsheet.ts'

test('sheets place each grown chart once and reuse the same images across views', () => {
  let puts: number[][] = [], made = 0
  let compose = chartsheet(256, () => ({
    image: ++made,
    put: (_px, x, z) => {
      puts.push([x, z])
    },
  }))
  let px = new Uint8ClampedArray(16 * 16 * 4)
  let cells = [{ image: px, box: [-16, -16, 16] as [number, number, number] }, {
    image: px,
    box: [0, 0, 16] as [number, number, number],
  }, { image: px, box: [16, 0, 16] as [number, number, number] }]
  let images = compose(cells)
  assertEquals(images, [{ image: 1, box: [-256, -256, 256] }, {
    image: 2,
    box: [0, 0, 256],
  }])
  assertEquals(puts, [[240, 240], [0, 0], [16, 0]])
  assertEquals(compose(cells.slice(1)), [images[1]])
  assertEquals(compose(cells), images)
  assertEquals([made, puts.length], [2, 3])
  compose([{ image: px.slice(), box: [0, 0, 16] }])
  assertEquals(puts, [[240, 240], [0, 0], [16, 0], [0, 0]])
})

test('sheets use the supplied size for grouping and placement across boundaries', () => {
  let puts: number[][] = [], made = 0
  let compose = chartsheet(15, () => ({
    image: ++made,
    put: (_px, x, z) => {
      puts.push([x, z])
    },
  }))
  let px = new Uint8ClampedArray(5 * 5 * 4)
  let images = compose([
    { image: px, box: [-5, -5, 5] },
    { image: px, box: [0, 0, 5] },
    { image: px, box: [10, 0, 5] },
    { image: px, box: [15, 0, 5] },
  ])
  assertEquals(images, [
    { image: 1, box: [-15, -15, 15] },
    { image: 2, box: [0, 0, 15] },
    { image: 3, box: [15, 0, 15] },
  ])
  assertEquals(puts, [[10, 10], [0, 0], [10, 0], [0, 0]])
  assertEquals(compose([{ image: px, box: [10, 0, 5] }]), [images[1]])
  assertEquals([made, puts.length], [3, 4])
})
