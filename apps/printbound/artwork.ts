import { decode } from 'fast-png'

/** zlib through the runtime's own streams, native where fast-png and pdf-lib
 * inflate and deflate in JavaScript: a 2400x3040 page spent most of an app
 * Worker's CPU there. */
let zlib = async (data: Uint8Array, stream: GenericTransformStream) =>
  new Uint8Array(
    await new Response(
      new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream),
    ).arrayBuffer(),
  )

export let inflated = (data: Uint8Array) =>
  zlib(data, new DecompressionStream('deflate'))

export let deflated = (data: Uint8Array) =>
  zlib(data, new CompressionStream('deflate'))

/** A PNG's header and its joined zlib stream, unread. */
type Png = {
  width: number
  height: number
  depth: number
  color: number
  interlace: number
  transparent: boolean
  data: Uint8Array
}

let parsed = (bytes: Uint8Array): Png | undefined => {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8, idat: Uint8Array[] = [], header, transparent = false
  while (at + 8 <= bytes.length) {
    let length = view.getUint32(at),
      type = String.fromCharCode(...bytes.subarray(at + 4, at + 8)),
      data = bytes.subarray(at + 8, at + 8 + length)
    if (type == 'IHDR') header = data
    else if (type == 'IDAT') idat.push(data)
    else if (type == 'tRNS') transparent = true
    else if (type == 'IEND') break
    at += 12 + length
  }
  if (!header || !idat.length) return
  let [depth, color, , , interlace] = header.subarray(8, 13)
  let data = new Uint8Array(idat.reduce((n, d) => n + d.length, 0))
  idat.reduce((n, d) => (data.set(d, n), n + d.length), 0)
  let size = new DataView(header.buffer, header.byteOffset)
  return {
    width: size.getUint32(0),
    height: size.getUint32(4),
    depth,
    color,
    interlace,
    transparent,
    data,
  }
}

/** Samples a pixel, by PNG color type: gray, RGB, gray and alpha, RGBA. */
let CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 }

let paeth = (a: number, b: number, c: number) => {
  let p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** PNG's row filters undone, `bpp` bytes a pixel: each row is copied, then
 * its predictor added in place, one loop a filter type. */
let unfiltered = (
  raw: Uint8Array,
  width: number,
  height: number,
  bpp: number,
) => {
  let stride = width * bpp, out = new Uint8Array(stride * height)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    let from = y * (stride + 1), type = raw[from]
    let row = out.subarray(y * stride, (y + 1) * stride)
    row.set(raw.subarray(from + 1, from + 1 + stride))
    if (type == 1) {
      for (let x = bpp; x < stride; x++) row[x] += row[x - bpp]
    } else if (type == 2) {
      for (let x = 0; x < stride; x++) row[x] += prev[x]
    } else if (type == 3) {
      for (let x = 0; x < bpp; x++) row[x] += prev[x] >> 1
      for (let x = bpp; x < stride; x++) {
        row[x] += (row[x - bpp] + prev[x]) >> 1
      }
    } else if (type == 4) {
      for (let x = 0; x < bpp; x++) row[x] += prev[x]
      for (let x = bpp; x < stride; x++) {
        row[x] += paeth(row[x - bpp], prev[x], prev[x - bpp])
      }
    } else if (type != 0) {
      throw new Error('Artwork PNG has an unknown row filter')
    }
    prev = row
  }
  return out
}

/** 8-bit samples: the usual PNG through native zlib, any other through
 * fast-png. */
let decoded = async (bytes: Uint8Array) => {
  let png = parsed(bytes), channels = png && CHANNELS[png.color]
  if (png && channels && png.depth == 8 && !png.interlace && !png.transparent) {
    let { width, height } = png
    let data = unfiltered(await inflated(png.data), width, height, channels)
    return { width, height, channels, data }
  }
  let image = decode(bytes)
  if (image.depth != 8 || image.palette) {
    throw new Error('Artwork must be an 8-bit non-indexed PNG')
  }
  return { ...image, data: image.data as Uint8Array }
}

export let pixels = async (
  bytes: Uint8Array,
  coloring: boolean,
  box?: { width: number; height: number; dpi: number; bleed: boolean },
) => {
  let image = await decoded(bytes)
  let scale = box
    ? Math.min(
      1,
      (box.bleed ? Math.max : Math.min)(
        box.width / image.width,
        box.height / image.height,
      ) * box.dpi / 72,
    )
    : 1
  let width = Math.ceil(image.width * scale),
    height = Math.ceil(image.height * scale)
  let { channels, data: source } = image
  let output: 1 | 3 = coloring || channels < 3 ? 1 : 3
  let alpha = channels == 2 || channels == 4,
    g = channels < 3 ? 0 : 1,
    b = channels < 3 ? 0 : 2
  let x0s = Int32Array.from(
      { length: width },
      (_, x) => Math.floor(x * image.width / width),
    ),
    x1s = Int32Array.from(
      { length: width },
      (_, x) => Math.ceil((x + 1) * image.width / width),
    )
  let data = new Uint8Array(width * height * output)
  for (let y = 0; y < height; y++) {
    let y0 = Math.floor(y * image.height / height),
      y1 = Math.ceil((y + 1) * image.height / height)
    for (let x = 0; x < width; x++) {
      let red = 0, green = 0, blue = 0, samples = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0s[x]; sx < x1s[x]; sx++) {
          let at = (sy * image.width + sx) * channels
          if (alpha) {
            let opacity = source[at + channels - 1] / 255,
              white = 255 * (1 - opacity)
            red += white + source[at] * opacity
            green += white + source[at + g] * opacity
            blue += white + source[at + b] * opacity
          } else {
            red += source[at]
            green += source[at + g]
            blue += source[at + b]
          }
          samples++
        }
      }
      let at = (y * width + x) * output
      if (output == 1) {
        let value = Math.round(
          (.2126 * red + .7152 * green + .0722 * blue) / samples,
        )
        data[at] = coloring && value >= 245 ? 255 : value
      } else {
        data[at] = Math.round(red / samples)
        data[at + 1] = Math.round(green / samples)
        data[at + 2] = Math.round(blue / samples)
      }
    }
  }
  return { data, width, height, channels: output }
}

/** A PNG a PDF can carry as it is: its zlib rows, which PDF's FlateDecode
 * reads with the PNG predictors, so embedding never decodes a pixel. */
export type Rows = {
  width: number
  height: number
  colors: 1 | 3
  data: Uint8Array
}

/** The rows of an 8-bit, non-interlaced grayscale or RGB PNG without
 * transparency; undefined for any other PNG, which must be converted. */
export let rows = (bytes: Uint8Array): Rows | undefined => {
  let png = parsed(bytes)
  if (
    !png || png.transparent || png.depth != 8 || png.interlace ||
    (png.color != 0 && png.color != 2)
  ) return
  let { width, height, color, data } = png
  return { width, height, colors: color == 0 ? 1 : 3, data }
}

/** A coloring page's gray levels: near-white (245 and up) prints as paper,
 * as pixels() cleans a converted page. */
export let paper = Uint8Array.from(
  { length: 256 },
  (_, n) => n >= 245 ? 255 : n,
)
