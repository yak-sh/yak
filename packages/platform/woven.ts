// What a host weaves into an app's page as it serves it, as pure text: the
// `<base href>` its relative URLs resolve against, the tags a home screen
// needs and the manifest they link, the platform's own scripts inline with
// the hashes a page's policy admits them by, and what the badge on a free
// space's page opens. yaks.app weaves them at its gateway (workers/yak
// apps.ts `woven`), and the box's `yak/files` facet into the release pages it
// serves (./files-routes.ts).
import { holding } from '@yaks/blob'
import { esc } from './escape.ts'
import { type Host, url } from './host.ts'
import { free, type Metered } from './meter.ts'
import { MANIFEST, pageAt } from './routes.ts'

/** Where a page resolves its relative URLs from, as anywhere on the web: its
 * own folder under the mount `at`, so about/index.html's `../style.css` is the
 * app's. A route, and the 404 page at any depth, answer with a page at the
 * root, so their base is the mount. An app whose folder pages were written
 * against the root base keeps it (`rooted`). `file` is the path that
 * answered, from the served folder.
 *
 * ```ts
 * import { baseOf } from '@yaks/platform/woven'
 * import { equal } from '@yaks/testing'
 * equal(baseOf('/cookbook/', 'docs/index.html', false), '/cookbook/docs/')
 * equal(baseOf('/cookbook/', 'about.html', false), '/cookbook/')
 * equal(baseOf('/cookbook/', '404.html', false), '/cookbook/')
 * equal(baseOf('/cookbook/', 'admin/index.html', true), '/cookbook/')
 * ```
 */
export let baseOf = (at: string, file: string, rooted: boolean): string =>
  at + (rooted ? '' : file.slice(0, file.lastIndexOf('/') + 1))

/** Whether a page carries a `<base href>` of its own. */
export let hasBase = (html: string): boolean =>
  /<base[\s>][^>]*\bhref\b/i.test(html)

/** `tag` where the parser will read it: inside the head if the page has one,
 * else after the doctype, which must stay the document's first thing or the
 * browser reads the whole page in quirks mode. A page with neither gets it in
 * front of everything. The base, the links and the scripts are placed by
 * this one rule. */
export let intoHead = (page: string, tag: string): string => {
  let head = /<head[^>]*>/i.exec(page)
  if (head) return page.replace(head[0], `${head[0]}${tag}`)
  let doctype = /^\s*<!doctype[^>]*>/i.exec(page)
  return doctype ? page.replace(doctype[0], `${doctype[0]}${tag}`) : tag + page
}

// An app's own files must not name the app. The code is copied under
// whatever address the installer took it at (`app_install`), so a page
// written with `/chores/api/client.js` in it is a 404 the moment the copy
// lands at `/chore-chart/` — which is how a shared app rendered as bare HTML,
// no stylesheet and no script, and nothing said so (C-32905 item 1). Every
// page a host serves is given a `<base href>` at the app's own address
// instead, so `./api/client.js` and `./style.css` resolve from wherever the
// page is opened, pretty paths included. An absolute `/<app>/…` a page
// already carries is untouched — a base moves relative URLs only.
//
// A page carrying its own `<base>` keeps it, and is given none: the first in
// tree order is the document's, and an author who wrote one meant it.
// yaks.app's declared.ts hands a view to an MCP host by the same rule, at
// that app's absolute address.
/** `page` with its base at `href`, unless it names its own. */
export let based = (href: string, page: string): string =>
  hasBase(page) ? page : intoHead(page, `<base href="${href}">`)

// Whether the page already names a tag — one token of the attribute that
// says what it IS, so `rel="shortcut icon"` and `rel="apple-touch-icon-
// precomposed"` both count as the author having answered, and a `<meta
// name="theme-color">` is asked the same way a `<link rel="manifest">` is:
// one test, parameterised on the tag and the attribute that names it.
let declares = (page: string, tag: string, attr: string, value: string) =>
  new RegExp(
    `<${tag}\\b[^>]*\\b${attr}\\s*=\\s*['"]?[^'">]*\\b${value}\\b`,
    'i',
  ).test(page)

