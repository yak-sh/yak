/**
 * The splash an installed app shows while it opens: its icon centred on its
 * own background, drawn once for every screen an iPhone or iPad has, light
 * and, where the app has one, dark. iOS shows nothing of a page until it has
 * painted unless the page names one of these per screen, as
 * `<link rel="apple-touch-startup-image">`; Android draws its own from the
 * manifest's icon, name and background colour.
 *
 * The mark sits where the platform's opening screen (@yaks/web/opening) puts
 * it, at its size and corner, so the splash gives way to that screen, and to
 * the page, without a jump.
 *
 * Everything here is pure: what to draw, as SVG, and the tags that name it.
 * The drawing happens once per release whose icon or colours changed
 * (`ensureSplash`), never on a request.
 *
 * @module
 */
import { esc } from './escape.ts'
import { declarationsPrefix } from './file-root.ts'
import { MARK } from './opening.ts'

/** A screen as CSS reads it: its width and height in portrait, in points,
 * and how many pixels a point is. */
type Screen = readonly [width: number, height: number, ratio: number]

// Every iPhone and iPad screen that runs a current iOS. A device whose size
// is missing here opens on a blank screen, as every app did before.
export let SCREENS: readonly Screen[] = [
  [440, 956, 3], // iPhone 16 Pro Max, 17 Pro Max
  [402, 874, 3], // iPhone 16 Pro, 17, 17 Pro
  [420, 912, 3], // iPhone Air
  [430, 932, 3], // iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [393, 852, 3], // iPhone 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // iPhone 12 Pro Max, 13 Pro Max, 14 Plus
  [390, 844, 3], // iPhone 12, 13, 14, 16e
  [375, 812, 3], // iPhone X, XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 3], // iPhone XS Max, 11 Pro Max
  [414, 896, 2], // iPhone XR, 11
  [414, 736, 3], // iPhone 8 Plus
  [375, 667, 2], // iPhone 8, SE
  [1032, 1376, 2], // iPad Pro 13″
  [1024, 1366, 2], // iPad Pro 12.9″, iPad Air 13″
  [834, 1210, 2], // iPad Pro 11″ (M4)
  [834, 1194, 2], // iPad Pro 11″
  [820, 1180, 2], // iPad Air 10.9″, iPad (10th)
  [834, 1112, 2], // iPad Air 10.5″
  [810, 1080, 2], // iPad 10.2″
  [744, 1133, 2], // iPad mini (6th, 7th)
  [768, 1024, 2], // iPad mini 5, iPad 9.7″
]

/** An app's background in its two schemes: dark only where it has one that
 * differs. Both `#rrggbb`. */
export type Palette = { light: string; dark: string | null }

/** One image of the set: its file's name, its size in pixels, how many
 * pixels a point is, the media query that picks it, and its background. */
export type Splash = {
  name: string
  width: number
  height: number
  ratio: number
  media: string
  background: string
}

/** Every image a palette's set holds, light first.
 *
 * ```ts
 * import { splashes } from '@yaks/platform/splash'
 * import { equal } from '@yaks/testing'
 * let set = splashes({ light: '#ffffff', dark: null })
 * equal(set[0].name, '1320x2868')
 * equal(set[0].media, 'screen and (device-width: 440px) and ' +
 *   '(device-height: 956px) and (-webkit-device-pixel-ratio: 3) and ' +
 *   '(orientation: portrait)')
 * equal(set[1].name, '2868x1320')
 * equal(splashes({ light: '#fff', dark: '#000' }).at(-1)!.name, '2048x1536-dark')
 * ```
 */
export let splashes = (palette: Palette): Splash[] =>
  [false, ...palette.dark ? [true] : []].flatMap((dark) =>
    SCREENS.flatMap(([w, h, ratio]) =>
      (['portrait', 'landscape'] as const).map((orientation) => {
        let [width, height] = orientation == 'portrait'
          ? [w * ratio, h * ratio]
          : [h * ratio, w * ratio]
        return {
          name: `${width}x${height}${dark ? '-dark' : ''}`,
          width,
          height,
          ratio,
          media:
            `screen and (device-width: ${w}px) and (device-height: ${h}px)` +
            ` and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})` +
            (palette.dark
              ? ` and (prefers-color-scheme: ${dark ? 'dark' : 'light'})`
              : ''),
          background: dark ? palette.dark! : palette.light,
        }
      })
    )
  )

