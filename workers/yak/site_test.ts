// The apex's own pages (workers/yak/public): every page carries the same
// footer, and a footer link is the one thing on a static site that rots
// silently — a renamed file leaves a 404 nobody clicks until a stranger does.
// So: each link names a file that exists, and each page carries the whole set.
import { assert, assertEquals } from '@std/assert'

let read = (name: string) =>
  Deno.readTextFileSync(new URL(`./public/${name}`, import.meta.url))

let pages = [
  'index.html',
  'terms.html',
  'privacy.html',
  'acceptable-use.html',
  'cookies.html',
]

// An extensionless link: the assets door serves `terms.html` for `/terms`
// and redirects the other spelling, so the pages link the short one.
let links = (html: string) =>
  [...html.matchAll(/<a href="\/([a-z-]+)">/g)].map((m) => m[1])

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