// The platform's own page background in its two linen schemes.
export let PLATFORM_BACKGROUND = '#fdf7ee'
export let PLATFORM_DARK_BACKGROUND = '#2b231f'

/** An app's own colours, both CSS, either half null where its owner set
 * none. */
export type Theme = {
  themeColor: string | null
  backgroundColor: string | null
}
/** An app as its colours are read off it. */
export type Themed = { theme?: Theme | null }

// Stored colours also arrive through graph_apply. Only insert values safe
// for both CSS and an HTML attribute.
let CSS_COLOR = /^[#a-zA-Z0-9(),.%\s-]{1,64}$/
let safeColor = (v: string | null | undefined) =>
  v && CSS_COLOR.test(v) ? v : undefined

/** Colours resolved by the installing page's browser, encoded as sRGB. */
export let paintedColors = (url: URL): Theme => {
  let color = (name: string) => {
    let value = url.searchParams.get(name)
    return value && /^[a-f0-9]{6}$/i.test(value) ? '#' + value : null
  }
  return {
    backgroundColor: color('background_color'),
    themeColor: color('theme_color'),
  }
}

// The tags an app added to a home screen needs, and almost no app writes
// (T-34493, T-33055). iOS takes its icon from `<link rel="apple-touch-icon">`
// and nowhere else — Apple's *Configuring Web Applications*: a page names
// its icon there, 180×180 for current displays, `sizes` only when it offers
// several, and the smallest icon larger than the device wants is the one
// scaled, so one square file serves every device. Every other platform reads
// the manifest's `icons` instead, at the address the manifest link names.
// `mobile-web-app-capable` is the standard word for the same (Chrome warns
// on the Apple one alone), and the Apple one stays for iOS Safari.
// `apple-mobile-web-app-capable` is what makes iOS open the page as a window
// rather than a browser tab at all, and `apple-mobile-web-app-status-bar-
// style` is the one Apple still reads past `theme-color` for its own status
// bar. A page written here has none of it unless its agent thought of all
// five, so an app somebody kept on their phone came out blank or grey —
// owner, 2026-09-06: "the app's PWAs aren't getting icons (i tested iOS),
// even when the site itself has an image icon."
//
// So a page is given every tag it did not write, at the app's own root: the
// icon, the manifest (`MANIFEST`, `manifesting` below), the chrome colour,
// and the two Apple words. Each is decided on its own — a page naming one
// gets the other four still — and what the page declares is never touched,
// because a second answer beside the author's own is a second answer to a
// question they already answered. The one exception is how the browser
// fetches a manifest (`credentialed` below), which no author chose.
//
// The hrefs are absolute at the mount, like the reporter's, rather than
// relative: a page carrying its own `<base>` keeps it (`based` above), and a
// relative `icon.png` would then resolve against the author's base instead of
// against the app.
/** `page` mounted at `at` with the home-screen tags it did not write, in
 * `app`'s colours; its manifest fetched with the person's `cookies`, which a
 * store that answers anyone has no need of. */
export let pinned = (
  at: string,
  page: string,
  app: Themed,
  cookies = true,
  // The icon's address, named by what draws it where the caller knows
  // (@yaks/platform/routes `iconAt`), so a browser keeps it.
  icon = `${at}icon.png`,
): string => {
  let tags = pinTags(
    at,
    (tag, attr, value) => declares(page, tag, attr, value),
    app,
    cookies,
    icon,
  )
  return credentialed(tags ? intoHead(page, tags) : page, cookies)
}

/** The missing install tags, given the declarations the host saw. */
let pinTags = (
  at: string,
  has: (tag: string, attr: string, value: string) => boolean,
  app: Themed,
  cookies: boolean,
  icon: string,
) => {
  let theme = safeColor(app.theme?.themeColor)
  return (has('link', 'rel', 'apple-touch-icon')
    ? ''
    : `<link rel="apple-touch-icon" href="${icon}">`) +
    (has('link', 'rel', 'manifest')
      ? ''
      : `<link rel="manifest" href="${at}${MANIFEST}" ` +
        `crossorigin="${
          cookies ? 'use-credentials' : 'anonymous'
        }" data-yak-manifest>`) +
    (has('meta', 'name', 'theme-color')
      ? ''
      : theme
      ? `<meta name="theme-color" content="${theme}">`
      : '<meta data-yak-theme-color>') +
    (has('meta', 'name', 'mobile-web-app-capable')
      ? ''
      : '<meta name="mobile-web-app-capable" content="yes">') +
    (has('meta', 'name', 'apple-mobile-web-app-capable')
      ? ''
      : '<meta name="apple-mobile-web-app-capable" content="yes">') +
    (has('meta', 'name', 'apple-mobile-web-app-status-bar-style')
      ? ''
      : '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">')
}

// A browser fetches the manifest a page links without the person's cookies
// unless the link says `crossorigin="use-credentials"`, and the door of an
// app that is not public answers nobody without them: it sends the fetch to
// sign in, on the platform's own origin, where it fails. So every manifest
// link on the app's own origin is given that attribute, the platform's and
// the author's alike, and on a public app it costs nothing. A link naming a
// `crossorigin` of its own keeps it, and one to another origin is left as
// written, since that origin admits credentials only if it says so.
let elsewhere = /^\s*(?:[a-z][a-z\d+.-]*:|\/\/)/i
let manifestHere = (href: string) => !elsewhere.test(href)
let hrefOf = (tag: string) =>
  /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    ?.slice(1).find((v) => v != null) ?? ''
let credentialed = (page: string, cookies: boolean) =>
  page.replace(
    /<link\b[^>]*>/gi,
    (tag) =>
      declares(tag, 'link', 'rel', 'manifest') &&
        !/\scrossorigin\b/i.test(tag) && manifestHere(hrefOf(tag))
        ? tag.replace(
          /^<link/i,
          `<link crossorigin="${cookies ? 'use-credentials' : 'anonymous'}"`,
        )
        : tag,
  )

/** What an app's manifest says when the app wrote none: its name, its own
 * root as the scope a standalone window stays inside, the icon at the two
 * sizes an installer looks for, and the colours saved by the app or read
 * from its page. The same icon file at both sizes. */
export let manifesting = (
  app: Themed & { title?: string | null; slug: string },
  at: string,
  icon = `${at}icon.png`,
  painted?: Theme,
) => ({
  name: app.title || app.slug,
  short_name: app.title || app.slug,
  start_url: at,
  scope: at,
  display: 'standalone',
  ...manifestColors(app, painted),
  icons: ['512x512', '192x192'].map((sizes) => ({
    src: icon,
    type: 'image/png',
    sizes,
  })),
})

/** Defaults for the colour fields a manifest leaves out. */
export let manifestColors = (app: Themed, painted?: Theme) => ({
  background_color: safeColor(app.theme?.backgroundColor) ??
    painted?.backgroundColor ?? undefined,
  theme_color: safeColor(app.theme?.themeColor) ??
    painted?.themeColor ?? undefined,
})

// A page that uses the platform's manifest link can ship manifest fields of
// its own. Use the painted colours only for the fields its file omits.
export let paintedManifest = async (
  req: Request,
  page: Response,
  app: Themed,
) => {
  let painted = paintedColors(new URL(req.url))
  if (
    (!painted.backgroundColor && !painted.themeColor) ||
    page.status != 200 || !page.body
  ) return page
  let contents = await holding({ stream: page.body }, 64 * 1024)
  if (!(contents instanceof Uint8Array)) {
    return new Response(contents.stream, page)
  }
  let original = new Response(contents, page)
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(contents))
  } catch {
    return original
  }
  if (!value || typeof value != 'object' || Array.isArray(value)) {
    return original
  }
  let defaults = Object.entries(manifestColors(app, painted)).filter((
    [key, color],
  ) => color && !Object.hasOwn(value, key))
  if (!defaults.length) return original
  let body = JSON.stringify({ ...value, ...Object.fromEntries(defaults) })
  let headers = new Headers(page.headers)
  for (let name of ['content-length', 'content-encoding', 'etag']) {
    headers.delete(name)
  }
  return new Response(body, { headers })
}

