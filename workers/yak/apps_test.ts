// The page transforms an app's HTML gets on its way out, as pure text: the
// `<base>` that makes an installed copy's relative URLs resolve, the tags
// that make it installable at all — the icon, the manifest link, the chrome
// colour, the two Apple words — and the manifest generated for an app that
// wrote none (apps.ts, T-34493, T-33055). The serving half — which bytes
// answer `icon.png` and `manifest.webmanifest` — is serving_test.ts.
import { assert, assertEquals } from '@std/assert'
import type { App } from './directory.ts'
import {
  based,
  manifesting,
  pinned,
  PLATFORM_BACKGROUND,
  PLATFORM_THEME,
} from './apps.ts'

let ICON = '<link rel="apple-touch-icon" href="/cookbook/icon.png">'
let MANIFEST = '<link rel="manifest" href="/cookbook/manifest.webmanifest">'
let CAPABLE = '<meta name="apple-mobile-web-app-capable" content="yes">'
let STATUS_BAR =
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">'
let PLATFORM_META = `<meta name="theme-color" content="${PLATFORM_THEME}">`

let page = (head: string) => `<!doctype html><html><head>${head}</head><body>`

let app = (
  title: string,
  theme: App['theme'] = null,
) => ({ eid: 'e', slug: 'cookbook', title, theme } as unknown as App)

Deno.test('a page with none of the five tags is given all of them, in its head', () => {
  let out = pinned(
    '/cookbook/',
    page('<title>Cookbook</title>'),
    app('Cookbook'),
  )
  assert(out.includes(ICON), out)
  assert(out.includes(MANIFEST), out)
  assert(out.includes(PLATFORM_META), out)
  assert(out.includes(CAPABLE), out)
  assert(out.includes(STATUS_BAR), out)
  // Inside the head, where the parser reads them.
  assert(out.indexOf(ICON) < out.indexOf('</head>'), out)
})

Deno.test('a page that declares one is given only the other four', () => {
  let mine = '<link rel="apple-touch-icon" href="logo.png">'
  let one = pinned('/cookbook/', page(mine), app('Cookbook'))
  assert(one.includes(mine), one)
  assert(!one.includes(ICON), one)
  assert(one.includes(MANIFEST), one)
  assert(one.includes(PLATFORM_META), one)

  let theirs = '<link rel=manifest href="app.webmanifest">'
  let two = pinned('/cookbook/', page(theirs), app('Cookbook'))
  assert(two.includes(theirs), two)
  assert(!two.includes(MANIFEST), two)
  assert(two.includes(ICON), two)
})

Deno.test('a page naming its own theme-color or Apple tags keeps them, untouched', () => {
  let mine = '<meta name="theme-color" content="#1b3a2f">'
  let out = pinned('/cookbook/', page(mine), app('Cookbook'))
  assert(out.includes(mine), out)
  assert(!out.includes(PLATFORM_META), out)
  // Every other tag still lands — one answer per question, decided alone.
  assert(out.includes(ICON), out)
  assert(out.includes(CAPABLE), out)
  assert(out.includes(STATUS_BAR), out)

  let apple = '<meta name="apple-mobile-web-app-capable" content="yes">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="black">'
  let two = pinned('/cookbook/', page(apple), app('Cookbook'))
  assert(two.includes('status-bar-style" content="black"'), two)
  assert(!two.includes(STATUS_BAR), two)
})

Deno.test('a page that declares all five is untouched', () => {
  let mine = '<link rel="apple-touch-icon-precomposed" href="logo.png">' +
    "<link rel='manifest' href='app.webmanifest'>" +
    '<meta name="theme-color" content="#000">' +
    '<meta name="apple-mobile-web-app-capable" content="yes">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="black">'
  assertEquals(pinned('/cookbook/', page(mine), app('Cookbook')), page(mine))
  // And a `rel`/`name` that merely mentions the word is not a declaration.
  let other = '<link rel="stylesheet" href="manifest.css">'
  assert(pinned('/cookbook/', page(other), app('Cookbook')).includes(MANIFEST))
})

Deno.test('a page with no head at all still gets its tags', () => {
  let out = pinned('/', '<!doctype html><p>hi', app('Cookbook'))
  assert(out.startsWith('<!doctype html><link rel="apple-touch-icon"'), out)
  assert(out.includes('href="/manifest.webmanifest"'), out)
  // The base still lands first, so it is the head's first word.
  assert(based('/', out).startsWith('<!doctype html><base href="/">'), out)
})

Deno.test("the app's own theme colour is what the injected meta and the manifest both wear", () => {
  let mine = app('Cookbook', { themeColor: '#1b3a2f', backgroundColor: '#fff' })
  let out = pinned('/cookbook/', page('<title>x</title>'), mine)
  assert(out.includes('<meta name="theme-color" content="#1b3a2f">'), out)

  let m = manifesting(mine, '/cookbook/')
  assertEquals(m.theme_color, '#1b3a2f')
  assertEquals(m.background_color, '#fff')
})

Deno.test('a hostile stored colour is refused at injection, wearing the platform instead', () => {
  // The generic graph_apply tier can set `theme` past app_set's validator, so
  // a value carrying a quote, angle bracket or script must never reach the head
  // or the manifest — it falls back to the platform colour.
  let evil = app('Cookbook', {
    themeColor: '#000"><script>alert(1)</script>',
    backgroundColor: 'x" onload="y',
  })
  let out = pinned('/cookbook/', page('<title>x</title>'), evil)
  assert(out.includes(PLATFORM_META), out)
  assert(!out.includes('<script>'), out)
  let m = manifesting(evil, '/cookbook/')
  assertEquals(m.theme_color, PLATFORM_THEME)
  assertEquals(m.background_color, PLATFORM_BACKGROUND)
})

Deno.test('the generated manifest names the app, its root, its icon and its colours', () => {
  let m = manifesting(app('Cookbook'), '/cookbook/')
  assertEquals(m.name, 'Cookbook')
  assertEquals(m.short_name, 'Cookbook')
  assertEquals(m.start_url, '/cookbook/')
  assertEquals(m.scope, '/cookbook/')
  assertEquals(m.display, 'standalone')
  // No colour of its own, so the platform's answers — never a browser grey.
  assertEquals(m.theme_color, PLATFORM_THEME)
  assertEquals(m.background_color, PLATFORM_BACKGROUND)
  assertEquals(m.icons, [
    { src: '/cookbook/icon.png', type: 'image/png', sizes: '512x512' },
    { src: '/cookbook/icon.png', type: 'image/png', sizes: '192x192' },
  ])
})

Deno.test('an app with no title is named by its slug', () => {
  let m = manifesting(app(''), '/')
  assertEquals(m.name, 'cookbook')
  assertEquals(m.icons[0].src, '/icon.png')
})
