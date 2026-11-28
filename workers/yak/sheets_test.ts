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
import { plan, reading } from '@yaks/web/assets'
import { ASSETS } from './assets.ts'
import { PUBLIC, readAsset } from './site-assets-probe.ts'
import { kit } from './sheet-assets.ts'
import { asset, assetFile, client, links, named, sheeted } from './sheets.ts'
import { direct } from './wrangler.ts'
import { dataAsset } from './web.ts'

let disk = reading(PUBLIC.pathname)
let made = new Map(
  await Promise.all(
    [...ASSETS, ...await kit()].filter(({ bundle, body, file, name }) =>
      bundle || body || file || name == '_words.js'
    ).map(async ({ name }) =>
      [
        name,
        await readAsset('/' + name) ??
          new TextEncoder().encode(`fixture for ${name}`),
      ] as const
    ),
  ),
)
let read = (name: string) => made.get(name) ?? disk(name)
let { files, names } = plan(ASSETS, read, halved)
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

test('sheets: a head names one sheet, on this site, with the font preloaded', () => {
  let env = { APEX: 'yaks.fyi' }
  let head = sheeted(
    '<head><script>app()</script><link rel="stylesheet" href="style.css" /></head>',
    env,
    names,
  )
  let css = `https://yaks.fyi/${names['style.css']}`
  assertEquals(blocking(head), [css])
  assert(head.startsWith(`<head><link rel="preload" as="style" href="${css}">`))
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

test('sheets: a mounted skin keeps content-named filters on a space or custom origin', async () => {
  let env = {
    ASSETS: {
      fetch: (req: Request) => {
        let bytes = files.get(new URL(req.url).pathname.slice(1))
        return Promise.resolve(
          new Response(bytes ? new Uint8Array(bytes) : null, {
            status: bytes ? 200 : 404,
          }),
        )
      },
    },
  }
  for (
    let [origin, mount] of [
      ['https://ada.yaks.app', '/recipes/_web/assets/'],
      ['https://recipes.example', '/_web/assets/'],
    ]
  ) {
    let head = links({}, 'pages.css', names, mount)
    let sheet = new URL(blocking(head)[0], origin)
    assertEquals(sheet.pathname, mount + names['pages.css'])
    let get = (at: URL) =>
      dataAsset(
        new Request(at),
        env,
        at.pathname.slice(mount.length),
      )
    let res = await get(sheet)
    assertEquals(res.status, 200)
    let css = await res.text()
    assertEquals(css, new TextDecoder().decode(files.get(names['pages.css'])!))
    let drawn = css.match(/--drawn:\s*url\(['"]?([^'"\s)]+)/)![1]
    let pencil = new URL(drawn, sheet)
    assertEquals(pencil.origin, origin)
    let svg = await get(pencil)
    assertEquals(svg.status, 200)
    assertStringIncludes(await svg.text(), '<filter id="line"')
    let past = new URL(mount + '_yak/pages.0000000000.css', origin)
    let redirected = await get(past)
    assertEquals(redirected.status, 302)
    assertEquals(
      redirected.headers.get('location'),
      origin + mount + 'pages.css',
    )
  }
})

test('a stylesheet from a previous deploy answers flattened without a redirect or immutable cache', async () => {
  let old = new Request('https://yaks.app/_yak/pages.0000000000.css')
  let assets = {
    fetch: (req: Request) => {
      let held = files.get(new URL(req.url).pathname.slice(1))
      return Promise.resolve(
        held
          ? new Response(new Uint8Array(held), {
            headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          })
          : new Response(null, { status: 404 }),
      )
    },
  }
  let page = await assetFile(old, assets, names)
  assertEquals(page.status, 200)
  assertEquals(page.headers.get('cache-control'), 'no-store')
  assertEquals(await page.text(), sheet('pages.css'))
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
  assert(!pages[0].includes('_dates.js'))
  assertStringIncludes(pages[1], '_dates.js')
  for (let page of pages) {
    assertEquals(page.includes('fonts.g'), false)
    assertEquals(blocking(page).length, 1)
    assertStringIncludes(page, 'rel="preload"')
    assertEquals(page.match(/rel="icon"/g)?.length, 1)
    assertStringIncludes(page, 'favicon-32.png')
  }
})

test('sheets: each file the pages name is kept under a name of its bytes, as it is', () => {
  let kept = ASSETS.filter((a) => a.named && !a.name.endsWith('.css'))
  for (let { name: file } of kept) {
    assertMatch(names[file], /^_yak\/.+\.[0-9a-f]{10}\.\w+$/)
    assertEquals(files.get(names[file]), read(file))
    assertEquals(named(`/${names[file]}`), `/${file}`)
  }
  assertEquals(
    asset({}, 'drop.js', names),
    `https://yaks.app/${names['drop.js']}`,
  )
  assertEquals(asset({}, 'og.png', names), 'https://yaks.app/og.png')
  assertMatch(client(names)!, /^client\.[0-9a-f]{10}\.js$/)
  assertEquals(client({}), null)
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
        .concat([
          'apple-touch-icon.png',
          'idle.js',
          'cta.js',
          '_interaction.js',
        ])
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

test('sheets: every environment serves the shared chunk namespace and current named files directly', () => {
  let config = direct(
    { assets: {}, env: { staging: { assets: {} }, bare: {} } },
    ['_yak/style.0123456789.css'],
  ) as { assets: unknown; env: { staging: { assets: unknown } } }
  let first = {
    run_worker_first: [
      '/*',
      '!/_yak/chunk.*.js',
      '!/_yak/style.0123456789.css',
    ],
  }
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
  let rules = Deno.readTextFileSync(new URL('_headers', PUBLIC))
  assertStringIncludes(rules, '/_yak/*')
  assertStringIncludes(rules, 'immutable')
  assertStringIncludes(rules, 'Access-Control-Allow-Origin: *')
})