/** One image of the set as SVG: its background, and the icon (`icon`, a
 * `data:` URL) at the opening screen's size, corner and place.
 *
 * ```ts
 * import { splashSvg } from '@yaks/platform/splash'
 * import { assertStringIncludes } from '@std/assert'
 * let svg = splashSvg({ name: 'a', width: 750, height: 1334, ratio: 2,
 *   media: '', background: '#fbf4e4' }, 'data:image/png;base64,AA')
 * assertStringIncludes(svg, 'width="750" height="1334"')
 * assertStringIncludes(svg, '<rect width="750" height="1334" fill="#fbf4e4"/>')
 * assertStringIncludes(svg, 'x="287" y="559" width="176" height="176"')
 * ```
 */
export let splashSvg = (at: Splash, icon: string): string => {
  let size = MARK.size * at.ratio
  let x = (at.width - size) / 2
  let y = at.height / 2 - MARK.lift * at.ratio - size / 2
  let box = `x="${x}" y="${y}" width="${size}" height="${size}"`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${at.width}" ` +
    `height="${at.height}" viewBox="0 0 ${at.width} ${at.height}">` +
    `<rect width="${at.width}" height="${at.height}" fill="${at.background}"/>` +
    `<clipPath id="m"><rect ${box} rx="${
      MARK.radius * at.ratio
    }"/></clipPath>` +
    `<image ${box} clip-path="url(#m)" preserveAspectRatio="xMidYMid slice" ` +
    `href="${esc(icon)}"/></svg>`
}

/** The icon alone at 512 pixels, the size Android draws its splash from. */
export let ICON_512 = 'icon-512'

/** The 512-pixel icon as SVG. */
export let iconSvg = (icon: string): string =>
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" ' +
  `viewBox="0 0 512 512"><image width="512" height="512" href="${
    esc(icon)
  }"/></svg>`

/** What an app's drawn set is recorded as: its key, and whether it holds a
 * dark half. */
export type Drawn = { key: string; dark: boolean }

/** Where an app's sets are kept: beside its generated icon, so they follow
 * it across releases and transfers. */
export let splashPrefix = (
  space: Parameters<typeof declarationsPrefix>[0],
  app: Parameters<typeof declarationsPrefix>[1],
): string => `${declarationsPrefix(space, app)}splash/`

/** Where a page asks for one image of a set, below the app's mount `at`. */
export let splashAt = (at: string, key: string, name: string): string =>
  `${at}api/splash/${key}/${name}.png`

/** The key and image a request below `api/` asks for, or null.
 *
 * ```ts
 * import { splashAsked } from '@yaks/platform/splash'
 * import { equal } from '@yaks/testing'
 * equal(splashAsked('/splash/0123456789abcdef/750x1334-dark.png'),
 *   { key: '0123456789abcdef', name: '750x1334-dark' })
 * equal(splashAsked('/splash/../x.png'), null)
 * ```
 */
export let splashAsked = (path: string) => {
  let m = /^\/splash\/([a-f0-9]{16})\/((?:\d+x\d+(?:-dark)?)|icon-512)\.png$/
    .exec(path)
  return m ? { key: m[1], name: m[2] } : null
}

/** The tags a page names its set with.
 *
 * ```ts
 * import { startupLinks } from '@yaks/platform/splash'
 * import { assertStringIncludes } from '@std/assert'
 * let tags = startupLinks('/box/', { key: '0123456789abcdef', dark: false })
 * assertStringIncludes(tags, '<link rel="apple-touch-startup-image" ' +
 *   'href="/box/api/splash/0123456789abcdef/1320x2868.png" media="screen and')
 * ```
 */
export let startupLinks = (at: string, drawn: Drawn): string =>
  splashes({ light: '', dark: drawn.dark ? '-' : null }).map((s) =>
    `<link rel="apple-touch-startup-image" href="${
      splashAt(at, drawn.key, s.name)
    }" media="${s.media}">`
  ).join('')

