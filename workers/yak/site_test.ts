// The apex's own pages (workers/yak/public): every page carries the same
// footer, and a footer link is the one thing on a static site that rots
// silently — a renamed file leaves a 404 nobody clicks until a stranger does.
// So: each link names a file that exists, and each page carries the whole set.
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
