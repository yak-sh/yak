// The page transforms an app's HTML gets on its way out, as pure text: the
// `<base>` that makes an installed copy's relative URLs resolve, the two links
// that make it installable at all, and the manifest generated for an app that
// wrote none (apps.ts, T-34493). The serving half — which bytes answer
// `icon.png` and `manifest.webmanifest` — is serving_test.ts.
import { assert, assertEquals } from '@std/assert'
import type { App } from './directory.ts'
import { based, manifesting, pinned, themed } from './apps.ts'

let ICON = '<link rel="apple-touch-icon" href="/cookbook/icon.png">'
let MANIFEST = '<link rel="manifest" href="/cookbook/manifest.webmanifest">'

let page = (head: string) => `<!doctype html><html><head>${head}</head><body>`

Deno.test('a page with neither link is given both, in its head', () => {
  let out = pinned('/cookbook/', page('<title>Cookbook</title>'))
  assert(out.includes(ICON), out)
  assert(out.includes(MANIFEST), out)
  // Inside the head, where the parser reads them.
  assert(out.indexOf(ICON) < out.indexOf('</head>'), out)
})

Deno.test('a page that declares one is given only the other', () => {
  let mine = '<link rel="apple-touch-icon" href="logo.png">'
  let one = pinned('/cookbook/', page(mine))
  assert(one.includes(mine), one)
  assert(!one.includes(ICON), one)
  assert(one.includes(MANIFEST), one)

  let theirs = '<link rel=manifest href="app.webmanifest">'
  let two = pinned('/cookbook/', page(theirs))
  assert(two.includes(theirs), two)
  assert(!two.includes(MANIFEST), two)
  assert(two.includes(ICON), two)
})

Deno.test('a page that declares both is untouched', () => {
  let mine = '<link rel="apple-touch-icon-precomposed" href="logo.png">' +
    "<link rel='manifest' href='app.webmanifest'>"
  assertEquals(pinned('/cookbook/', page(mine)), page(mine))
  // And a rel that merely mentions the word is not a declaration.
  let other = '<link rel="stylesheet" href="manifest.css">'
  assert(pinned('/cookbook/', page(other)).includes(MANIFEST))
})

Deno.test('a page with no head at all still gets its links', () => {
  let out = pinned('/', '<!doctype html><p>hi')
  assert(out.startsWith('<!doctype html><link rel="apple-touch-icon"'), out)
  assert(out.includes('href="/manifest.webmanifest"'), out)
  // The base still lands first, so it is the head's first word.
  assert(based('/', out).startsWith('<!doctype html><base href="/">'), out)
})

Deno.test('theme-color is read off the page, unscoped one first', () => {
  assertEquals(themed(page('<title>x</title>')), null)
  assertEquals(
    themed(page('<meta name="theme-color" content="#1b3a2f">')),
    '#1b3a2f',
  )
  assertEquals(themed(page("<meta content=' teal ' name=theme-color>")), 'teal')
  // A media-scoped colour applies only sometimes; the plain one always does.
  let both = '<meta name="theme-color" media="(prefers-color-scheme: dark)" ' +
    'content="#000"><meta name="theme-color" content="#fff">'
  assertEquals(themed(page(both)), '#fff')
  // Scoped and nothing else is still better than no colour.
  assertEquals(
    themed(page(both.slice(0, both.indexOf('><meta', 1) + 1))),
    '#000',
  )
})

let app = (
  title: string,
) => ({ eid: 'e', slug: 'cookbook', title } as unknown as App)

Deno.test('the generated manifest names the app, its root, and its icon', () => {
  let m = manifesting(app('Cookbook'), '/cookbook/', '#1b3a2f')
  assertEquals(m.name, 'Cookbook')
  assertEquals(m.short_name, 'Cookbook')
  assertEquals(m.start_url, '/cookbook/')
  assertEquals(m.scope, '/cookbook/')
  assertEquals(m.display, 'standalone')
  assertEquals(m.theme_color, '#1b3a2f')
  assertEquals(m.background_color, '#1b3a2f')
  assertEquals(m.icons, [
    { src: '/cookbook/icon.png', type: 'image/png', sizes: '512x512' },
    { src: '/cookbook/icon.png', type: 'image/png', sizes: '192x192' },
  ])
})

Deno.test('an app with no title is named by its slug, and colourless', () => {
  let m = manifesting(app(''), '/', null)
  assertEquals(m.name, 'cookbook')
  assert(!('theme_color' in m), JSON.stringify(m))
  assert(!('background_color' in m), JSON.stringify(m))
  assertEquals(m.icons[0].src, '/icon.png')
})