/** The key a set is drawn under: what it is drawn from, and how. */
export let splashKey = async (
  icon: Uint8Array,
  palette: Palette,
): Promise<string> => {
  let hex = async (bytes: Uint8Array) =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>),
      ),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')
  let what = JSON.stringify({
    v: 1,
    mark: MARK,
    icon: await hex(icon),
    palette,
  })
  return (await hex(new TextEncoder().encode(what))).slice(0, 16)
}

/** The object a finished set ends with, written last. */
export let DONE = 'done'

type SplashTarget = {
  app: Parameters<typeof declarationsPrefix>[1] & { splash?: Drawn | null }
  space: Parameters<typeof declarationsPrefix>[0]
}

/** Draw the live release's set unless it is drawn, record it, and delete
 * the app's other sets. A set already kept, from an interrupted run, is
 * recorded without drawing again. */
export let ensureSplash = async <T extends SplashTarget>(io: {
  live: () => Promise<T | null>
  inputs: (at: T) => Promise<{ icon: Uint8Array; palette: Palette }>
  has: (key: string) => Promise<boolean>
  draw: (svg: string, width: number, height: number) => Promise<Uint8Array>
  put: (key: string, png: Uint8Array) => Promise<void>
  record: (drawn: Drawn) => Promise<unknown>
  list: (prefix: string) => Promise<string[]>
  delete: (keys: string[]) => Promise<void>
}): Promise<void> => {
  let at = await io.live()
  if (!at) return
  let { icon, palette } = await io.inputs(at)
  let key = await splashKey(icon, palette)
  let drawn = { key, dark: !!palette.dark }
  if (at.app.splash?.key == key) return
  let sets = splashPrefix(at.space, at.app)
  let prefix = `${sets}${key}/`
  if (!await io.has(prefix + DONE)) {
    let mark = `data:image/png;base64,${base64(icon)}`
    let jobs = [
      ...splashes(palette).map((s) => () =>
        io.draw(splashSvg(s, mark), s.width, s.height)
          .then((png) => io.put(`${prefix}${s.name}.png`, png))
      ),
      () =>
        io.draw(iconSvg(mark), 512, 512)
          .then((png) => io.put(`${prefix}${ICON_512}.png`, png)),
    ]
    await pooled(jobs, 6)
    await io.put(prefix + DONE, new Uint8Array())
  }
  await io.record(drawn)
  let old = (await io.list(sets)).filter((k) => !k.startsWith(prefix))
  if (old.length) await io.delete(old)
}

// At most `width` jobs at once.
let pooled = async (jobs: (() => Promise<unknown>)[], width: number) => {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(width, jobs.length) }, async () => {
      while (next < jobs.length) await jobs[next++]()
    }),
  )
}

let base64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

// Reading an app's background off its files, as the release holds them.
// The browser's cascade (./install-browser.ts) is the truth, and runs only
// in a browser; this reads the few places an app says its background: the
// root's and the body's `background`, and a `--bg` token, in the light and
// the dark scheme. What it cannot read falls to white, the canvas a page
// that says nothing is painted on.

/** An app's background in each scheme, as its owner set it (`theme`), its
 * manifest gives it, or its start page and the sheets it links declare it,
 * in that order.
 *
 * ```ts
 * import { palette } from '@yaks/platform/splash'
 * import { equal } from '@yaks/testing'
 * let sheet = ':root { --bg: #fbf4e4 } body { background: ' +
 *   'radial-gradient(#fff, transparent), var(--bg) }' +
 *   '@media (prefers-color-scheme: dark) { :root { --bg: rgb(20 20 20) } }'
 * equal(palette({ sheets: [sheet] }), { light: '#fbf4e4', dark: '#141414' })
 * equal(palette({ theme: '#123456', sheets: [sheet] }),
 *   { light: '#123456', dark: null })
 * equal(palette({ manifest: { background_color: 'white' } }),
 *   { light: '#ffffff', dark: null })
 * equal(palette({}), { light: '#ffffff', dark: null })
 * ```
 */
