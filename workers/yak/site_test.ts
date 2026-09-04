// The apex's own pages (workers/yak/public): every page carries the same
// footer, and a footer link is the one thing on a static site that rots
// silently — a renamed file leaves a 404 nobody clicks until a stranger does.
// So: each link names a file that exists, and each page carries the whole set.
//
// The same rot takes a style guide: /style-guide is only worth having while it
// says what style.css actually does, so the two are held in step here in both
// directions — the guide may only draw classes the sheet defines, and the
// sheet may not grow a component or a token the guide does not draw.
// And the same rot takes the drawn recipe box on the front page, which names
// three recipes and a note by name. Those are claims about a live app, so only
// the live app can check them: see `box()` at the foot of this file.
import { assert, assertEquals } from '@std/assert'
import { slow } from '../../src/testing.ts'

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

// --- the drawn recipe box, and the box it is drawn of ------------------------

// The widget on the front page names three recipes and says who left a note.
// Every one of those is a claim about `yourname/recipes`, a live app nobody
// on this repo's gate owns — it was reseeded on 2026-09-04 and every claim
// went false at once, while the HTML comment asserting they were true stayed
// exactly as true-looking as before.
//
// So the check hits the network, and therefore runs in the slow tier. A
// fixture in the fast tier was the other option and is the worse one: the
// fixture would be a COPY of the live titles, so a reseed leaves it stale and
// the test green — green while wrong, the failure this is meant to catch. The
// refresher that would keep it honest is this same network call, plus a second
// copy to rot. One source of truth, checked less often, beats two that agree
// with each other and not with the world.
let widget = () => {
  // Window_Body holds only a heading, the list and the note — no nested div —
  // so the first close ends it, and the rest of the page cannot leak in.
  let body =
    (read('index.html').split('<div class="Window_Body">')[1] ?? '').split(
      '</div>',
    )[0]
  return {
    titles: [...body.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1].trim()),
    who: body.match(/class="Window_Who">([^<]+)</)?.[1]?.trim() ?? '',
    on: body.match(/data-note-on="([^"]+)"/)?.[1] ?? '',
  }
}

// A scrape that finds nothing passes every "each of these is present" test
// vacuously, so the shape is pinned here in the fast tier, off the page in
// this repo. This is not a copy of the live data — it is the parser held
// against the only page it ever parses.
Deno.test('the drawn recipe box makes three named claims and one note claim', () => {
  let { titles, who, on } = widget()
  assertEquals(titles.length, 3, 'the box should list three recipes')
  assert(titles.every(Boolean), 'a listed recipe has no name')
  assert(who, 'the note claim names nobody')
  assert(
    titles.includes(on),
    `the note is on ${on}, which the box does not list`,
  )
})

let box = async () => {
  let url = 'https://yourname.yaks.app/recipes/api/query?.recipe!'
  let res = await fetch(url)
  assert(res.ok, `${url} answered ${res.status}`)
  return await res.json() as { recipe: { title: string; notes?: string } }[]
}

slow('the drawn recipe box names what the live box holds', async () => {
  let { titles, who, on } = widget()
  let held = await box()
  assertEquals(
    titles.filter((t) => !held.some((r) => r.recipe.title === t)),
    [],
    'the front page names recipes yourname/recipes does not hold',
  )
  // The app renders `notes` as bare text with no author (its own index.html),
  // so "Ana left a note" is only true while the note itself says so.
  let noted = held.find((r) => r.recipe.title === on)
  assert(noted, `${on} is not in the box`)
  assert(
    noted.recipe.notes?.includes(who),
    `the front page says ${who} left a note on ${on}, ` +
      `but its note does not name ${who}: ${noted.recipe.notes ?? '(none)'}`,
  )
})