type HTML = { html: boolean }
type InstallElement = {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  before(s: string, o: HTML): void
  onEndTag(fn: (end: { before(s: string, o: HTML): void }) => void): void
}
type InstallRewriter = {
  on(
    selector: string,
    handlers: { element(el: InstallElement): void },
  ): InstallRewriter
  onDocument(
    handlers: { end(end: { append(s: string, o: HTML): void }): void },
  ): InstallRewriter
  transform(page: Response): Response
}

// Worker pages can stream. Collect declarations while the head passes and
// add the missing tags at its end, before any of the page's body is read.
export let pinnedPage = (
  page: Response,
  at: string,
  app: Themed,
  icon: string,
  cookies: boolean,
  rewrite: InstallRewriter,
) => {
  let words = new Set<string>()
  let done = false
  let tags = () => {
    if (done) return ''
    done = true
    return pinTags(
      at,
      (tag, _, value) => words.has(tag + ':' + value),
      app,
      cookies,
      icon,
    )
  }
  rewrite
    .on('link[rel]', {
      element: (link) => {
        let rel = link.getAttribute('rel')!.toLowerCase().split(/\s+/)
        for (let word of rel) {
          words.add('link:' + word)
          if (word == 'apple-touch-icon-precomposed') {
            words.add('link:apple-touch-icon')
          }
        }
        if (
          rel.includes('manifest') &&
          link.getAttribute('crossorigin') == null &&
          manifestHere(link.getAttribute('href') ?? '')
        ) {
          link.setAttribute(
            'crossorigin',
            cookies ? 'use-credentials' : 'anonymous',
          )
        }
      },
    })
    .on('meta[data-yak-theme-color]', {
      element: () => words.add('meta:theme-color'),
    })
    .on('meta[name]', {
      element: (el) =>
        words.add('meta:' + el.getAttribute('name')!.toLowerCase()),
    })
    .on('head', {
      element: (el) => el.onEndTag((end) => end.before(tags(), { html: true })),
    })
    .on('body', { element: (el) => el.before(tags(), { html: true }) })
    .onDocument({ end: (end) => end.append(tags(), { html: true }) })
  let headers = new Headers(page.headers)
  headers.delete('content-length')
  headers.delete('etag')
  return rewrite.transform(
    new Response(page.body, {
      status: page.status,
      statusText: page.statusText,
      headers,
    }),
  )
}