export let palette = (from: {
  theme?: string | null
  manifest?: Record<string, unknown> | null
  sheets?: string[]
}): Palette => {
  let owned = color(from.theme ?? '')
  if (owned) return { light: owned, dark: null }
  let given = color(String(from.manifest?.background_color ?? ''))
  let givenDark = color(
    String(
      (from.manifest?.color_scheme_dark as Record<string, unknown> | undefined)
        ?.background_color ?? '',
    ),
  )
  if (given) {
    return { light: given, dark: givenDark != given ? givenDark : null }
  }
  let rules = (from.sheets ?? []).flatMap((css) => parsed(css, null))
  let light = painted(rules, 'light') ?? '#ffffff'
  let dark = painted(rules, 'dark')
  return { light, dark: dark && dark != light ? dark : null }
}

/** The style sheets a page names, in order: each inline `<style>`'s text,
 * or the `href` of a linked sheet, for the caller to read.
 *
 * ```ts
 * import { pageSheets } from '@yaks/platform/splash'
 * import { equal } from '@yaks/testing'
 * equal(pageSheets('<link href="a.css" rel="stylesheet"><style>b{}</style>' +
 *   '<script>"<style>x</style>"</script>'), [{ href: 'a.css' }, { text: 'b{}' }])
 * ```
 */
export let pageSheets = (html: string) =>
  Array.from(
    html.replace(/<script\b[\s\S]*?<\/script>|<!--[\s\S]*?-->/gi, '')
      .matchAll(/<link\b([^>]*)>|<style\b[^>]*>([\s\S]*?)<\/style>/gi),
  ).flatMap(([, link, text]): ({ href: string } | { text: string })[] => {
    if (text != null) return [{ text }]
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(link)) return []
    let href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(link)
    let to = href?.slice(1).find((v) => v != null)
    return to ? [{ href: to }] : []
  })

type Scheme = 'light' | 'dark'
type Rule = {
  root: boolean
  scheme: Scheme | null
  decls: [string, string][]
}

// The rules for the root and the body, each with the scheme it holds in.
// Blocks other than a scheme's @media, @layer and @supports are skipped.
let parsed = (css: string, scheme: Scheme | null): Rule[] => {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let out: Rule[] = []
  let depth = 0, start = 0, open = 0
  for (let i = 0; i < css.length; i++) {
    let c = css[i]
    if (c == ';' && !depth) start = i + 1
    else if (c == '{' && !depth++) open = i
    else if (c == '}' && depth && !--depth) {
      let prelude = css.slice(start, open).trim()
      let body = css.slice(open + 1, i)
      start = i + 1
      if (prelude.startsWith('@')) {
        let media = /^@media\b/i.test(prelude)
        let wants = /prefers-color-scheme\s*:\s*(dark|light)/i.exec(prelude)
          ?.[1].toLowerCase() as Scheme | undefined
        if (media && wants) out.push(...parsed(body, wants))
        else if (!media && /^@(layer|supports)\b/i.test(prelude)) {
          out.push(...parsed(body, scheme))
        }
        continue
      }
      let names = prelude.split(',').map((s) =>
        s.trim().replace(/^:(?:where|is)\((.*)\)$/, '$1').trim()
      )
      let root = names.some((s) => /^(?::root|html|html:root)$/i.test(s))
      let isBody = names.some((s) => /^body$/i.test(s))
      if (!root && !isBody) continue
      let decls = body.replace(/\{[^}]*\}/g, '').split(';').flatMap((d) => {
        let at = d.indexOf(':')
        return at < 0 ? [] : [[
          d.slice(0, at).trim(),
          d.slice(at + 1).replace(/!important/i, '').trim(),
        ] as [string, string]]
      })
      out.push({ root, scheme, decls })
      if (root && isBody) out.push({ root: false, scheme, decls })
    }
  }
  return out
}

