import { decode, encode } from 'fast-png'
import { equal, test } from '@yaks/testing'
import { pixels, raster } from './artwork.ts'

test('decoded print pixels flatten transparency and retain color except coloring interiors', () => {
  let input = encode({
    width: 2,
    height: 1,
    channels: 4,
    data: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]),
  })
  let color = pixels(input, false), gray = pixels(input, true)
  equal(color, {
    width: 2,
    height: 1,
    channels: 3,
    data: new Uint8Array([255, 0, 0, 255, 255, 255]),
  })
  equal(gray, {
    width: 2,
    height: 1,
    channels: 1,
    data: new Uint8Array([54, 255]),
  })
  equal(decode(raster(input, true)).data, gray.data)
})
