// An app's icon, drawn from the SVG its agent wrote (T-123684). A chat model
// writes SVG as text, and writes it well; a PNG's bytes it cannot write at all,
// and iOS reads only a PNG. So an icon.svg beside index.html is enough: where
// the app wrote no icon.png, the files door answers that address with this
// drawing of its icon.svg (files.ts), and app_files has the icon.svg drawn when
// it is written, so one that cannot be an icon is refused while its author is
// there to hear why (tools.ts `wrote`).
//
// The drawing is yak-raster's (raster/), the Worker behind the RASTER binding.
import type { Env } from './env.ts'
import { caught } from './defects.ts'

export { ICON_SVG } from '@yaks/platform/app-icon'

// The one size drawn: the manifest names the icon at 512 and 192, and iOS
// scales the smallest icon larger than it wants (apps.ts `manifesting`).
let SIZE = 512

// What yak-raster answers for an SVG it cannot draw as asked (raster/draw.ts).
let REFUSED = 422

/**
 * The PNG yak-raster draws of `svg`; the reason it cannot be an icon, as a
 * clause, when the SVG is at fault; or null where there is no drawing for a
 * reason of ours: no RASTER bound (a test run, `wrangler dev`), or a drawing
 * that failed, which is reported.
 */
export let drawn = async (
  env: Env,
  svg: string,
  app: string,
): Promise<Uint8Array<ArrayBuffer> | string | null> => {
  if (!env.RASTER) return null
  try {
    let r = await rastered(env, `size=${SIZE}`, svg)
    if (r.status == REFUSED) return await r.text()
    return await pngOf(r)
  } catch (e) {
    caught(e, { request: 'raster', app })
    return null
  }
}

/** The PNG yak-raster draws of `svg` at `width` by `height` pixels, an
 * app's splash (@yaks/platform/splash). Its SVG is the platform's, so a
 * refusal is ours, and thrown like any failure for the effect drawing it to
 * report and retry. */
export let pictured = async (
  env: Env,
  svg: string,
  width: number,
  height: number,
): Promise<Uint8Array<ArrayBuffer>> => {
  if (!env.RASTER) throw new Error('yak-raster is not bound')
  return pngOf(await rastered(env, `width=${width}&height=${height}`, svg))
}

// A drawing takes under a second; one that takes a minute is stuck, and
// fails rather than holding its caller.
let PATIENCE = 60_000

let rastered = (env: Env, query: string, svg: string) =>
  env.RASTER!.fetch(
    new Request(`https://raster.invalid/?${query}`, {
      method: 'POST',
      body: svg,
      signal: AbortSignal.timeout(PATIENCE),
    }),
  )

let pngOf = async (r: Response) => {
  if (!r.ok) {
    throw new Error(`yak-raster ${r.status}: ${(await r.text()).slice(0, 400)}`)
  }
  return new Uint8Array(await r.arrayBuffer())
}
