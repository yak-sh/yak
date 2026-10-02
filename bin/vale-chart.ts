// Paint the authored lands before deploy, beside the app's other files.
// deno run -A bin/vale-chart.ts
import { createCanvas, ImageData } from 'npm:@napi-rs/canvas@0.1.80'
import { chart } from '../apps/vale/chart.ts'
import { chartKey } from '../apps/vale/chartkey.ts'
import { SIZE } from '../apps/vale/levels.ts'
import { cellsOf, pyramid, TILE_SIZES } from '../apps/vale/maptiles.ts'
import { WORLD } from '../apps/vale/mapview.ts'
import type { Bundle } from '../apps/vale/net.ts'
import themes from '../apps/vale/seed/themes.json' with { type: 'json' }
import buildings from '../apps/vale/seed/buildings/plans.json' with {
  type: 'json',
}
import {
  installBuildingDesigns,
  installThemeDesigns,
} from '../apps/vale/terrain.ts'

export let seed = () => {
  installThemeDesigns(themes as Bundle[])
  installBuildingDesigns(buildings as Bundle[])
}

export let seedKey = () => chartKey(themes as Bundle[], buildings as Bundle[])

if (import.meta.main) {
  seed()
  let directory = new URL('../apps/vale/tiles/', import.meta.url)
  await Deno.mkdir(directory, { recursive: true })
  let cells: Record<string, string[]> = {}
  let painted = 0, encoded = 0, bytes = 0
  let files = new Set(['manifest.json'])
  for (let cell of cellsOf(WORLD)) {
    let start = performance.now()
    let pixels = pyramid(chart(cell[0] * SIZE, cell[1] * SIZE, SIZE, 1))
    painted += performance.now() - start
    start = performance.now()
    cells[cell.join(',')] = []
    for (let [level, size] of TILE_SIZES.entries()) {
      let canvas = createCanvas(size, size)
      canvas.getContext('2d').putImageData(
        new ImageData(pixels[level], size, size),
        0,
        0,
      )
      let name = `${cell.join(',')}-${size}.png`
      let png = canvas.toBuffer('image/png')
      await Deno.writeFile(new URL(name, directory), png)
      files.add(name)
      cells[cell.join(',')].push(`tiles/${name}`)
      bytes += png.byteLength
    }
    encoded += performance.now() - start
  }
  await Deno.writeTextFile(
    new URL('manifest.json', directory),
    JSON.stringify({ key: await seedKey(), cells }, null, 2) + '\n',
  )
  for await (let entry of Deno.readDir(directory)) {
    if (!files.has(entry.name)) {
      await Deno.remove(new URL(entry.name, directory), { recursive: true })
    }
  }
  console.log(JSON.stringify({
    cells: Object.keys(cells).length,
    pngBytes: bytes,
    chartMs: painted,
    encodeMs: encoded,
  }))
}
