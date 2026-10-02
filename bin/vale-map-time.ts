// Headless ground-paint timings, including native Canvas work and PNG decoding.
// deno run -A bin/vale-map-time.ts --before=<commit>
import {
  type Canvas,
  createCanvas,
  type Image,
  ImageData,
  loadImage,
} from 'npm:@napi-rs/canvas@0.1.80'
import { chart } from '../apps/vale/chart.ts'
import { atlas, pyramid, TILE_SIZES } from '../apps/vale/maptiles.ts'
import { type Box, pan, view, zoom } from '../apps/vale/mapview.ts'
import { arriveOf } from '../apps/vale/ways.ts'
import { seed } from './vale-chart.ts'

let option = (name: string) =>
  Deno.args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]
let before = option('before') ?? 'main'
let sample = option('sample')
let app = new URL('../apps/vale/', import.meta.url)

if (sample) {
  seed()
  let box = view(arriveOf('mossvale'))
  let canvas = createCanvas(320, 320), ctx = canvas.getContext('2d')
  let calls = 0, chartMs = 0
  let paint: (box: Box) => Promise<void>
  if (sample == 'before') {
    let output = await new Deno.Command('git', {
      args: ['show', `${before}:apps/vale/chart.ts`],
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    if (!output.success) {
      throw new Error(new TextDecoder().decode(output.stderr))
    }
    let source = new TextDecoder().decode(output.stdout).replace(
      /(['"])(\.\/[^'"]+)\1/g,
      (_, quote, path) => `${quote}${new URL(path, app).href}${quote}`,
    )
    let old = (await import(
      `data:application/typescript;base64,${btoa(source)}`
    )).chart as typeof chart
    paint = (box) => {
      let start = performance.now()
      let px = old(...box, box[2] / 320)
      chartMs += performance.now() - start
      calls++
      ctx.putImageData(new ImageData(px, 320, 320), 0, 0)
      return Promise.resolve()
    }
  } else {
    let manifest: { cells: Record<string, string[]> } | undefined
    let tiles = atlas<Canvas | Image>(async (cell) => {
      let paths = manifest!.cells[cell.join(',')]
      if (paths) {
        return await Promise.all(
          paths.map(async (path) =>
            await loadImage(await Deno.readFile(new URL(path, app)))
          ),
        )
      }
      let start = performance.now()
      let pixels = pyramid(chart(cell[0] * 256, cell[1] * 256, 256, 1))
      chartMs += performance.now() - start
      calls++
      return pixels.map((px, i) => {
        let size = TILE_SIZES[i], image = createCanvas(size, size)
        image.getContext('2d').putImageData(new ImageData(px, size, size), 0, 0)
        return image
      })
    })
    paint = async (box) => {
      manifest ??= JSON.parse(
        await Deno.readTextFile(
          new URL('tiles/manifest.json', app),
        ),
      )
      let ground = await tiles(box, 0)
      ctx.clearRect(0, 0, 320, 320)
      for (let tile of ground) {
        let scale = 320 / box[2]
        ctx.drawImage(
          tile.image,
          (tile.box[0] - box[0]) * scale,
          (tile.box[1] - box[1]) * scale,
          tile.box[2] * scale,
          tile.box[2] * scale,
        )
      }
    }
  }
  let time = async (next: Box) => {
    let previousCalls = calls,
      previousChart = chartMs,
      start = performance.now()
    await paint(next)
    return {
      paintMs: performance.now() - start,
      chartMs: chartMs - previousChart,
      chartCalls: calls - previousCalls,
    }
  }
  let first = await time(box)
  let pans = []
  for (let i = 0; i < 12; i++) pans.push(await time(pan(box, i * 0.002, 0.002)))
  let zoomed = await time(zoom(box, 2))
  let mean = (key: keyof typeof first) =>
    pans.reduce((sum, pan) => sum + pan[key], 0) / pans.length
  console.log(JSON.stringify({
    box,
    first,
    pan: {
      paintMs: mean('paintMs'),
      chartMs: mean('chartMs'),
      chartCalls: mean('chartCalls'),
    },
    zoom: zoomed,
  }))
} else {
  let results: Record<string, unknown> = {
    baseline: before,
    backend: '@napi-rs/canvas',
  }
  for (let mode of ['before', 'after']) {
    let samples = []
    for (let i = 0; i < 5; i++) {
      let result = await new Deno.Command(Deno.execPath(), {
        args: [
          'run',
          '-A',
          '--no-lock',
          new URL(import.meta.url).pathname,
          `--before=${before}`,
          `--sample=${mode}`,
        ],
        stdout: 'piped',
        stderr: 'inherit',
      }).output()
      if (!result.success) throw new Error(`${mode} measurement failed`)
      samples.push(JSON.parse(new TextDecoder().decode(result.stdout)))
    }
    let median = (values: number[]) => values.sort((a, b) => a - b)[2]
    results[mode] = Object.fromEntries(['first', 'pan', 'zoom'].map((step) => [
      step,
      Object.fromEntries(['paintMs', 'chartMs', 'chartCalls'].map((key) => [
        key,
        median(samples.map((sample) => sample[step][key])),
      ])),
    ]))
  }
  console.log(JSON.stringify(results, null, 2))
}
