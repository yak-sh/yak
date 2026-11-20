// The extension's icon, drawn by code at build time so no image lives in the
// repository, and written as a PNG.

import { png as encode } from '@yaks/blob/png'

/** A colour, as red, green, blue and alpha bytes. */
export type Rgba = [number, number, number, number]

let GREEN: Rgba = [167, 192, 128, 255]
let DARK: Rgba = [45, 53, 59, 255]
let CREAM: Rgba = [211, 198, 170, 255]
let CLEAR: Rgba = [0, 0, 0, 0]

/** The icon's colour at a point of the unit square: a rounded square, an
 * eye's dark almond across it, its iris and its pupil. */
export let eye = (x: number, y: number): Rgba => {
  let [dx, dy] = [Math.abs(x - 0.5), Math.abs(y - 0.5)]
  let corner = Math.hypot(Math.max(dx - 0.3, 0), Math.max(dy - 0.3, 0))
  let r = Math.hypot(dx, dy)
  return corner > 0.2
    ? CLEAR
    : r < 0.065
    ? DARK
    : r < 0.14
    ? CREAM
    : Math.hypot(dx / 0.38, dy / 0.24) <= 1
    ? DARK
    : GREEN
}

/** A square PNG `size` pixels wide, each pixel painted from four samples of
 * `paint` over the unit square, so its edges are smooth. */
export let png = async (
  size: number,
  paint: (x: number, y: number) => Rgba = eye,
): Promise<Uint8Array> => {
  let pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let at = (y * size + x) * 4
      let samples = [0.25, 0.75].flatMap((sy) =>
        [0.25, 0.75].map((sx) => paint((x + sx) / size, (y + sy) / size))
      )
      let alpha = samples.reduce((a, s) => a + s[3], 0)
      for (let c = 0; c < 3; c++) {
        pixels[at + c] = alpha &&
          Math.round(samples.reduce((a, s) => a + s[c] * s[3], 0) / alpha)
      }
      pixels[at + 3] = Math.round(alpha / 4)
    }
  }
  return await encode(size, size, pixels)
}
