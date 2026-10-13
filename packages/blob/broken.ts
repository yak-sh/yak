// Whether a file that claims a picture type is one, said as what is wrong with
// it. A chat model asked for a PNG transcribes something PNG-shaped: the
// signature and a header it can copy, then chunk checksums and a deflate stream
// it cannot compute. Stored as it came, that file is served as an app's icon
// and draws nothing, and nobody hears why. So the bytes are read the way a
// decoder reads them, before anything keeps them.
//
// A PNG is checked whole: every chunk's CRC, the header's fields, and the pixel
// data inflated as a stream, scanline by scanline, so a 20 MB file costs its
// own size in memory and no more. JPEG, GIF and WebP are checked as far as
// their headers go (the signature, and a size stated where image.ts reads it):
// decoding their pixels needs a codec, and nobody hand-writes them. An SVG is
// text with an <svg> element. A type nothing here reads (ico, avif) is let
// through, since a refusal of what was never checked would be a guess.
import { mediaTypeOf, sizeOf } from './image.ts'

let NAMES: Record<string, string> = {
  'image/png': 'a PNG',
  'image/jpeg': 'a JPEG',
  'image/gif': 'a GIF',
  'image/webp': 'a WebP',
}

let be32 = (b: Uint8Array, i: number) =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
let ascii = (b: Uint8Array, i: number, n: number) =>
  String.fromCharCode(...b.subarray(i, i + n))

// CRC-32 as PNG defines it (ISO 3309), over a chunk's type and data.
let TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
let crc = (b: Uint8Array) => {
  let c = ~0
  for (let x of b) c = TABLE[(c ^ x) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}

// Channels per colour type, and the bit depths the spec allows each.
let COLOURS: Record<number, [number, number[]]> = {
  0: [1, [1, 2, 4, 8, 16]],
  2: [3, [8, 16]],
  3: [1, [1, 2, 4, 8]],
  4: [2, [8, 16]],
  6: [4, [8, 16]],
}

// Adam7's seven passes, as [x, y, dx, dy]; a plain image is one pass of all.
let ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
]

// The scanlines the inflated data must hold, pass by pass: how many, and each
// one's length, a filter byte then its pixels.
let lines = (w: number, h: number, bits: number, interlaced: boolean) =>
  (interlaced ? ADAM7 : [[0, 0, 1, 1]]).flatMap(([x, y, dx, dy]) => {
    let pw = Math.ceil((w - x) / dx), ph = Math.ceil((h - y) / dy)
    return pw > 0 && ph > 0
      ? [{ n: ph, len: 1 + Math.ceil(pw * bits / 8) }]
      : []
  })

// The pixel data inflated, each scanline's filter byte read on the way past,
// and the total held to what the header promised.
let inflates = async (
  idat: Uint8Array[],
  rows: { n: number; len: number }[],
) => {
  let need = rows.reduce((t, r) => t + r.n * r.len, 0)
  let got = 0, pass = 0, row = 0, at = 0
  let stream = new Blob(idat as BlobPart[]).stream()
    .pipeThrough(new DecompressionStream('deflate'))
  try {
    for await (let chunk of stream) {
      if (got + chunk.length > need) {
        return `its pixel data inflates past the ${need} bytes its header needs`
      }
      got += chunk.length
      for (let i = 0; i < chunk.length;) {
        if (at == 0 && chunk[i] > 4) {
          return `a scanline names filter ${chunk[i]}, and PNG has 0 to 4`
        }
        let step = Math.min(rows[pass].len - at, chunk.length - i)
        i += step
        at += step
        if (at == rows[pass].len) {
          at = 0
          if (++row == rows[pass].n) row = 0, pass++
        }
      }
    }
  } catch {
    return 'its pixel data does not inflate'
  }
  return got < need
    ? `its pixel data is ${got} bytes where its header needs ${need}`
    : undefined
}

let png = async (b: Uint8Array) => {
  let idat: Uint8Array[] = [], header, palette = false
  for (let i = 8;;) {
    if (i + 8 > b.length) return 'it ends before its IEND chunk'
    let n = be32(b, i), type = ascii(b, i + 4, 4)
    if (i + 12 + n > b.length) return `it ends inside its ${type} chunk`
    if (crc(b.subarray(i + 4, i + 8 + n)) != be32(b, i + 8 + n)) {
      return `its ${type} chunk fails its checksum`
    }
    let data = b.subarray(i + 8, i + 8 + n)
    if (!header && (type != 'IHDR' || n != 13)) {
      return 'its first chunk is not a 13-byte IHDR'
    }
    if (type == 'IHDR') header = data
    if (type == 'PLTE') palette = true
    if (type == 'IDAT') idat.push(data)
    if (type == 'IEND') break
    i += 12 + n
  }
  let [w, h] = [be32(header!, 0), be32(header!, 4)]
  let [depth, colour, method, filter, interlace] = header!.subarray(8)
  let [channels, depths] = COLOURS[colour] ?? [0, []]
  if (!w || !h) return 'its header states no size'
  if (!depths.includes(depth)) {
    return `its header names colour type ${colour} at depth ${depth}`
  }
  if (method || filter || interlace > 1) return 'its header names no method'
  if (colour == 3 && !palette) return 'it is indexed and has no palette'
  if (!idat.length) return 'it has no IDAT chunk'
  return await inflates(idat, lines(w, h, channels * depth, interlace == 1))
}

let svg = (b: Uint8Array) => {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch {
    return 'its bytes are not text'
  }
  return /<svg[\s/>]/i.test(text) ? undefined : 'it has no <svg> element'
}

/**
 * What is wrong with bytes that claim to be a picture of `type`, or
 * `undefined` when they decode as one (or `type` is one nothing here reads).
 * The answer is a clause, to follow "icon.png does not decode: ".
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { broken } from '@yaks/blob'
 *
 * let png = Uint8Array.from(atob(
 *   'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
 * ), (c) => c.charCodeAt(0))
 * assertEquals(await broken(png, 'image/png'), undefined)
 * assertEquals(
 *   await broken(png.slice(0, 50), 'image/png'),
 *   'it ends inside its IDAT chunk',
 * )
 * assertEquals(
 *   await broken(png, 'image/jpeg'),
 *   'its bytes are a PNG, not a JPEG',
 * )
 * ```
 */
export let broken = async (
  b: Uint8Array,
  type: string,
): Promise<string | undefined> => {
  if (type == 'image/svg+xml') return svg(b)
  let name = NAMES[type]
  if (!name) return
  let is = mediaTypeOf(b)
  if (is != type) {
    return is ? `its bytes are ${NAMES[is]}, not ${name}` : `it is not ${name}`
  }
  if (!sizeOf(b)) return 'its header states no size'
  return type == 'image/png' ? await png(b) : undefined
}
