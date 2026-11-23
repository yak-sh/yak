import { decode, encode } from 'fast-png'
import { equal, test } from '@yaks/testing'
import { deflated, inflated, pixels } from './artwork.ts'

test('decoded print pixels flatten transparency and retain color except coloring interiors', async () => {
  let input = encode({
    width: 2,
    height: 1,
    channels: 4,
    data: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]),
  })
  equal(await pixels(input, false), {
    width: 2,
    height: 1,
    channels: 3,
    data: new Uint8Array([255, 0, 0, 255, 255, 255]),
  })
  equal(await pixels(input, true), {
    width: 2,
    height: 1,
    channels: 1,
    data: new Uint8Array([54, 255]),
  })
})

// A PNG of `channels` whose rows each use one filter type, 0 to 4 in turn.
let png = async (channels: 1 | 2 | 3 | 4, width: number, height: number) => {
  let stride = width * channels
  let raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = y % 5
    for (let x = 0; x < stride; x++) {
      raw[y * (stride + 1) + 1 + x] = (x * 37 + y * 101) % 256
    }
  }
  let chunk = (type: string, data: Uint8Array) => {
    let out = new Uint8Array(12 + data.length), view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(data, 8)
    return out
  }
  let header = new Uint8Array(13), view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, { 1: 0, 2: 4, 3: 2, 4: 6 }[channels], 0, 0, 0], 8)
  let parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', await deflated(raw)),
    chunk('IEND', new Uint8Array()),
  ]
  return new Uint8Array(await new Blob(parts).arrayBuffer())
}

test('every row filter decodes to the same pixels as fast-png, for each color layout', async () => {
  for (let channels of [1, 2, 3, 4] as const) {
    let bytes = await png(channels, 7, 10)
    let image = decode(bytes)
    for (let coloring of [true, false]) {
      // fast-png's own encoding is unfiltered, so only the decoder differs.
      equal(
        await pixels(bytes, coloring),
        await pixels(encode(image), coloring),
        `${channels} channels, coloring ${coloring}`,
      )
    }
  }
})

test('native zlib round-trips bytes', async () => {
  let data = Uint8Array.from({ length: 5000 }, (_, n) => n % 251)
  equal(await inflated(await deflated(data)), data)
})
