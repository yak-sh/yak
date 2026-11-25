// @yaks/ui's own guide at the apex (kept-page.ts `UI_GUIDE`): every kit,
// UX kit, theme and skin yaks.app installs, drawn by the page the box serves
// at `/ui` (@yaks/ui/routes `page`). A Worker reads no file, so the build
// makes its sheets (sheet-assets.ts `kit`), one of each theme's tokens and one
// of each skin's parts, and the page links the two it is dressed in.
import type { Host } from '@yaks/platform/host'
import { gather } from '@yaks/ui/contributions'
import { dressed, page } from '@yaks/ui/routes'
import * as base from '@yaks/ui/ui'
import { ux } from '@yaks/ux/ui'
import { asset } from './sheets.ts'

/** What the guide shows: the ./ui facets of the packages yaks.app wears. */
export let UI = gather([base, { ux }])

let { allThemes, allSkins } = dressed(undefined, undefined, UI)

/** The sheet of a theme's tokens. */
export let themeSheet = (theme: string) => `_guide.theme.${theme}.css`

/** The sheet of the parts as a skin draws them (`base`, the kit's own). */
export let skinSheet = (skin: string) => `_guide.skin.${skin}.css`

/** Every theme and skin the guide offers, by name. */
export let THEMES = Object.keys(allThemes)
export let SKINS = ['base', ...Object.keys(allSkins)]

/** Every sheet the guide links. */
export let SHEETS = [...THEMES.map(themeSheet), ...SKINS.map(skinSheet)]

/** The guide, dressed as the query asks. Public, and kept from search like
 * the site's style guide. */
export let answer = async (req: Request, env: Host): Promise<Response> => {
  let q = new URL(req.url).searchParams
  let html = await page(
    q.get('theme') ?? undefined,
    q.get('scheme') ?? undefined,
    q.get('skin') ?? undefined,
    UI,
    (_, theme, skin) =>
      [themeSheet(theme), skinSheet(skin)].map((name) =>
        `<link rel="stylesheet" href="${asset(env, name)}">`
      ).join(''),
  )
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-robots-tag': 'noindex, follow',
    },
  })
}
