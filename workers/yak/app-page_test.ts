// A published app's own page (app-page.ts), drawn from the offers as a
// stranger reaches it: opening the app first, making a copy second, and gone
// once nothing is published under its name.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { answer } from './app-page.ts'
import type { App, Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { pageAt, screenshot } from './gallery.ts'
import { app, space } from './testing.ts'
import { parseHTML } from 'linkedom'

let live = {
  askedAt: '2026-09-06T10:00:00.000Z',
  listedAt: '2026-09-06T12:00:00.000Z',
}

// The page at `path` with these offers standing.
let visit = async (
  offers: { space: Space; app: App }[],
  path = '/apps/recipes',
  method = 'GET',
) => {
  let dir = { offers: () => Promise.resolve(offers) } as unknown as Directory
  let res = await answer(
    new Request(`https://yaks.app${path}`, { method }),
    {} as Env,
    path,
    dir,
  )
  return { status: res.status, html: await res.text() }
}
let offer = (over: Partial<App> = {}) => ({
  space: space(),
  app: app({ screenshot: 'shot', ...over }),
})

test('a published app has a page that opens it first and offers a copy second', async () => {
  let { status, html } = await visit([offer()])
  assertEquals(status, 200)
  let { document } = parseHTML(html)
  assertEquals(document.querySelector('h1')!.textContent, 'Recipe box')
  assertStringIncludes(html, 'Somewhere to keep recipes')
  assertStringIncludes(html, 'Made at jeff.yaks.app')
  assertStringIncludes(html, screenshot(space(), app({ screenshot: 'shot' })))
  // Opening is the filled button; the copy is a plain one after it, sent to
  // the install door.
  let presses = [...document.querySelectorAll('.Listing_Doors .Button')]
  assertEquals(
    presses.map((b) => [b.textContent, b.matches('.Button-go')]),
    [['Open the app', true], ['Make your own copy', false]],
  )
  assertEquals(
    presses[0].getAttribute('href'),
    'https://jeff.yaks.app/recipes/',
  )
  assertEquals(
    presses[1].closest('form')!.getAttribute('action'),
    '/install?name=recipes',
  )
  assertStringIncludes(
    html,
    `<link rel="canonical" href="${pageAt('recipes')}">`,
  )
})

test('only a listed app is offered to search engines', async () => {
  let noindex = '<meta name="robots" content="noindex">'
  assertStringIncludes((await visit([offer()])).html, noindex)
  assert(!(await visit([offer({ gallery: live })])).html.includes(noindex))
})

test('a private app opens as its demo copy, or offers only the copy', async () => {
  let source = { access: 'private' as const }
  let alone = (await visit([offer(source)])).html
  assert(!alone.includes('Open the app'))
  assert(!alone.includes('api/blob/shot'), 'an unlisted private picture')
  assertStringIncludes(alone, 'Make your own copy')
  let demo = {
    space: space({ slug: 'yourname' }),
    app: app({
      eid: 'demo-eid',
      installed: { of: 'app-eid', version: 1, sandboxed: null },
      published: { ...app().published!, name: 'recipes-demo' },
    }),
  }
  let { document } = parseHTML((await visit([offer(source), demo])).html)
  assertEquals(
    [...document.querySelectorAll('a')]
      .find((a) => a.textContent == 'Open the app')?.getAttribute('href'),
    'https://yourname.yaks.app/recipes/',
  )
})

test('a name nothing is published under, or a deeper path, is not found', async () => {
  assertEquals((await visit([offer()], '/apps/chores')).status, 404)
  assertEquals((await visit([offer()], '/apps/recipes/x')).status, 404)
  assertEquals((await visit([], '/apps/recipes')).status, 404)
  assertEquals((await visit([offer()], '/apps/recipes', 'POST')).status, 405)
})