// The platform's own scripts are woven into a page's text rather than named
// by a `src`. Each must run before the page's own code, which made them
// blocking scripts, and a blocking script is a round trip the parser waits on
// before anything paints, on every load, warm or cold. Inline, they cost the
// page a few kilobytes and no request.
//
// Each tag says where its app is mounted for this browser (`data-yak-at`) and
// which release the page is (`data-yak-version`): the scripts read their doors
// off the first, and the client sends the second with every request.
// Attributes are not hashed, so a script's text and a policy's hash of it are
// the same on every page.

/** A script as a page wears it inline, and the hash a policy admits it by. */
export type Script = { text: string; hash: string }

/** `source` as a page wears it inline. `</script` inside the text would end
 * the element early; `<\/` is the same string to JavaScript.
 *
 * ```ts
 * import { inline } from '@yaks/platform/woven'
 * import { equal } from '@yaks/testing'
 * equal((await inline('"</script>"')).text, '"<\\/script>"')
 * ```
 */
export let inline = async (source: string): Promise<Script> => {
  let text = source.replace(/<\/(script)/gi, '<\\/$1')
  let sum = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return {
    text,
    hash: `'sha256-${btoa(String.fromCharCode(...new Uint8Array(sum)))}'`,
  }
}

/** The tags a page mounted at `at`, of release `version`, wears for `worn`,
 * each script with the attributes it reads beside the two every one does,
 * and the hashes a policy needs to admit them (`admitted`).
 *
 * ```ts
 * import { inline, tagged } from '@yaks/platform/woven'
 * import { equal } from '@yaks/testing'
 * let s = await inline('go()')
 * equal(
 *   tagged('/a/', 3, [[s, { 'data-yak-edit': 'x"y' }]]),
 *   {
 *     tags: '<script data-yak-at="/a/" data-yak-version="3" ' +
 *       'data-yak-edit="x&quot;y">go()</script>',
 *     hashes: [s.hash],
 *   },
 * )
 * ```
 */
