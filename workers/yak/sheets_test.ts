// What a page makes the browser wait on before it paints, read from the head a
// person gets and the sheets it names.
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from '@std/assert'
import { test } from '@yaks/testing'
import { halved } from '@yaks/ui'
import { kernel } from './probe.ts'
import { lost } from './pages.ts'
import { parseHTML } from 'linkedom'
import { FILES, from, plan } from './sheet-assets.ts'
import { asset, links, named, sheeted } from './sheets.ts'
import { direct } from './wrangler.ts'

let PUBLIC = new URL('./public/', import.meta.url).pathname
let { files, names } = plan(await from(PUBLIC))
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
    let order = ['@layer tokens, base', '--font:', ':where(html)::after']
      .map((text) => css.indexOf(text))
    assertEquals(order, order.toSorted((a, b) => a - b))
  })

  test(`sheets: ${root} says every light-dark() pair again in halves`, () => {
    let css = sheet(root)
    assertStringIncludes(css, '--mine: #f8e0c8;')
    assertStringIncludes(css, '--accent: #a7c080;')
    assertEquals(halved(css), css)
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

test('sheets: a static page, the home page and a kernel page wait on no other site, and wear the favicon', async () => {
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
    assertEquals(page.match(/rel="icon"/g)?.length, 1)
    assertStringIncludes(page, 'favicon-32.png')
  }
})

test('sheets: each file the pages name is kept under a name of its bytes, as it is', () => {
  for (let file of FILES) {
    assertMatch(names[file], /^_yak\/.+\.[0-9a-f]{10}\.\w+$/)
    assertEquals(files.get(names[file]), Deno.readFileSync(`${PUBLIC}${file}`))
    assertEquals(named(`/${names[file]}`), `/${file}`)
  }
  assertEquals(
    asset({}, 'drop.js', names),
    `https://yaks.app/${names['drop.js']}`,
  )
  assertEquals(asset({}, 'og.png', names), 'https://yaks.app/og.png')
})

// The addresses of the site's own files a page leaves with.
let fetched = (html: string) => {
  let { document } = parseHTML(html)
  return [...document.querySelectorAll('script[src], link[href]')]
    .map((el) => el.getAttribute('src') ?? el.getAttribute('href')!)
    .filter((at) => !/^https?:/.test(at) || at.startsWith('https://yaks.app/'))
    .filter((at) => /\.(?:js|css|png|woff2)$/.test(at))
}

test('sheets: a static page names every file of the site it fetches by its bytes', () => {
  let page = '<link rel="apple-touch-icon" href="apple-touch-icon.png" />' +
    '<link rel="stylesheet" href="style.css" />' +
    '<script src=\'idle.js\' defer></script><script src="/cta.js"></script>' +
    '<a href="pricing">Pricing</a><script src="nothing.js"></script>'
  let served = sheeted(page, {}, names)
  assertEquals(
    fetched(served).toSorted(),
    [
      ...['report.js', 'favicon-32.png', 'nunito-latin.woff2', 'style.css']
        .concat(['apple-touch-icon.png', 'idle.js', 'cta.js'])
        .map((name) => `https://yaks.app/${names[name]}`),
      'nothing.js',
    ].toSorted(),
  )
  assertStringIncludes(served, '<a href="pricing">')
})

test('sheets: what the pages fetch of the site is all named by its bytes', async () => {
  let k = await kernel()
  let pages = await Promise.all(
    ['/', '/pricing', '/style-guide', '/docs', '/gallery', '/login']
      .map(async (path) => await (await k.at('yaks.app', path)).text()),
  )
  for (let page of [...pages, await lost().text()]) {
    for (let at of fetched(page)) {
      let file = at.replace(/^https:\/\/yaks\.app\//, '').replace(/^\//, '')
      assert(names[file] || file.startsWith('_yak/'), `${file} is not named`)
    }
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

test('sheets: a HEAD names the etag of the bytes a GET answers with', async () => {
  let k = await kernel()
  let get = await k.at('yaks.app', '/terms')
  await get.body?.cancel()
  let head = await k.at('yaks.app', '/terms', { method: 'HEAD' })
  assertEquals(head.status, 200)
  assert(get.headers.get('etag'))
  assertEquals(head.headers.get('etag'), get.headers.get('etag'))
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
