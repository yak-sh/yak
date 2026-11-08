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
import type { Declared } from './operator-persona.ts'

/** The app-relative path an app's icon is drawn from. */
export let ICON_SVG = 'icon.svg'

// What an app's icon is to the Operator, declared beside the code that draws
// it (files.ts `icon`) and falls back to the space's logo or the platform's
// (apps.ts `unwritten`).
// The base persona contains it (operator-persona.ts).
export let iconic: Declared = {
  key: 'icon',
  title: "An app's icon",
  body:
    "The picture beside an app's name in your page's sidebar, the person's list of apps and a home screen is the app's icon. It is served from the app's icon.png, or drawn from its icon.svg, and an app with neither wears its space's logo, or the platform's default yak in a space without one. To set one, use app_files: op: fetch with path icon.png and the URL of a PNG, or write an icon.svg (a square viewBox, no <text>); then app_deploy, since the icon shows once deployed. A space has a logo of its own too, which stands in for its first letter wherever the space shows (the space switcher, the list of spaces, your chat) and is the icon of every app in it without one: when the person asks for the space's icon or logo, or for one picture on all their apps, set it with space_set: logo with the attachment id of a picture they sent (a PNG, JPEG, WebP or GIF up to 1 MB), or logo_base64 with a picture's bytes; logo \"none\" takes it off. Only the space's owner may set it. A logo can also mean a picture in the app's own pages: work out from the person's words which they mean, and ask when you can't tell.",
}

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
