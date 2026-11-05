// What a page's head names so it paints without waiting on a chain of sheets or
// on another site. The bundle states the content-made names (sheet-assets.ts);
// without one, in a test or under `wrangler dev`, the sources answer instead.
import { type Host, url } from './host.ts'
import { island, signedIn } from './signed.ts'

declare const YAK_SHEETS: Record<string, string> | undefined

let NAMES = typeof YAK_SHEETS == 'undefined' ? {} : YAK_SHEETS

// The face nearly every page's text is in, asked for before the sheet is parsed.
let FONT = 'nunito-latin.woff2'

/** The head's links for one of the site's sheets, after the reporter
 * (page-report.ts), which runs before any of the page's own scripts so a
 * break in them reaches the tracker. */
export let links = (env: Host, sheet: string, names = NAMES) => {
  let at = (name: string) => url(env, `/${names[name] ?? name}`)
  return `<script src="${at('report.js')}" data-yak-at="${
    url(env, '/')
  }"></script>
<link rel="preload" href="${at(FONT)}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${at(sheet)}">`
}

/** A static page with its source's link swapped for what `links` says, the
 * nav's island beside it, and beside its Sign in the link the island shows a
 * person signed in instead (signed.ts). */
export let sheeted = (html: string, env: Host, names = NAMES) =>
  html.replace(
    /<link rel="stylesheet" href="style\.css"\s*\/?>/,
    () => `${links(env, 'style.css', names)}\n${island}`,
  ).replace(/<a class="Nav_SignIn"[^>]*>Sign in<\/a>/, (a) => a + signedIn)

/** The source behind a content-made address, for one no longer deployed. */
export let named = (path: string) => {
  let [, name, ext] = path.match(/^\/_yak\/(.+)\.[0-9a-f]{10}(\.\w+)$/) ?? []
  return name ? `/${name}${ext}` : null
}