// The background a scheme paints: the root's colour, else the body's, else
// the page's `--bg`.
let painted = (rules: Rule[], scheme: Scheme) => {
  let vars = new Map<string, string>()
  let bg = { root: '', body: '' }
  for (let r of rules) {
    if (r.scheme && r.scheme != scheme) continue
    for (let [prop, value] of r.decls) {
      if (prop.startsWith('--')) vars.set(prop, value)
      else if (prop == 'background' || prop == 'background-color') {
        bg[r.root ? 'root' : 'body'] = value
      }
    }
  }
  let resolve = (v: string, depth = 0): string =>
    depth > 8 ? v : v.replace(
      /var\(\s*(--[\w-]+)\s*(?:,([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
      (_, name, fallback) =>
        resolve(vars.get(name) ?? fallback?.trim() ?? '', depth + 1),
    ).replace(
      /light-dark\(([^,()]*(?:\([^()]*\))?[^,()]*),([^()]*(?:\([^()]*\))?[^()]*)\)/g,
      (_, a, b) => (scheme == 'light' ? a : b).trim(),
    )
  return layerColor(resolve(bg.root)) ?? layerColor(resolve(bg.body)) ??
    color(resolve(vars.get('--bg') ?? ''))
}

// The colour a `background` value ends on: the last layer's colour token.
let layerColor = (value: string) => {
  let layers = split(value, ',')
  let last = layers.at(-1) ?? ''
  return split(last, ' ').reverse().map(color).find(Boolean) ?? null
}

// `value` split on `on` outside parentheses.
let split = (value: string, on: string) => {
  let out: string[] = [], depth = 0, from = 0
  for (let i = 0; i < value.length; i++) {
    let c = value[i]
    if (c == '(') depth++
    else if (c == ')') depth--
    else if (!depth && (on == ' ' ? /\s/.test(c) : c == on)) {
      out.push(value.slice(from, i))
      from = i + 1
    }
  }
  out.push(value.slice(from))
  return out.map((s) => s.trim()).filter(Boolean)
}

let NAMED: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  snow: '#fffafa',
  ivory: '#fffff0',
  linen: '#faf0e6',
  beige: '#f5f5dc',
  whitesmoke: '#f5f5f5',
  floralwhite: '#fffaf0',
  oldlace: '#fdf5e6',
  seashell: '#fff5ee',
  ghostwhite: '#f8f8ff',
  aliceblue: '#f0f8ff',
  mintcream: '#f5fffa',
  honeydew: '#f0fff0',
  lavender: '#e6e6fa',
  cornsilk: '#fff8dc',
  papayawhip: '#ffefd5',
  antiquewhite: '#faebd7',
  lightyellow: '#ffffe0',
  gainsboro: '#dcdcdc',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  navy: '#000080',
}

let hex2 = (n: number) =>
  Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')

/** An opaque CSS colour as `#rrggbb`, or null for one that is not, or that
 * this cannot read.
 *
 * ```ts
 * import { color } from '@yaks/platform/splash'
 * import { equal } from '@yaks/testing'
 * equal(color('#FbF'), '#ffbbff')
 * equal(color('rgb(255, 0, 10)'), '#ff000a')
 * equal(color('hsl(0 0% 100%)'), '#ffffff')
 * equal(color('rgb(0 0 0 / 50%)'), null)
 * equal(color('transparent'), null)
 * ```
 */
export let color = (value: string): string | null => {
  let v = value.trim().toLowerCase()
  if (NAMED[v]) return NAMED[v]
  let hex = /^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/.exec(v)?.[1]
  if (hex) {
    let full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
    return full.length == 8 && full.slice(6) != 'ff'
      ? null
      : '#' + full.slice(0, 6)
  }
  let fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(v)
  if (!fn) return null
  let parts = fn[2].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  let alpha = parts[3]
  if (
    alpha != null &&
    (alpha.endsWith('%') ? parseFloat(alpha) / 100 : parseFloat(alpha)) < 1
  ) return null
  let num = (s: string, full: number) =>
    s.endsWith('%') ? parseFloat(s) / 100 * full : parseFloat(s)
  if (fn[1].startsWith('rgb')) {
    let rgb = parts.slice(0, 3).map((p) => num(p, 255))
    return rgb.some(isNaN) ? null : '#' + rgb.map(hex2).join('')
  }
  let h = parseFloat(parts[0]), s = num(parts[1], 1), l = num(parts[2], 1)
  if ([h, s, l].some(isNaN)) return null
  if (!parts[1].endsWith('%')) s /= 100
  if (!parts[2].endsWith('%')) l /= 100
  let k = (n: number) => (n + h / 30) % 12
  let a = s * Math.min(l, 1 - l)
  let f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return '#' + [f(0), f(8), f(4)].map((x) => hex2(x * 255)).join('')
}
