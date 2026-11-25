// What yak-raster does with a request: an SVG posted in, a PNG `?size=` pixels
// square out (512 when it names none), on white. An icon is opaque because iOS
// fills a transparent one with black. Asked for `?width=&height=` instead, it
// draws a picture of exactly that size, on nothing but what the SVG paints: an
// app's splash, an icon embedded in it as a `data:` PNG (@yaks/platform/splash).
//
// Drawing has no fonts here, so `<text>` would come out as nothing at all: a
// blank icon, and nobody told. An SVG that cannot be drawn as asked (it does not
// parse, it is not square, it has text) is answered 422 with the reason, which
// the kernel hands its author as a refusal (../raster.ts). Anything else that
// goes wrong is this Worker's fault and answers 500.
import { Resvg } from '@resvg/resvg-wasm'

let MAX = 2048
// The largest screen a splash is drawn for is 2868 pixels tall.
let PICTURE = 4096

let refused = (why: string) =>
  new Response(why, {
    status: 422,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })

// The drawing, or the reason there is none. resvg's own words say where a
// parse failed ("the root node was opened but never closed").
let parsed = (svg: string, size: number, icon = true) => {
  // Without the namespace a file is XML that only looks like SVG, to a
  // browser as well, and resvg's answer for it ("the document does not have a
  // root node") would not say so.
  if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(svg)) {
    return 'its <svg> has no xmlns="http://www.w3.org/2000/svg", without ' +
      'which it is not read as SVG'
  }
  if (/<text[\s>/]/.test(svg)) {
    return 'it has <text>, and there are no fonts to draw it with: draw ' +
      'letters as <path> shapes, or leave them out'
  }
  let r
  try {
    r = new Resvg(svg, {
      fitTo: { mode: 'width', value: size },
      ...icon ? { background: 'white' } : {},
    })
  } catch (e) {
    return (e as Error).message
  }
  if (icon && Math.round(r.width) != Math.round(r.height)) {
    let shape = `${r.width}×${r.height}`
    r.free()
    return `it is ${shape}, and an icon is square: give it a square viewBox`
  }
  return r
}

let within = (n: number, max: number) =>
  Number.isInteger(n) && n >= 1 && n <= max

export let draw = async (req: Request): Promise<Response> => {
  let q = new URL(req.url).searchParams
  let picture = q.has('width')
  let size = Number(q.get(picture ? 'width' : 'size') ?? 512)
  let height = Number(q.get('height'))
  if (
    req.method != 'POST' ||
    (picture
      ? !within(size, PICTURE) || !within(height, PICTURE)
      : !within(size, MAX))
  ) {
    return new Response(
      `POST an SVG, ?size= from 1 to ${MAX}, or ?width=&height= to ${PICTURE}`,
      { status: 400 },
    )
  }
  let r = parsed(await req.text(), size, !picture)
  if (typeof r == 'string') return refused(r)
  if (picture && Math.round(r.height) != height) {
    let shape = `${r.width}×${r.height}`
    r.free()
    return refused(`it is ${shape} at that width, not ${size}×${height}`)
  }
  let image = r.render()
  // Copied out of the WebAssembly's memory, which free() hands back.
  let png = new Uint8Array(image.asPng())
  image.free()
  r.free()
  return new Response(png, { headers: { 'content-type': 'image/png' } })
}
