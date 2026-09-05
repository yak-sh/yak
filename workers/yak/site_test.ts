// Public-page contracts: shared navigation, valid jumps, documented
// components, and plan allowances that agree with the metering code.
import { assert, assertEquals } from '@std/assert'
import { LETTERS } from './meter.ts'

let read = (name: string) =>
  Deno.readTextFileSync(new URL(`./public/${name}`, import.meta.url))

let pages = [
  'index.html',
  'help.html',
  'technical.html',
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

Deno.test('every jump names a section on its own page', () => {
  for (let page of branded) {
    let html = read(page)
    let ids = new Set(
      [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]),
    )
    let jumps = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
    if (
      ['index.html', 'help.html', 'technical.html', 'style-guide.html']
        .includes(page)
    ) {
      assert(jumps.length, `${page} has no jump navigation`)
    }
    for (let j of jumps) assert(ids.has(j), `${page}: #${j} names no section`)
  }
})

Deno.test('the style guide demonstrates every shared component', () => {
  let css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '')
    .split('@layer components {')[1].split('@layer sections {')[0]
  let components = new Set(
    [...css.matchAll(/\.([A-Z][\w-]*)/g)].map((m) => m[1]),
  )
  let examples = new Set(
    [...read('style-guide.html').matchAll(/class="([^"]+)"/g)]
      .flatMap((m) => m[1].split(/\s+/)),
  )
  assert(components.size > 0)
  for (let name of components) {
    assert(examples.has(name), `No example of .${name}`)
  }
})

// The nav is the same four places on every page, or it is not a nav: a link
// that appears on one page and not the next is how a visitor loses the thread
// (T-33643). The current page marks itself with aria-current and nothing else,
// so the set of destinations is identical everywhere.
Deno.test('every page carries the same four nav links', () => {
  let want = ['/#how', '/pricing', '/technical', '/login']
  for (let page of branded) {
    let nav = read(page).split('<nav class="Nav"')[1]?.split('</nav>')[0] ?? ''
    assert(nav, `${page} has no nav`)
    assertEquals(
      [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]),
      want,
      page,
    )
  }
})

// What the pages SELL is what the code holds a space to (T-33688). The two
// allowances live in one place — meter.ts `LETTERS`, which the send door and
// the standing line both read — so a page quoting a number nothing enforces is
// exactly the copy this test exists to prevent: it was pulled once for saying
// "100 emails a month" of a platform that could not send one at all.
let flat = (html: string) => html.replace(/\s+/g, ' ')

Deno.test('the plan pages carry the email allowance the code enforces', () => {
  let free = `${LETTERS.free} emails a month`
  let plus = `${LETTERS.plus.toLocaleString('en-US')} emails a month`
  for (let page of ['index.html', 'pricing.html', 'technical.html']) {
    let html = flat(read(page))
    assert(html.includes(free), `${page} does not say ${free}`)
    assert(html.includes(plus), `${page} does not say ${plus}`)
  }
  // And the one rule that number needs beside it: only the SEND stops, so a
  // letter written to an app is never turned away at the door.
  assert(flat(read('technical.html')).includes('only SENDING stops'))
  assert(flat(read('pricing.html')).includes('Letters written to you always'))
})

Deno.test('every footer link names a page that is there', () => {
  for (let page of branded) {
    let foot = read(page).split('<footer')[1] ?? ''
    assert(foot, `${page} has no footer`)
    assertEquals(
      links(foot).map((l) => `${l}.html`),
      pages.slice(1),
      page,
    )
  }
})
