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

export let monochrome = (bytes: Uint8Array) => {
  let image = decode(bytes)
  if (image.channels < 3) return true
  for (let i = 0; i < image.data.length; i += image.channels) {
    if (
      Math.max(image.data[i], image.data[i + 1], image.data[i + 2]) -
          Math.min(image.data[i], image.data[i + 1], image.data[i + 2]) > 2
    ) return false
  }
  return true
}
