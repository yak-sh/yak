// What a page names so it paints without waiting on a chain of sheets or on
// another site, and so a later page asks for none of it again. The bundle
// states the content-made names (assets.ts `planned`); without one, in a test or
// under `wrangler dev`, the sources answer instead.
import { type Host, url } from '@yaks/platform/host'
import { island, signedIn } from '@yaks/platform/site-nav'
import { DATA_TIMING } from '@yaks/platform/ladder'
import { INTERACTION_PATH, OPEN_PATH } from '@yaks/timing/interaction'
import { EARLY_REPORT } from '@yaks/platform/early-report'
import { openScript } from '@yaks/platform/open-script'
import { opening } from '@yaks/platform/opening'
import { openingHead } from '@yaks/web/opening'
import { importMap } from './page-imports.ts'

declare const YAK_NAMED: Record<string, string> | undefined
declare const YAK_IMPORTS: Record<string, string[]> | undefined

let NAMES = typeof YAK_NAMED == 'undefined' ? {} : YAK_NAMED
let IMPORTS = typeof YAK_IMPORTS == 'undefined' ? {} : YAK_IMPORTS

/** Where a page fetches one of the site's files: its content-made address,
 * which the browser keeps for good, or its source's where none was made. */
export let asset = (
  env: Host,
  name: string,
  names = NAMES,
  base = url(env, '/'),
) => base + (names[name] ?? name)

/** What the page scripts `names` import, preloaded (assets.ts
 * `scriptImports`): a phone fetches it beside the scripts, instead of
 * learning of each file from the one before. Each is at the site's root,
 * where the scripts and the import map name it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let imports = { '_a.js': ['_yak/chunk.A.js', '_yak/_react.1.js'], '_b.js': ['_yak/_react.1.js'] }
 * assertEquals(
 *   preloads(['_a.js', '_b.js', 'away.js'], imports),
 *   '<link rel="modulepreload" href="/_yak/chunk.A.js"><link rel="modulepreload" href="/_yak/_react.1.js">',
 * )
 * ```
 */
export let preloads = (names: Iterable<string>, imports = IMPORTS): string =>
  [...new Set([...names].flatMap((name) => imports[name] ?? []))]
    .map((at) => `<link rel="modulepreload" href="/${at}">`).join('')

/** Start the chat's modules before the parser reaches its transcript. */
export let chatPreloads = (env: Host): string =>
  [
    '_talk.js',
    '_words.js',
    '_page-client.js',
    'follow.js',
    'frames.js',
    'voice.js',
  ].map((name) => `<link rel="modulepreload" href="${asset(env, name)}">`)
    .join('\n') +
  '\n' +
  preloads(['_talk.js', '_talk-views.js', '_updates.js', '_inbox-actions.js'])

/** The store client's content-made name below an app's `api/` (apps.ts
 * `api`), or null where none was made. */
export let client = (names = NAMES) =>
  names['_client.js']?.replace(/^_yak\/_/, '') ?? null

/** The same observer in platform pages and the platform's mounted editors. */
export let interaction = (env: Host, names = NAMES, base?: string) =>
  `<script type="module" src="${
    asset(env, '_interaction.js', names, base)
  }" data-yak-interaction="${
    base ? base + DATA_TIMING : INTERACTION_PATH
  }"></script>`

// The face nearly every page's text is in, asked for before the sheet is parsed.
let FONT = 'nunito-latin.woff2'

/** The head's links for one of the site's sheets, after the reporter
 * (page-report.ts), which runs before any of the page's own scripts so a
 * break in them reaches the tracker, and what the page shows while it opens
 * or when opening fails (@yaks/web/opening), inline before the sheet so it
 * works when no file of the page does, and the site's favicon, which every page
 * wears from here so none goes without it. A page that already wears the
 * reporter (`reported`) is given no second one, which would file each of
 * its breaks twice. */
