// The header readers, on headers and nothing else: every fixture here is the
// first few dozen bytes of a file, because that is all sizeOf is allowed to
// look at. What is proved is the shape of each format's own statement of its
// size — and that a file which states none gets none rather than a guess.
import { assertEquals } from '@std/assert'
import { sizeOf } from './image.ts'

let bytes = (...xs: (number | number[] | string)[]) =>
  new Uint8Array(
    xs.flatMap((x) =>
      typeof x == 'string'
        ? [...x].map((c) => c.charCodeAt(0))
        : typeof x == 'number'
        ? [x]
        : x
    ),
  )

let be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
let be32 = (n: number) => [...be16(n >>> 16), ...be16(n & 0xffff)]
let le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
let le24 = (n: number) => [...le16(n), (n >> 16) & 0xff]
let pad = (n: number) => new Array(n).fill(0)

let png = (w: number, h: number) =>
  bytes('\x89PNG\r\n\x1a\n', be32(13), 'IHDR', be32(w), be32(h), pad(5))

// A JFIF app segment and a huffman table stand between the start and the
// frame in most cameras' output, so the fixture puts them there.
let jpeg = (w: number, h: number, marker = 0xc0) =>
  bytes(
    0xff,
    0xd8,
    0xff,
    0xe0,
    be16(16),
    'JFIF\0',
    pad(9),
    0xff,
    0xc4,
    be16(4),
    pad(2),
    0xff,
    0xff, // a fill byte before the marker it pads
    marker,
    be16(17),
    8,
    be16(h),
    be16(w),
    pad(10),
  )

let gif = (w: number, h: number) => bytes('GIF89a', le16(w), le16(h), pad(2))

let riff = (tag: string, ...rest: (number | number[] | string)[]) =>
  bytes('RIFF', be32(0), 'WEBP', tag, be32(0), ...rest)

Deno.test('a png states its size in IHDR', () => {
  assertEquals(sizeOf(png(1600, 900)), { w: 1600, h: 900 })
  assertEquals(sizeOf(png(1, 1)), { w: 1, h: 1 })
  assertEquals(sizeOf(png(0, 0)), undefined)
  assertEquals(sizeOf(png(4, 4).slice(0, 20)), undefined)
})

Deno.test('a jpeg states its size in the frame the markers lead to', () => {
  assertEquals(sizeOf(jpeg(4032, 3024)), { w: 4032, h: 3024 })
  // Progressive and arithmetic frames are frames too; a table is not.
  assertEquals(sizeOf(jpeg(80, 60, 0xc2)), { w: 80, h: 60 })
  assertEquals(sizeOf(jpeg(80, 60, 0xc9)), { w: 80, h: 60 })
  assertEquals(sizeOf(jpeg(80, 60, 0xc4)), undefined)
  // The scan ends the walk: entropy bytes are not markers.
  assertEquals(
    sizeOf(bytes(0xff, 0xd8, 0xff, 0xda, be16(12), pad(20))),
    undefined,
  )
})

Deno.test('a gif states its logical screen', () => {
  assertEquals(sizeOf(gif(320, 200)), { w: 320, h: 200 })
  assertEquals(sizeOf(bytes('GIF87a', le16(6), le16(7), pad(2))), {
    w: 6,
    h: 7,
  })
})

Deno.test('a webp states its size three different ways', () => {
  // lossy: behind the keyframe's sync code, 14 bits apiece
  assertEquals(
    sizeOf(riff('VP8 ', pad(3), '\x9d\x01\x2a', le16(640), le16(480), pad(4))),
    { w: 640, h: 480 },
  )
  // lossless: 14 bits of w-1 then 14 of h-1, one little-endian word
  let packed = (639 | (479 << 14)) >>> 0
  assertEquals(
    sizeOf(riff(
      'VP8L',
      0x2f,
      [
        packed & 0xff,
        (packed >> 8) & 0xff,
        (packed >> 16) & 0xff,
        packed >>> 24,
      ],
      pad(5),
    )),
    { w: 640, h: 480 },
  )
  // extended: the canvas, one less than it is
  assertEquals(
    sizeOf(riff('VP8X', pad(4), le24(639), le24(479), pad(4))),
    { w: 640, h: 480 },
  )
})

Deno.test('a file that states no size gets none', () => {
  assertEquals(sizeOf(new TextEncoder().encode('the guest list\n')), undefined)
  assertEquals(sizeOf(new Uint8Array(0)), undefined)
  assertEquals(sizeOf(bytes('%PDF-1.7', pad(40))), undefined)
  assertEquals(sizeOf(bytes('RIFF', be32(0), 'WAVE', pad(30))), undefined)
})
