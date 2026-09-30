import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { routes } from './routes.ts'

let [ui] = routes()
let get = async (q = '') =>
  (await ui.handle(new Request(`http://box/ui${q}`))).text()

test('/ui answers the style guide, dressed, with no script', async () => {
  assertEquals([ui.method, ui.path], ['GET', '/ui'])
  let res = await ui.handle(new Request('http://box/ui'))
  assertEquals(res.headers.get('content-type'), 'text/html; charset=utf-8')
  let page = await res.text()
  assert(page.includes('<span class="Dot Dot-ring"></span>'))
  assert(page.includes('--bg:'))
  assert(!page.includes('<script'))
})

test('/ui switches theme and scheme by link', async () => {
  let page = await get('?theme=rosepine&scheme=light')
  assert(page.includes('<html style="color-scheme: light">'))
  assert(page.includes('#191724')) // Rosé Pine's floor
  assert(!page.includes('#232a2e')) // not Everforest's
  // Each tab keeps the other choice; the one showing is on.
  assert(page.includes('href="?theme=everforest&amp;scheme=light"'))
  assert(page.includes('href="?theme=rosepine&amp;scheme=dark"'))
  assert(page.includes('scheme=light" class="Tabs_Tab Tabs_Tab-on">rosepine<'))
  // What names nothing is the default: the first theme, the system's scheme.
  let fallback = await get('?theme=nope&scheme=sepia')
  assert(
    fallback.includes('#232a2e') &&
      fallback.startsWith('<!doctype html><html><head>'),
  )
})
