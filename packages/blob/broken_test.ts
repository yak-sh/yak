// Pictures as a decoder meets them: each PNG here is made in the test from its
// scanlines, so a case says what is in the file and what broken() says of it.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { broken } from './broken.ts'

let TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
let crc = (b: number[]) =>
  ~b.reduce((c, x) => TABLE[(c ^ x) & 0xff] ^ (c >>> 8), ~0) >>> 0
let u32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]
let ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
let chunk = (
  type: string,
  data: number[],
  seal = crc,
) => [
  ...u32(data.length),
  ...ascii(type),
  ...data,
  ...u32(seal([...ascii(type), ...data])),
]

let deflate = async (raw: number[]) => [
  ...new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(raw)]).stream()
        .pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  ),
]

// An 8-bit greyscale PNG of w × h, its inflated data `raw`: a filter byte, then
// a byte per pixel, for each scanline.
let png = async (
  w: number,
  h: number,
  raw: number[],
  { interlace = 0, idat = deflate, seal = crc } = {},
) =>
  new Uint8Array([
    ...ascii('\x89PNG\r\n\x1a\n'),
    ...chunk('IHDR', [...u32(w), ...u32(h), 8, 0, 0, 0, interlace]),
    ...chunk('IDAT', await idat(raw), seal),
    ...chunk('IEND', []),
  ])

let says = async (
  bytes: Uint8Array | Promise<Uint8Array>,
  type = 'image/png',
) => await broken(await bytes, type)

test('a PNG decodes when every chunk checks and its scanlines fill its header', async () => {
  assertEquals(await says(png(2, 2, [0, 1, 2, 1, 3, 4])), undefined)
  // Adam7 at 2 × 2 is three passes: 1 pixel, 1 pixel, then a row of 2.
  assertEquals(
    await says(png(2, 2, [0, 1, 0, 2, 0, 3, 4], { interlace: 1 })),
    undefined,
  )
})

test('a PNG that does not decode says what is wrong with it', async () => {
  let cases: [Promise<Uint8Array>, string][] = [
    [
      png(2, 2, [0, 1, 2], { seal: () => 0 }),
      'its IDAT chunk fails its checksum',
    ],
    [
      png(2, 2, [0, 1, 2]),
      'its pixel data is 3 bytes where its header needs 6',
    ],
    [
      png(2, 2, [0, 1, 2, 1, 3, 4, 0]),
      'its pixel data inflates past the 6 bytes its header needs',
    ],
    [
      png(2, 2, [0, 1, 2, 7, 3, 4]),
      'a scanline names filter 7, and PNG has 0 to 4',
    ],
    [
      png(2, 2, [], { idat: () => Promise.resolve([1, 2, 3, 4]) }),
      'its pixel data does not inflate',
    ],
    [
      png(2, 2, [0, 1, 2]).then((b) => b.slice(0, 45)),
      'it ends inside its IDAT chunk',
    ],
    [png(0, 2, []), 'its header states no size'],
  ]
  for (let [bytes, why] of cases) assertEquals(await says(bytes), why)
})

test('a picture is the type its name claims', async () => {
  let gif = new Uint8Array([...ascii('GIF89a'), 1, 0, 1, 0, 0, 0])
  assertEquals(await says(gif, 'image/png'), 'its bytes are a GIF, not a PNG')
  assertEquals(await says(gif, 'image/gif'), undefined)
  assertEquals(
    await says(new TextEncoder().encode('iVBORw0K'), 'image/png'),
    'it is not a PNG',
  )
  // A type nothing here reads is let through rather than guessed at.
  assertEquals(await says(new Uint8Array([1, 2]), 'image/x-icon'), undefined)
})

test('an SVG is text with an <svg> element', async () => {
  let svg = (s: string) => says(new TextEncoder().encode(s), 'image/svg+xml')
  assertEquals(
    await svg('<?xml version="1.0"?><svg viewBox="0 0 1 1"/>'),
    undefined,
  )
  assertEquals(await svg('<html>'), 'it has no <svg> element')
  assertEquals(
    await says(new Uint8Array([0xff, 0xfe, 0]), 'image/svg+xml'),
    'its bytes are not text',
  )
})