export let links = (
  env: Host,
  sheet: string,
  names = NAMES,
  base?: string,
  reported = false,
  favicon = true,
) => {
  let at = (name: string) => asset(env, name, names, base)
  let reporter = `<script src="${at('report.js')}" defer data-yak-at="${
    url(env, '/')
  }"></script><script data-yak-early-report>${EARLY_REPORT}</script>\n`
  let timed = base ? base + DATA_TIMING + '?open=1' : OPEN_PATH
  let icon = favicon
    ? `<link rel="icon" href="${
      at('favicon-32.png')
    }" type="image/png" sizes="32x32">`
    : ''
  let opens = openingHead({
    ...opening(at('apple-touch-icon.png'), url(env, '/api/report')),
    retryBlank: base == null,
  })
  return `${reported ? '' : reporter}${opens}${
    reported ? '' : `<script data-yak-open="${timed}">${openScript()}</script>`
  }${interaction(env, names, base)}
${icon}
<link rel="preload" href="${at(FONT)}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${at(sheet)}">`
}

// The platform's scripts an app's page is woven (page-script.ts), the
// reporter first: the home app's pages come with them (site.ts `HOME`).
let WOVEN = /<script data-yak-at="[^"]*" data-yak-version="/
let SHEET = /<link rel="stylesheet" href="([\w-]+\.css)"\s*\/?>/

// A `src` or `href` naming a file at the site's root.
let NAMING = /\b(src|href)=(["'])\/?([\w.-]+)\2/g

/** A static page with its source's link swapped for what `links` says, the
 * nav's island beside it, beside its Sign in the link the island shows a
 * person signed in instead, and every other file of the site it
 * names at its content-made address. A page the home app served wears the
 * reporter already (`links`), and its island draws the pencil for a person
 * who may write it. The response preloads the sheet before the HTML arrives. */
export let sheeted = (html: string, env: Host, names = NAMES) => {
  let sheet = html.match(SHEET)?.[1]
  let woven = WOVEN.test(html)
  let preload = sheet
    ? `<${asset(env, sheet, names)}>; rel=preload; as=style`
    : undefined
  let body = html.replace(
    /<head>/i,
    (head) => head + importMap((name) => asset(env, name, names)),
  )
    .replace(/<body([^>]*)>/i, (_, attrs: string) => {
      let classes = attrs.match(/\sclass=(?:"[^"]*"|'[^']*')/)?.[0] ?? ''
      return `<body${attrs.replace(classes, '')}><div data-site-home${classes}>`
    })
    .replace(/<\/body>/i, '</div></body>')
    .replace(
      SHEET,
      (_, name: string) =>
        `${links(env, name, names, undefined, woven)}\n${
          island(
            asset(env, '_ready.js', names),
            woven ? asset(env, 'edit.js', names) : undefined,
          )
        }`,
    ).replace(
      /<a\b[^>]*\sclass="[^"]*\bNav_SignIn\b[^"]*"[^>]*>Sign in<\/a>/,
      (a) => a + signedIn,
    )
    .replace(
      NAMING,
      (whole, attr, quote, name) =>
        names[name]
          ? `${attr}=${quote}${asset(env, name, names)}${quote}`
          : whole,
    )
  return { body, preload }
}

/** The source behind a content-made address, for one no longer deployed. */
export let named = (path: string) => {
  let [, name, ext] = path.match(/^\/_yak\/(.+)\.[0-9a-f]{10}(\.\w+)$/) ?? []
  return name ? `/${name}${ext}` : null
}

/** Serve the current flattened stylesheet when a page names one from an
 * earlier deploy. Its relative URLs still resolve from the same directory.
 * The browser must not keep these bytes under the old fingerprint. */
export let assetFile = async (
  req: Request,
  files: { fetch(req: Request): Promise<Response> },
  names = NAMES,
): Promise<Response> => {
  let at = new URL(req.url)
  let page = await files.fetch(req)
  if (page.status != 404) return page
  let was = named(at.pathname)
  let current = was?.endsWith('.css') && names[was.slice(1)]
  if (!current || at.pathname == '/' + current) return page
  at.pathname = '/' + current
  let sheet = await files.fetch(new Request(at, req))
  if (!sheet.ok) {
    await sheet.body?.cancel()
    return page
  }
  await page.body?.cancel()
  let grown = new Response(sheet.body, sheet)
  grown.headers.set('cache-control', 'no-store')
  return grown
}
