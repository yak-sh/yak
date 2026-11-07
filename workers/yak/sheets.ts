// What a page names so it paints without waiting on a chain of sheets or on
// another site, and so a later page asks for none of it again. The bundle
// states the content-made names (sheet-assets.ts); without one, in a test or
// under `wrangler dev`, the sources answer instead.
import { type Host, url } from './host.ts'
import { island, signedIn } from './signed.ts'

declare const YAK_NAMED: Record<string, string> | undefined

let NAMES = typeof YAK_NAMED == 'undefined' ? {} : YAK_NAMED

/** Where a page fetches one of the site's files: its content-made address,
 * which the browser keeps for good, or its source's where none was made. */
export let asset = (env: Host, name: string, names = NAMES) =>
  url(env, `/${names[name] ?? name}`)

// The face nearly every page's text is in, asked for before the sheet is parsed.
let FONT = 'nunito-latin.woff2'

/** The head's links for one of the site's sheets, after the reporter
 * (page-report.ts), which runs before any of the page's own scripts so a
 * break in them reaches the tracker, and the site's favicon, which every page
 * wears from here so none goes without it. */
export let links = (env: Host, sheet: string, names = NAMES) => {
  let at = (name: string) => asset(env, name, names)
  return `<script src="${at('report.js')}" data-yak-at="${
    url(env, '/')
  }"></script>
<link rel="icon" href="${at('favicon-32.png')}" type="image/png" sizes="32x32">
<link rel="preload" href="${at(FONT)}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${at(sheet)}">`
}

// A `src` or `href` naming a file at the site's root.
let NAMING = /\b(src|href)=(["'])\/?([\w.-]+)\2/g

/** A static page with its source's link swapped for what `links` says, the
 * nav's island beside it, beside its Sign in the link the island shows a
 * person signed in instead (signed.ts), and every other file of the site it
 * names at its content-made address. */
export let sheeted = (html: string, env: Host, names = NAMES) =>
  html.replace(
    /<link rel="stylesheet" href="style\.css"\s*\/?>/,
    () => `${links(env, 'style.css', names)}\n${island}`,
  ).replace(/<a class="Nav_SignIn"[^>]*>Sign in<\/a>/, (a) => a + signedIn)
    .replace(NAMING, (whole, attr, quote, name) =>
      names[name]
        ? `${attr}=${quote}${asset(env, name, names)}${quote}`
        : whole)

/** The source behind a content-made address, for one no longer deployed. */
export let named = (path: string) => {
  let [, name, ext] = path.match(/^\/_yak\/(.+)\.[0-9a-f]{10}(\.\w+)$/) ?? []
  return name ? `/${name}${ext}` : null
}
