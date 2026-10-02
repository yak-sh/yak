// Shipped ground is decoded once. Frontier cells and changed store designs
// are charted once off-thread, then kept at every map scale on this page.
import { chartDesignKey, charted } from './grown.ts'
import { SIZE } from './levels.ts'
import { atlas, pyramid, TILE_SIZES } from './maptiles.ts'
import manifest from './tiles/manifest.json' with { type: 'json' }

let canvasOf = (px: Uint8ClampedArray<ArrayBuffer>, size: number) => {
  let canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  canvas.getContext('2d')!.putImageData(new ImageData(px, size, size), 0, 0)
  return canvas
}

let imageOf = async (path: string) => {
  let image = new Image()
  image.src = new URL(path, import.meta.url).href
  await image.decode()
  return image
}

/** Tile images positioned in world metres, independent of the current view. */
export let groundTiles = atlas<CanvasImageSource>(async ([gx, gz]) => {
  let files = (manifest.cells as Record<string, string[]>)[`${gx},${gz}`]
  if (files && await chartDesignKey() == manifest.key) {
    try {
      return await Promise.all(files.map(imageOf))
    } catch (e) {
      reportError(e)
    }
  }
  let px = await charted(gx * SIZE, gz * SIZE, SIZE, 1)
  return pyramid(px).map((px, i) => canvasOf(px, TILE_SIZES[i]))
})
