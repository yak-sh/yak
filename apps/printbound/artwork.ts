import { decode, encode } from 'fast-png'

export let raster = (
  bytes: Uint8Array,
  coloring: boolean,
  box?: { width: number; height: number; dpi: number; bleed: boolean },
) => {
  let image = decode(bytes)
  if (image.depth != 8 || image.palette) {
    throw new Error('Artwork must be an 8-bit non-indexed PNG')
  }
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
  let channels = image.channels
  let data = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let rgb = [0, 0, 0], samples = 0
      let y0 = Math.floor(y * image.height / height),
        y1 = Math.ceil((y + 1) * image.height / height)
      let x0 = Math.floor(x * image.width / width),
        x1 = Math.ceil((x + 1) * image.width / width)
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          let at = (sy * image.width + sx) * channels
          let alpha = channels == 2 || channels == 4
            ? image.data[at + channels - 1] / 255
            : 1
          for (let c = 0; c < 3; c++) {
            rgb[c] += 255 * (1 - alpha) +
              image.data[at + (channels < 3 ? 0 : c)] * alpha
          }
          samples++
        }
      }
      let gray = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
      for (let c = 0; c < 3; c++) {
        let value = Math.round((coloring ? gray : rgb[c]) / samples)
        data[(y * width + x) * 3 + c] = coloring && value >= 245 ? 255 : value
      }
    }
  }
  return encode({ data, width, height, channels: 3 })
}

export let gray = (bytes: Uint8Array) => raster(bytes, true)

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
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8, idat: Uint8Array[] = [], header
  while (at + 8 <= bytes.length) {
    let length = view.getUint32(at),
      type = String.fromCharCode(...bytes.subarray(at + 4, at + 8)),
      data = bytes.subarray(at + 8, at + 8 + length)
    if (type == 'IHDR') header = data
    else if (type == 'IDAT') idat.push(data)
    else if (type == 'tRNS') return
    else if (type == 'IEND') break
    at += 12 + length
  }
  if (!header || !idat.length) return
  let [depth, color, , , interlace] = header.subarray(8, 13)
  if (depth != 8 || interlace || (color != 0 && color != 2)) return
  let data = new Uint8Array(idat.reduce((n, d) => n + d.length, 0))
  idat.reduce((n, d) => (data.set(d, n), n + d.length), 0)
  let size = new DataView(header.buffer, header.byteOffset)
  return {
    width: size.getUint32(0),
    height: size.getUint32(4),
    colors: color == 0 ? 1 : 3,
    data,
  }
}

/** A coloring page's gray levels: near-white (245 and up) prints as paper,
 * as raster() cleans a converted page. */
export let paper = Uint8Array.from(
  { length: 256 },
  (_, n) => n >= 245 ? 255 : n,
)