export let tagged = (
  at: string,
  version: number,
  worn: [Script, Record<string, string>?][],
) => ({
  tags: worn.map(([{ text }, attrs = {}]) =>
    `<script ${
      Object.entries({
        'data-yak-at': at,
        'data-yak-version': String(version),
        ...attrs,
      }).map(([name, value]) => `${name}="${esc(value)}"`).join(' ')
    }>${text}</script>`
  ).join(''),
  hashes: worn.map(([{ hash }]) => hash),
})

// One directive's sources with the hashes added, unless adding them would
// change what the author allowed: `'unsafe-inline'` stops counting once a
// hash is present, and `'none'` means no script at all.
let admit = (directive: string, hashes: string[]) => {
  let words = directive.split(/\s+/)
  let inline = words.includes("'unsafe-inline'") &&
    !words.some((w) => /^'(sha\d+|nonce)-/.test(w))
  return inline || words.includes("'none'")
    ? directive
    : [...words, ...hashes].join(' ')
}

/**
 * A page with a Content-Security-Policy of its own may refuse inline scripts,
 * so its policy is given the scripts' hashes, which lets these run and
 * nothing else. Each comma-separated policy is enforced on its own, so each
 * is given the hashes in whichever directive governs a `<script>` element.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { admitted } from '@yaks/platform/woven'
 * let h = ["'sha256-a'"]
 * assertEquals(
 *   admitted("default-src 'self'; script-src 'self'", h),
 *   "default-src 'self'; script-src 'self' 'sha256-a'",
 * )
 * assertEquals(
 *   admitted("default-src 'self'", h),
 *   "default-src 'self'; script-src 'self' 'sha256-a'",
 * )
 * assertEquals(admitted("img-src 'self'", h), "img-src 'self'")
 * assertEquals(
 *   admitted("script-src 'self' 'unsafe-inline'", h),
 *   "script-src 'self' 'unsafe-inline'",
 * )
 * assertEquals(
 *   admitted("script-src 'none', script-src-elem 'self'", h),
 *   "script-src 'none', script-src-elem 'self' 'sha256-a'",
 * )
 * ```
 */
export let admitted = (policy: string, hashes: string[]): string =>
  !hashes.length ? policy : policy.split(',').map((one) => {
    let parts = one.split(';').map((d) => d.trim()).filter(Boolean)
    let named = (name: string) =>
      parts.findIndex((d) => d.split(/\s+/)[0].toLowerCase() == name)
    let at = named('script-src-elem')
    if (at < 0) at = named('script-src')
    if (at >= 0) parts[at] = admit(parts[at], hashes)
    else {
      let fallback = named('default-src')
      if (fallback < 0) return one.trim()
      let copy = parts[fallback].replace(/^\S+/, 'script-src')
      let made = admit(copy, hashes)
      if (made == copy) return one.trim()
      parts.push(made)
    }
    return parts.join('; ')
  }).join(', ')

/** An app as its badge reads it: the name it was published under, and the
 * site a preview of it was rebuilt from. */
export type Badged = {
  eid?: string
  published?: { name?: string | null } | null
  preview?: { site: string } | null
}

/** What the badge on an app's page opens, or null for no badge, which is a
 * paid plan's. A published app's badge opens its own page on the platform
 * (`pageAt`), where whoever followed it can open the app and make their own
 * copy; an app that is not published opens the platform's front page. The
 * link names the app (`?app=`), so a sign-up it leads to says which app's
 * badge brought them (workers/yak arrival.ts).
 *
 * ```ts
 * import { badgeOf } from '@yaks/platform/woven'
 * import { equal } from '@yaks/testing'
 * let space = { tier: null }
 * equal(badgeOf(space, { published: { name: 'recipes' } }, {}), 'https://yaks.app/apps/recipes')
 * equal(badgeOf(space, {}, {}), 'https://yaks.app/')
 * let eid = '6f1c1b3e-0b5e-4c4a-9d1a-2b8f8c1d7e10'
 * equal(badgeOf(space, { eid }, {}), `https://yaks.app/?app=${eid}`)
 * equal(badgeOf({ ...space, tier: 'plus' }, {}, {}), null)
 * ```
 */
export let badgeOf = (
  space: Pick<Metered, 'tier'>,
  app: Badged,
  env: Host,
): string | null => {
  if (!free(space)) return null
  let to = app.published?.name ? pageAt(app.published.name, env) : url(env, '/')
  return app.eid ? `${to}?app=${encodeURIComponent(app.eid)}` : to
}

/** What a paid space's line "Website by yaks.app" opens, or null where its
 * owner has not turned it on (`byline`) or the space is on the free plan,
 * whose badge it never wears beside. It opens yaks.app's page for
 * organizations, naming the app (`?app=`), as a badge's link does, so a
 * follow and a sign-up it leads to say which app's line it was.
 *
 * ```ts
 * import { bylineOf } from '@yaks/platform/woven'
 * import { equal } from '@yaks/testing'
 * let eid = '6f1c1b3e-0b5e-4c4a-9d1a-2b8f8c1d7e10'
 * equal(bylineOf({ tier: 'pro', byline: true }, { eid }, {}), `https://yaks.app/organizations?app=${eid}`)
 * equal(bylineOf({ tier: 'pro' }, { eid }, {}), null)
 * equal(bylineOf({ tier: null, byline: true }, { eid }, {}), null)
 * ```
 */
export let bylineOf = (
  space: Pick<Metered, 'tier'> & { byline?: boolean },
  app: Badged,
  env: Host,
): string | null => {
  if (free(space) || !space.byline) return null
  let to = url(env, '/organizations')
  return app.eid ? `${to}?app=${encodeURIComponent(app.eid)}` : to
}

/** The badge and what it says of a site's preview (workers/yak newcomer.ts
 * `previewing`): every plan's preview wears it, saying whose site it is
 * not. A paid space's page whose owner chose the line (`bylineOf`) wears it,
 * drawn by the badge's script as a line at its foot (`byline`). */
/// badged({ tier: 'plus' }, { preview: { site: 'https://www.bakery.example/' } }, {}) -> { badge: 'https://yaks.app/', preview: 'bakery.example' }
/// badged({ tier: 'plus' }, {}, {}) -> { badge: null }
/// badged({ tier: 'plus', byline: true }, {}, {}) -> { badge: 'https://yaks.app/organizations', byline: true }
export let badged = (
  space: Pick<Metered, 'tier'> & { byline?: boolean },
  app: Badged,
  env: Host,
): { badge: string | null; preview?: string | null; byline?: boolean } => {
  let preview = app.preview
    ? URL.parse(app.preview.site)?.hostname.replace(/^www\./, '') ?? null
    : null
  if (preview) {
    return { badge: badgeOf(space, app, env) ?? url(env, '/'), preview }
  }
  let line = bylineOf(space, app, env)
  return line
    ? { badge: line, byline: true }
    : { badge: badgeOf(space, app, env) }
}
