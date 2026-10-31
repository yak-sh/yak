// What a page makes the browser wait on before it paints, read from the head a
// person gets and the sheets it names.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { kernel } from './probe.ts'
import { lost } from './pages.ts'
import { from, plan } from './sheet-assets.ts'
import { links, named, sheeted } from './sheets.ts'
import { direct } from './wrangler.ts'

let PUBLIC = new URL('./public/', import.meta.url).pathname
let { files, names } = plan(from(PUBLIC))
let sheet = (root: string) => new TextDecoder().decode(files.get(names[root])!)

// Every sheet a head blocks on.
let blocking = (html: string) =>
  [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)]
    .map(([, href]) => href)

for (let root of ['style.css', 'pages.css']) {
  test(`sheets: ${root} holds its imports in place and fetches no other sheet`, () => {
    let css = sheet(root)
    assert(!css.includes('@import'))
    assertStringIncludes(css, '--font:')
    assertStringIncludes(css, "font-family: 'Nunito'")
    let order = ['@layer tokens, base', '--font:', 'html::after']
      .map((text) => css.indexOf(text))
    assertEquals(order, order.toSorted((a, b) => a - b))
  })

  test(`sheets: everything ${root} points at is a content-named file beside it`, () => {
    let pointed = [...sheet(root).matchAll(/url\(["']?([^"')]+)/g)]
      .map(([, target]) => target)
      .filter((target) => !target.startsWith('data:'))
    assert(pointed.length > 5)
    for (let target of pointed) {
      assert(files.has(`_yak/${target.split('#')[0]}`), target)
    }
    assertStringIncludes(sheet(root), '#line)')
  })
}

test('sheets: a name changes with the bytes and only then', () => {
  let read = (css: string) => (name: string) =>
    new TextEncoder().encode(name == 'style.css' ? css : '')
  let name = (css: string) => plan(read(css)).names['style.css']
  assertEquals(name('a{}'), name('a{}'))
  assert(name('a{}') != name('b{}'))
})

test('sheets: a head names one sheet, on this site, with the font preloaded', () => {
  let env = { APEX: 'yaks.fyi' }
  let head = sheeted('<link rel="stylesheet" href="style.css" />', env, names)
  assertEquals(blocking(head), [`https://yaks.fyi/${names['style.css']}`])
  assertStringIncludes(
    head,
    `<link rel="preload" href="https://yaks.fyi/${
      names['nunito-latin.woff2']
    }" as="font" type="font/woff2" crossorigin>`,
  )
  assertEquals(blocking(links(env, 'pages.css', names)), [
    `https://yaks.fyi/${names['pages.css']}`,
  ])
})

test('sheets: a static page, the home page and a kernel page wait on no other site', async () => {
  let k = await kernel()
  let pages = [
    await (await k.at('yaks.app', '/')).text(),
    await (await k.at('yaks.app', '/terms')).text(),
    await (await k.at('yaks.app', '/pricing')).text(),
    await (await k.at('yaks.app', '/docs')).text(),
    await lost().text(),
  ]
  for (let page of pages) {
    assertEquals(page.includes('fonts.g'), false)
    assertEquals(blocking(page).length, 1)
    assertStringIncludes(page, 'rel="preload"')
  }
})

test('sheets: a static page answers 304 to the bytes it last answered with', async () => {
  let k = await kernel()
  let first = await k.at('yaks.app', '/terms')
  await first.body?.cancel()
  let etag = first.headers.get('etag')!
  assert(etag)
  let again = await k.at('yaks.app', '/terms', {
    headers: { 'if-none-match': etag },
  })
  assertEquals(again.status, 304)
})

test('sheets: a HEAD names no etag of bytes it did not send', async () => {
  let k = await kernel()
  let head = await k.at('yaks.app', '/terms', { method: 'HEAD' })
  assertEquals(head.status, 200)
  assertEquals(head.headers.get('etag'), null)
})

test('sheets: a deploy excepts exactly the files it holds, in every environment', () => {
  let config = direct(
    { assets: {}, env: { staging: { assets: {} }, bare: {} } },
    { 'style.css': '_yak/style.0123456789.css' },
  ) as { assets: unknown; env: { staging: { assets: unknown } } }
  let first = { run_worker_first: ['/*', '!/_yak/style.0123456789.css'] }
  assertEquals(config.assets, first)
  assertEquals(config.env.staging.assets, first)
})

test('sheets: an address no longer deployed goes to its source', async () => {
  assertEquals(named('/_yak/style.0123456789.css'), '/style.css')
  assertEquals(
    named('/_yak/nunito-latin.0123456789.woff2'),
    '/nunito-latin.woff2',
  )
  assertEquals(named('/style.css'), null)
  let k = await kernel()
  let held = await k.at('yaks.app', '/_yak/style.0123456789.css', {
    redirect: 'manual',
  })
  assertEquals(held.status, 302)
  assertEquals(held.headers.get('location'), 'https://yaks.app/style.css')
  let gone = await k.at('yaks.app', '/_yak/nothing.css')
  assertEquals(gone.status, 404)
  await gone.body?.cancel()
})

test('sheets: what is content-named is marked immutable and readable from a space', () => {
  let rules = Deno.readTextFileSync(`${PUBLIC}_headers`)
  assertStringIncludes(rules, '/_yak/*')
  assertStringIncludes(rules, 'immutable')
  assertStringIncludes(rules, 'Access-Control-Allow-Origin: *')
})
