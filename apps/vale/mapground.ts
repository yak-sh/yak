// A view scales sheets of explored ground. Each chunk's fixed-detail pixels
// are copied once; no charting, resampling or image loading happens on zoom.
import { chartVersion, groundCoverage, groundView } from './grown.ts'
import { chartsheet } from './chartsheet.ts'
import { SIZE } from './levels.ts'
import type { Box } from './mapview.ts'
import { CHUNK } from './terrain.ts'

let sheets = () =>
  chartsheet(() => {
    let image = document.createElement('canvas')
    image.width = image.height = SIZE
    let ctx = image.getContext('2d')!
    return {
      image,
      put: (px: Uint8ClampedArray<ArrayBuffer>, x: number, z: number) =>
        ctx.putImageData(new ImageData(px, CHUNK, CHUNK), x, z),
    }
  })
let compose = sheets(), version = chartVersion

export let groundImages = async (box: Box, known: ReadonlySet<string>) => {
  if (version != chartVersion) {
    version = chartVersion
    compose = sheets()
  }
  // Capture this design's sheets; pending replies never paint into new ones.
  let paint = compose
  return paint(await groundView(box, (cell) => groundCoverage(cell, known)))
}
