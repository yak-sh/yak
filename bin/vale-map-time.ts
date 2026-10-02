// Native headless canvas timings; no browser or server. The baseline uses its
// own tracked painter, images and seeds, with its scratch removed on exit.
// deno run -A bin/vale-map-time.ts --before=<commit>
import { createCanvas, ImageData } from 'npm:@napi-rs/canvas@0.1.80'
import { chart, chartPatch, chartRegions } from '../apps/vale/chart.ts'
import { chartbook } from '../apps/vale/chartbook.ts'
import { chartsheet } from '../apps/vale/chartsheet.ts'
import { SIZE } from '../apps/vale/levels.ts'
import { coverage } from '../apps/vale/chartcover.ts'
import { type Box, pan, view, zoom } from '../apps/vale/mapview.ts'
import { arriveOf } from '../apps/vale/ways.ts'
import { CHUNK, patchOf, vale } from '../apps/vale/terrain.ts'
import { seedThemes } from '../apps/vale/themes_fixture.ts'
import { seedBuildings } from '../apps/vale/buildings_fixture.ts'

let option = (name: string) =>
  Deno.args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]
let sample = option('sample')

if (sample) {
  seedThemes()
  seedBuildings()
  let box = view(arriveOf('mossvale')), known = new Set(['mossvale'])
  let canvas = createCanvas(320, 320), ctx = canvas.getContext('2d')
  let pixels = chartbook<Uint8ClampedArray<ArrayBuffer>>()
  let compose = chartsheet(() => {
    let image = createCanvas(SIZE, SIZE), ctx = image.getContext('2d')
    return {
      image,
      put: (px: Uint8ClampedArray<ArrayBuffer>, x: number, z: number) =>
        ctx.putImageData(new ImageData(px, CHUNK, CHUNK), x, z),
    }
  })
  let explored = coverage(), calls = 0, chartMs = 0, growthChartMs = 0
  let paintCell = (ci: number, ck: number, grown = false) => {
    let v = vale(1), p = grown ? patchOf(v, ci, ck) : null
    let props = p ? v.plant(ci, ck) : []
    if (p) explored.keep([ci, ck], chartRegions(p))
    let start = performance.now()
    let px = p ? chartPatch(p, props) : chart(ci * CHUNK, ck * CHUNK, CHUNK, 1)
    let elapsed = performance.now() - start
    if (grown) growthChartMs += elapsed
    else {
      calls++
      chartMs += elapsed
    }
    return px
  }
  // A hero who has traversed the nearby region has already grown its ground.
  // Keep the wider rectangle so the timed pan and zoom revisit that ground.
  if (sample == 'grown') {
    await pixels.read(
      zoom(box, 2),
      (cell) => explored(cell, known),
      (cell) => Promise.resolve(paintCell(...cell, true)),
    )
  }
  let paint = async (box: Box) => {
    let charts = compose(
      await pixels.read(
        box,
        (cell) => explored(cell, known),
        (cell) => Promise.resolve(paintCell(...cell)),
      ),
    )
    ctx.clearRect(0, 0, 320, 320)
    for (let { image, box: cell } of charts) {
      let scale = 320 / box[2]
      ctx.drawImage(
        image,
        (cell[0] - box[0]) * scale,
        (cell[1] - box[1]) * scale,
        cell[2] * scale,
        cell[2] * scale,
      )
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
  let first = await time(box), pans = []
  for (let i = 0; i < 12; i++) {
    pans.push(await time(pan(box, i * 0.002, 0.002)))
  }
  let zoomed = await time(zoom(box, 2))
  let mean = (key: keyof typeof first) =>
    pans.reduce((sum, pan) => sum + pan[key], 0) / pans.length
  console.log(
    JSON.stringify({
      box,
      growthChartMs,
      first,
      pan: {
        paintMs: mean('paintMs'),
        chartMs: mean('chartMs'),
        chartCalls: mean('chartCalls'),
      },
      zoom: zoomed,
    }),
  )
} else {
  let before = option('before') ?? 'main'
  let scratch = await Deno.makeTempDir({ prefix: 'vale-map-time-' })
  try {
    let archive = await new Deno.Command('git', {
      args: [
        'archive',
        before,
        'apps/vale',
        'bin/vale-map-time.ts',
        'bin/vale-chart.ts',
      ],
      stdout: 'piped',
      stderr: 'inherit',
    }).output()
    if (!archive.success) throw new Error('baseline archive failed')
    let tar = new Deno.Command('tar', {
      args: ['-x', '-C', scratch],
      stdin: 'piped',
    }).spawn()
    let writer = tar.stdin.getWriter()
    await writer.write(archive.stdout)
    await writer.close()
    if (!(await tar.status).success) throw new Error('baseline extract failed')
    let results: Record<string, unknown> = {
      baseline: before,
      backend: '@napi-rs/canvas',
    }
    for (let mode of ['before', 'grown', 'reload']) {
      let samples = []
      for (let i = 0; i < 5; i++) {
        let result = await new Deno.Command(Deno.execPath(), {
          args: [
            'run',
            '-A',
            '--no-lock',
            `--config=${new URL('../deno.json', import.meta.url).pathname}`,
            mode == 'before'
              ? `${scratch}/bin/vale-map-time.ts`
              : new URL(import.meta.url).pathname,
            `--sample=${mode == 'before' ? 'after' : mode}`,
          ],
          stdout: 'piped',
          stderr: 'inherit',
        }).output()
        if (!result.success) throw new Error(`${mode} measurement failed`)
        samples.push(JSON.parse(new TextDecoder().decode(result.stdout)))
      }
      let median = (values: number[]) => values.sort((a, b) => a - b)[2]
      results[mode] = Object.fromEntries(
        ['first', 'pan', 'zoom'].map((
          step,
        ) => [
          step,
          Object.fromEntries(
            ['paintMs', 'chartMs', 'chartCalls'].map((
              key,
            ) => [
              key,
              median(samples.map((s) => s[step][key])),
            ]),
          ),
        ]),
      )
    }
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await Deno.remove(scratch, { recursive: true })
  }
}
