// yak-raster through its one door, with resvg's own WebAssembly: what an
// author's SVG comes back as, and what it is refused for.
import { createRequire } from 'node:module'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { initWasm } from '@resvg/resvg-wasm'
import { broken, sizeOf } from '@yaks/blob'
import { test } from '@yaks/testing'
import { draw } from './draw.ts'

// Once a runtime, as index.ts starts it: resvg refuses a second start, and
// this file may be loaded twice in one (--twice, packages/testing/main.ts).
let g = globalThis as { resvg?: Promise<void> }
await (g.resvg ??= Deno.readFile(
  createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm'),
).then(initWasm))

let posted = (svg: string, query = '') =>
  draw(new Request(`https://raster/${query}`, { method: 'POST', body: svg }))

let icon = (inner: string, box = '0 0 24 24') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${inner}</svg>`

// Small, so the drawing is cheap: the size asked is what comes back.
let tiny = (query = '?size=16') =>
  posted(icon('<circle cx="12" cy="12" r="9" fill="teal"/>'), query)

// Draw through the real HTTP door once; the contract checks the returned
// headers and decoded dimensions, not scheduling resvg and body consumption.
let square = await tiny('?size=20')
let squareType = square.headers.get('content-type')
let squareSize = sizeOf(new Uint8Array(await square.arrayBuffer()))
test('a square SVG comes back a PNG of the size asked', () => {
  assertEquals(squareType, 'image/png')
  assertEquals(squareSize, { w: 20, h: 20 })
})

let decodedPNG = await broken(
  new Uint8Array(await (await tiny()).arrayBuffer()),
  'image/png',
)
test('the PNG decodes', () => {
  assertEquals(decodedPNG, undefined)
})

test('an SVG that cannot be drawn as an icon is refused with the reason', async () => {
  let cases: [string, string][] = [
    [icon('<rect>'), "expected 'rect' tag"],
    ['<svg viewBox="0 0 24 24"/>', 'no xmlns'],
    [icon('<rect width="40" height="20"/>', '0 0 40 20'), 'it is 40×20'],
    [icon('<text x="4" y="18">R</text>'), 'no fonts'],
  ]
  for (let [svg, why] of cases) {
    let r = await posted(svg)
    assertEquals(r.status, 422)
    assertStringIncludes(await r.text(), why)
  }
  assertEquals((await posted(icon(''), '?size=0')).status, 400)
})
