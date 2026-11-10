import { encode } from 'fast-png'

/** Native model dimensions, generated in memory; no image asset is kept in git. */
export let nativeArtwork = () => {
  let width = 2400, height = 3040
  let data = new Uint8Array(width * height * 3).fill(255)
  for (let y = 400; y < 2600; y++) {
    for (let x = 300; x < 2100; x++) {
      if (x % 200 > 6 && y % 200 > 6) continue
      let at = (y * width + x) * 3
      data[at] = 180
      data[at + 1] = 30
      data[at + 2] = 10
    }
  }
  return encode({ width, height, channels: 3, data })
}
