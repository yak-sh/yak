// A PNG from pixels: what a host that draws an image server-side hands a mail
// client or a browser. Pure apart from the platform's CompressionStream.

// CRC-32 (ISO 3309), which every PNG chunk ends with.
let TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
let crc = (bytes: Uint8Array) =>
  (bytes.reduce((c, b) => TABLE[(c ^ b) & 0xff] ^ (c >>> 8), 0xffffffff) ^
    0xffffffff) >>> 0

// What every PNG file starts with.
let SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

let u32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

let chunk = (type: string, data: Uint8Array) => {
  let body = new Uint8Array([...new TextEncoder().encode(type), ...data])
  return [...u32(data.length), ...body, ...u32(crc(body))]
}

let deflate = async (bytes: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  )

/**
 * An RGBA image `w` by `h` pixels as PNG bytes: `rgba` holds four bytes a
 * pixel, row by row from the top left.
 *
 * ```ts
 * import { png } from '@yaks/blob/png'
 * import { sizeOf } from '@yaks/blob'
 * import { equal } from '@yaks/testing'
 *
 * let red = new Uint8Array(3 * 2 * 4).map((_, i) => i % 4 == 1 || i % 4 == 2 ? 0 : 255)
 * equal(sizeOf(await png(3, 2, red)), { w: 3, h: 2 })
 * ```
 */
export let png = async (
  w: number,
  h: number,
  rgba: Uint8Array,
): Promise<Uint8Array> => {
  let rows = new Uint8Array(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    rows.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1)
  }
  return new Uint8Array([
    ...SIGNATURE,
    ...chunk('IHDR', new Uint8Array([...u32(w), ...u32(h), 8, 6, 0, 0, 0])),
    ...chunk('IDAT', await deflate(rows)),
    ...chunk('IEND', new Uint8Array()),
  ])
}
