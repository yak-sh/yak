// A picture's dimensions, read out of its own first bytes. A page wants to
// reserve a photo's space before the bytes arrive, so whoever stores one
// records `{w, h}` beside it — from the header, never by decoding: the size is
// written down in the first few dozen bytes of every format that has one, and
// there is no reason to unpack 20 MB of pixels to learn a number the file
// already states.
//
// Four formats state it — png, jpeg, gif, webp — and anything else gets no size
// at all. A guess would be worse than nothing: a page can measure the bitmap
// itself, but it cannot un-believe a row.

export type Size = { w: number; h: number }

// Whether the bytes at `i` are this ASCII string — a format's own signature,
// written the way the spec writes it ('\x89PNG\r\n\x1a\n').
let at = (b: Uint8Array, i: number, sig: string) =>
  [...sig].every((c, j) => b[i + j] == c.charCodeAt(0))

let be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
let be32 = (b: Uint8Array, i: number) => be16(b, i) * 0x10000 + be16(b, i + 2)
let le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
let le24 = (b: Uint8Array, i: number) => le16(b, i) | (b[i + 2] << 16)
let le32 = (b: Uint8Array, i: number) => le24(b, i) + b[i + 3] * 0x1000000

// PNG: the IHDR chunk is always first, and opens with the two dimensions.
let png = (b: Uint8Array) =>
  b.length >= 24 && at(b, 0, '\x89PNG\r\n\x1a\n') && at(b, 12, 'IHDR')
    ? { w: be32(b, 16), h: be32(b, 20) }
    : undefined

// GIF: the logical screen, little-endian, right behind the version.
let gif = (b: Uint8Array) =>
  b.length >= 10 && (at(b, 0, 'GIF87a') || at(b, 0, 'GIF89a'))
    ? { w: le16(b, 6), h: le16(b, 8) }
    : undefined

// WebP is three formats in a RIFF wrapper, each stating its size in a different
// place: lossy after the keyframe's sync code, lossless packed 14 bits apiece
// into one little-endian word, and extended as the canvas size, stored one less
// than it is.
let webp = (b: Uint8Array) => {
  if (b.length < 30 || !at(b, 0, 'RIFF') || !at(b, 8, 'WEBP')) return
  if (at(b, 12, 'VP8 ') && at(b, 23, '\x9d\x01\x2a')) {
    return { w: le16(b, 26) & 0x3fff, h: le16(b, 28) & 0x3fff }
  }
  if (at(b, 12, 'VP8L') && b[20] == 0x2f) {
    let bits = le32(b, 21)
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (at(b, 12, 'VP8X')) return { w: le24(b, 24) + 1, h: le24(b, 27) + 1 }
}

// A JPEG states its size in a frame header somewhere after the start, so the
// markers are walked until one is found: each carries its own length, a handful
// stand alone, and any of the SOF variants opens with precision, height, width.
// The walk stops at the start of scan — past it the bytes are entropy-coded,
// and an 0xff there is data, not a marker.
let SOF = (m: number) =>
  m >= 0xc0 && m <= 0xcf && m != 0xc4 && m != 0xc8 && m != 0xcc

let jpeg = (b: Uint8Array) => {
  if (!at(b, 0, '\xff\xd8')) return
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] != 0xff) return
    let m = b[i + 1]
    if (m == 0xff) i++ // fill bytes pad a marker
    else if (m == 0xd8 || m == 0x01 || (m >= 0xd0 && m <= 0xd7)) i += 2
    else if (m == 0xda) return
    else if (SOF(m)) return { w: be16(b, i + 7), h: be16(b, i + 5) }
    else i += 2 + be16(b, i + 2)
  }
}

/**
 * What kind of picture the bytes are, read from their own signature — the one
 * thing a caller can trust over the label it was handed — or `undefined` for
 * anything that is not one of the four formats.
 *
 * ```ts
 * import { mediaTypeOf } from '@yaks/blob'
 *
 * mediaTypeOf(pngBytes) // 'image/png'
 * mediaTypeOf(svgBytes) // undefined
 * ```
 */
export let mediaTypeOf = (b: Uint8Array): string | undefined =>
  at(b, 0, '\x89PNG\r\n\x1a\n')
    ? 'image/png'
    : at(b, 0, '\xff\xd8\xff')
    ? 'image/jpeg'
    : at(b, 0, 'GIF87a') || at(b, 0, 'GIF89a')
    ? 'image/gif'
    : at(b, 0, 'RIFF') && at(b, 8, 'WEBP')
    ? 'image/webp'
    : undefined

/**
 * The size a file states about itself, or `undefined` — including for a header
 * that states a zero, which is a broken file and not a picture of no width.
 *
 * ```ts
 * import { sizeOf } from '@yaks/blob'
 *
 * sizeOf(pngBytes) // { w: 1600, h: 900 }
 * sizeOf(pdfBytes) // undefined
 * ```
 */
export let sizeOf = (b: Uint8Array): Size | undefined => {
  let s = png(b) ?? jpeg(b) ?? gif(b) ?? webp(b)
  return s && s.w > 0 && s.h > 0 ? s : undefined
}
