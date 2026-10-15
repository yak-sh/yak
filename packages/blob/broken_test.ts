// Pictures as a decoder meets them: each PNG here is made in the test from its
// scanlines, so a case says what is in the file and what broken() says of it.
// What scanlines make of pixel data is checked on the bytes themselves, with
// nothing to inflate.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { broken, scanlines } from './broken.ts'

let TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
let crc = (b: number[]) =>
  ~b.reduce((c, x) => TABLE[(c ^ x) & 0xff] ^ (c >>> 8), ~0) >>> 0
let u32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]
let u16le = (n: number) => [n & 255, (n >> 8) & 255]
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

// A zlib stream in its stored form: the header, `raw` kept as it is in one
// final block, then raw's Adler-32. Any inflater reads it, and nothing has to
// compress.
let adler = (b: number[]) => {
  let a = 1, s = 0
  for (let x of b) a = (a + x) % 65521, s = (s + a) % 65521
  return ((s << 16) | a) >>> 0
}
let deflate = (raw: number[]) => [
  ...[0x78, 0x01, 1, ...u16le(raw.length), ...u16le(~raw.length)],
  ...raw,
  ...u32(adler(raw)),
]

// An 8-bit greyscale PNG of w × h, its inflated data `raw`: a filter byte, then
// a byte per pixel, for each scanline. Its compressed data is one IDAT chunk,
// or two with the second starting `split` bytes in.
let png = (
  w: number,
  h: number,
  raw: number[],
  { interlace = 0, idat = deflate, seal = crc, split = 0 } = {},
) => {
  let data = idat(raw)
  let parts = split ? [data.slice(0, split), data.slice(split)] : [data]
  return new Uint8Array([
    ...ascii('\x89PNG\r\n\x1a\n'),
    ...chunk('IHDR', [...u32(w), ...u32(h), 8, 0, 0, 0, interlace]),
    ...parts.flatMap((part) => chunk('IDAT', part, seal)),
    ...chunk('IEND', []),
  ])
}

let says = (bytes: Uint8Array, type = 'image/png') => broken(bytes, type)

// What the scanlines of a 2 × 2 greyscale picture say of pixel data that
// inflates in `parts`, chunk by chunk and then at its end.
let fills = (parts: number[][], interlaced = false) => {
  let scan = scanlines(2, 2, 8, interlaced)
  for (let part of parts) {
    let wrong = scan(new Uint8Array(part))
    if (wrong) return wrong
  }
  return scan()
}

test('pixel data fills its scanlines, each a filter byte then its pixels', () => {
  let cases: [number[][], string | undefined, boolean?][] = [
    [[[0, 1, 2, 1, 3, 4]], undefined],
    // A chunk may end anywhere in a scanline, or just before its filter byte.
    [[[0], [1, 2], [1, 3, 4]], undefined],
    // Adam7 at 2 × 2 is three passes: 1 pixel, 1 pixel, then a row of 2.
    [[[0, 1, 0, 2, 0, 3, 4]], undefined, true],
    [
      [[0, 1, 0, 2, 0, 3]],
      'its pixel data is 6 bytes where its header needs 7',
      true,
    ],
    [[[0, 1, 2]], 'its pixel data is 3 bytes where its header needs 6'],
    [
      [[0, 1, 2, 1, 3, 4], [0]],
      'its pixel data inflates past the 6 bytes its header needs',
    ],
    [[[0, 1, 2], [7, 3, 4]], 'a scanline names filter 7, and PNG has 0 to 4'],
  ]
  for (let [parts, why, interlaced] of cases) {
    assertEquals(fills(parts, interlaced), why)
  }
})

test('a PNG decodes when every chunk checks and its scanlines fill its header', async () => {
  // Interlaced, and its pixel data inflating across two IDAT chunks.
  assertEquals(
    await says(png(2, 2, [0, 1, 0, 2, 0, 3, 4], { interlace: 1, split: 9 })),
    undefined,
  )
})

test('a PNG that does not decode says what is wrong with it', async () => {
  let cases: [Uint8Array, string][] = [
    [
      png(2, 2, [0, 1, 2], { seal: () => 0 }),
      'its IDAT chunk fails its checksum',
    ],
    [
      png(2, 2, [], { idat: () => [1, 2, 3, 4] }),
      'its pixel data does not inflate',
    ],
    [
      png(2, 2, [0, 1, 2]).slice(0, 45),
      'it ends inside its IDAT chunk',
    ],
    [png(0, 2, []), 'its header states no size'],
  ]
  for (let [bytes, why] of cases) assertEquals(await says(bytes), why)
})

test('a PNG says what its scanlines find, as it inflates and at its end', async () => {
  assertEquals(
    await says(png(2, 2, [0, 1, 2, 7, 3, 4])),
    'a scanline names filter 7, and PNG has 0 to 4',
  )
  assertEquals(
    await says(png(2, 2, [0, 1, 2])),
    'its pixel data is 3 bytes where its header needs 6',
  )
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
