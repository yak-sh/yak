// The apex's own pages (workers/yak/public): every page carries the same
// footer, and a footer link is the one thing on a static site that rots
// silently — a renamed file leaves a 404 nobody clicks until a stranger does.
// So: each link names a file that exists, and each page carries the whole set.
//
// The same rot takes a style guide: /style-guide is only worth having while it
// says what style.css actually does, so the two are held in step here in both
// directions — the guide may only draw classes the sheet defines, and the
// sheet may not grow a component or a token the guide does not draw.
import { assert, assertEquals } from '@std/assert'

let read = (name: string) =>
  Deno.readTextFileSync(new URL(`./public/${name}`, import.meta.url))

let pages = [
  'index.html',
  'help.html',
  'pricing.html',
  'terms.html',
  'privacy.html',
  'acceptable-use.html',
  'cookies.html',
]

let branded = [...pages, 'style-guide.html']

Deno.test('every page wears the raster yak', () => {
  for (let page of branded) {
    let html = read(page)
    assert(
      html.includes(
        '<link rel="icon" href="favicon-32.png" type="image/png" sizes="32x32" />',
      ),
      `${page} has no PNG favicon`,
    )
    assert(
      html.includes(
        '<link rel="apple-touch-icon" href="apple-touch-icon.png" />',
      ),
      `${page} has no home-screen icon`,
    )
    assert(!html.includes('yak.svg'), `${page} still uses the old drawing`)
  }
})

let png = (name: string, width: number, height: number) => {
  let bytes = Deno.readFileSync(new URL(`./public/${name}`, import.meta.url))
  assertEquals([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  let view = new DataView(bytes.buffer, bytes.byteOffset)
  assertEquals([view.getUint32(16), view.getUint32(20)], [width, height], name)
  assertEquals(bytes[25], 6, `${name} is not RGBA`)
}

Deno.test('the yak exports have their intended transparent sizes', () => {
  png('yak.png', 768, 743)
  png('favicon-32.png', 32, 32)
  png('apple-touch-icon.png', 180, 180)
  png('icon-192.png', 192, 192)
  png('icon-512.png', 512, 512)
})

// An extensionless link: the assets door serves `terms.html` for `/terms`
// and redirects the other spelling, so the pages link the short one.
let links = (html: string) =>
  [...html.matchAll(/<a href="\/([a-z-]+)">/g)].map((m) => m[1])

// The help page jumps to its own questions. A renamed section leaves a pill
// that scrolls nowhere and says nothing about it, the same silent rot.
Deno.test('every help jump names a section on that page', () => {
  let html = read('help.html')
  let ids = new Set(
    [...html.matchAll(/<section id="([a-z]+)">/g)].map((m) => m[1]),
  )
  let jumps = [...html.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1])
  assert(jumps.length, 'help.html has no jumps')
  for (let j of jumps) assert(ids.has(j), `#${j} names no section`)
})

Deno.test('every footer link names a page that is there', () => {
  for (let page of pages) {
    let foot = read(page).split('<footer')[1] ?? ''
    assert(foot, `${page} has no footer`)
    assertEquals(
      links(foot).map((l) => `${l}.html`),
      pages.slice(1),
      page,
    )
  }
})

// --- the stylesheet and the page that demonstrates it ------------------------

let css = read('style.css')
let guide = read('style-guide.html')

// The body of one declared layer, by brace count: layers nest media queries,
// so a lazy regex would stop at the first inner brace.
let layer = (name: string) => {
  let at = css.indexOf(`@layer ${name} {`)
  assert(at >= 0, `style.css has no @layer ${name}`)
  let depth = 0
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) {
      return css.slice(css.indexOf('{', at) + 1, i)
    }
  }
  throw new Error(`@layer ${name} is unclosed`)
}

// House naming: a class is PascalCase, so `.Pill-quiet` reads as a class and
// `0.5rem` does not.
let styled = (text: string) =>
  new Set([...text.matchAll(/\.([A-Z][\w-]*)/g)].map((m) => m[1]))

let worn = (html: string) =>
  new Set(
    [...html.matchAll(/class="([^"]*)"/g)]
      .flatMap((m) => m[1].trim().split(/\s+/))
      .filter(Boolean),
  )

let missing = (need: Set<string>, have: Set<string>) =>
  [...need].filter((n) => !have.has(n)).sort()

Deno.test('every class the style guide draws is in the stylesheet', () => {
  assertEquals(missing(worn(guide), styled(css)), [])
})

Deno.test('every class the pages wear is in the stylesheet', () => {
  for (let page of pages) {
    assertEquals(missing(worn(read(page)), styled(css)), [], page)
  }
})

Deno.test('every component in the stylesheet is drawn in the style guide', () => {
  assertEquals(missing(styled(layer('components')), worn(guide)), [])
})

// A swatch per token, so the guide cannot quietly stop listing one.
Deno.test('every token the stylesheet declares has a swatch', () => {
  let root = layer('tokens').match(/:root\s*\{([^}]*)\}/)
  assert(root, 'the tokens layer declares nothing on :root')
  let declared = [...root[1].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])
  let drawn = new Set(
    [...guide.matchAll(/data-token="(--[\w-]+)"/g)].map((m) => m[1]),
  )
  assertEquals(missing(new Set(declared), drawn), [])
})

// The system's one rule, mechanically: a paint (a token holding a literal
// colour) is spent only in the tokens layer, where a role points at it. Any
// other layer naming a paint is a colour that will not follow the theme.
Deno.test('nothing outside the tokens layer spends a paint', () => {
  let tokens = layer('tokens')
  let paints = [...tokens.matchAll(/(--[\w-]+)\s*:\s*#/g)].map((m) => m[1])
  let rest = css.replace(tokens, '')
  assertEquals(
    paints.filter((p) => rest.includes(`var(${p})`)),
    [],
  )
})
