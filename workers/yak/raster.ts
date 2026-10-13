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

/** The app-relative path an app's icon is drawn from. */
export let ICON_SVG = 'icon.svg'

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
    let r = await env.RASTER.fetch(
      new Request(`https://raster.invalid/?size=${SIZE}`, {
        method: 'POST',
        body: svg,
      }),
    )
    if (r.status == REFUSED) return await r.text()
    if (!r.ok) {
      throw new Error(
        `yak-raster ${r.status}: ${(await r.text()).slice(0, 400)}`,
      )
    }
    return new Uint8Array(await r.arrayBuffer())
  } catch (e) {
    caught(e, { request: 'raster', app })
    return null
  }
}
