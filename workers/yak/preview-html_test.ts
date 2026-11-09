import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import './binding-probe.ts'
import { previewed } from './preview-html.ts'
import { woven } from './apps.ts'
import { app } from './directory-fixture.ts'
import type { Env } from './env.ts'

let read = async (response: Response) => {
  let html = await response.text()
  let { document } = parseHTML(html)
  let meta = (key: string) =>
    document.querySelector(
      `meta[${key.startsWith('og:') ? 'property' : 'name'}="${key}"]`,
    )?.getAttribute('content')
  return { html, document, meta }
}
let at = 'https://public.yaks.app/recipes/about'
let page = (head: string) =>
  new Response(
    `<!doctype html><html><head>${head}</head><body>Hello</body></html>`,
  )

test('hosted HTML supplies its public title and description and resolves its image', async () => {
  let { document, meta } = await read(previewed(
    {},
    page(
      '<title>Recipes &amp; friends &#x1f331;</title>' +
        '<meta name="description" content="Dinner &amp; dessert">' +
        '<meta property="og:image" content="pictures/card.png">',
    ),
    at,
  ))
  assertEquals(meta('og:title'), document.title)
  assertEquals(meta('og:description'), 'Dinner & dessert')
  assertEquals(
    meta('og:image'),
    'https://public.yaks.app/recipes/pictures/card.png',
  )
  assertEquals(meta('twitter:image'), meta('og:image'))
})

test('authored preview tags survive repeated weaving without duplicates', async () => {
  let source = page(
    '<title>Tab title</title><meta property="og:title" content="Shared title"><meta property="og:description" content="A public page"><meta name="twitter:card" content="summary">',
  )
  let { document, meta } = await read(
    previewed({}, previewed({}, source, at), at),
  )
  assertEquals(document.title, 'Tab title')
  assertEquals(meta('og:title'), 'Shared title')
  assertEquals(meta('twitter:title'), 'Shared title')
  assertEquals(meta('twitter:card'), 'summary')
  for (
    let key of [
      'og:title',
      'og:description',
      'og:site_name',
      'og:image',
      'twitter:card',
    ]
  ) {
    assertEquals(
      document.querySelectorAll(
        `meta[${key.startsWith('og:') ? 'property' : 'name'}="${key}"]`,
      ).length,
      1,
      key,
    )
  }
})

test('image URLs use the document base even when it follows the image tag', async () => {
  for (
    let head of [
      '<base href="/recipes/"><meta property="og:image" content="card.png">',
      '<meta property="og:image" content="card.png"><base href="/recipes/">',
    ]
  ) {
    let { meta } = await read(previewed({}, page(head), `${at}/nested/`))
    assertEquals(meta('og:image'), 'https://public.yaks.app/recipes/card.png')
  }
})

test('empty authored metadata is filled without leaving duplicate tags', async () => {
  let { document, meta } = await read(
    previewed(
      {},
      page(
        '<meta property="og:title" content=""><meta name="description" content="">',
      ),
      at,
    ),
  )
  assertEquals(document.querySelectorAll('meta[property="og:title"]').length, 1)
  assertEquals(meta('og:title'), 'An app on yaks.app')
})

test('screenshot fallbacks never include the sandbox page bearer', async () => {
  let html = await woven(
    {} as Env,
    '<html><head></head><body>Hello</body></html>',
    '/recipes/~secret-bearer/',
    '/recipes/',
    app({
      access: 'public',
      title: 'Recipes',
      screenshot: 'picture',
    }),
    '',
    null,
    '/recipes/',
    at,
  )
  let { meta } = await read(new Response(html))
  assertEquals(
    meta('og:image'),
    'https://public.yaks.app/recipes/api/blob/picture',
  )
  assert(!meta('og:image')?.includes('secret-bearer'))
})

test('a headless worker page gets the shared preview without changing its body', async () => {
  let { html, meta } = await read(
    previewed({}, new Response('<h1>A public form</h1>'), at),
  )
  assert(html.includes('<h1>A public form</h1>'))
  assertEquals(meta('og:title'), 'An app on yaks.app')
  assertEquals(meta('og:image'), 'https://yaks.app/og.png')
})

test('public app defaults describe the app while private defaults reveal no record data', async () => {
  for (let access of ['public', 'private'] as const) {
    let html = await woven(
      {} as Env,
      '<html><head></head><body>Hello</body></html>',
      '/recipes/',
      '/recipes/',
      app({
        access,
        title: 'Hidden recipe box',
        screenshot: 'secret-image',
        published: {
          name: 'recipes',
          version: 1,
          at: '',
          about: 'Secret description',
        },
      }),
      '',
      null,
      '/recipes/',
      at,
    )
    let { meta } = await read(new Response(html))
    assertEquals(
      meta('og:title'),
      access == 'public' ? 'Hidden recipe box' : 'An app on yaks.app',
    )
    assertEquals(
      meta('og:image'),
      access == 'public'
        ? 'https://public.yaks.app/recipes/api/blob/secret-image'
        : 'https://yaks.app/og.png',
    )
    if (access == 'private') assert(!meta('og:description')?.includes('Secret'))
  }
})
