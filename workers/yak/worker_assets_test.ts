// What a page an app's worker made loads of the release's files is kept by
// the browser for good, as a file page's loads are (T-3170): its fonts,
// pictures and icon move to the release's address, its stylesheet's too, and
// what the worker answers with a validator is answered 304 when held.
import { cleanup, equal, test } from '@yaks/testing'
import { assertMatch } from '@std/assert'
import { digest } from '@yaks/graph/sha256'
import { KERNEL } from './meta.ts'
import { connector, seed, unique } from './probe.ts'
import { serverSource, workerKernel } from './worker-probe.ts'

let worker = 'data:text/javascript,' + encodeURIComponent(`export default {
  fetch: async (req, env) => {
    let url = new URL(req.url)
    let mount = req.headers.get('x-yak-mount') ?? '/' + req.headers.get('x-yak-app') + '/'
    let path = '/' + url.pathname.slice(mount.length)
    let text = (body, type) =>
      new Response(body, { headers: { 'content-type': type } })
    if (path == '/made') {
      return text('<link rel="icon" href="icon.svg">' +
        '<link rel="preload" as="font" href="fonts/f.ttf">' +
        '<link rel="stylesheet" href="look.css">' +
        '<link rel="stylesheet" href="private.css">' +
        '<img src="' + new URL('art/p.svg', url).href + '"><img src="drawn.png"><a href="art/p.svg">p</a>',
        'text/html')
    }
    if (path == '/studio') {
      return text('<base href="' + mount + 'styles/">' +
        '<link rel="stylesheet" href="studio.css">', 'text/html')
    }
    if (path == '/home-page') {
      let icon = new URL(mount + 'icon.svg', url)
      return text('<link rel="icon" href="' + icon.href + '">', 'text/html')
    }
    if (path == '/public-files') {
      return text('<link rel="stylesheet" href="theme/kit.css">' +
        '<link rel="stylesheet" href="owner.css">', 'text/html')
    }
    if (path == '/theme/kit.css') throw new Error('dispatch should not run for this file')
    if (path == '/look.css') {
      return text("@font-face{src:url('fonts/f.ttf')}" +
        '.x{background:url(drawn.png)}', 'text/css')
    }
    if (path == '/private.css') return new Response('.p{}', {
      headers: { 'content-type': 'text/css', 'cache-control': 'private, no-store' },
    })
    if (path.startsWith('/images/')) {
      let access = req.headers.get('cookie')?.includes('photos=allowed')
      if (!access) return new Response('Passcode required', { status: 403 })
      let file = await env.FILES.fetch(path)
      let headers = {
        'content-type': file.headers.get('content-type'),
        'cache-control': 'private, max-age=3600',
      }
      if (path == '/images/dynamic.svg') {
        await file.body?.cancel()
        return new Response('<svg>drawn</svg>', { headers })
      }
      return new Response(file.body, { status: file.status, headers })
    }
    if (path == '/styles/studio.css') return env.FILES.fetch(path)
    if (path.startsWith('/fonts/') || path == '/icon.svg' || path == '/icon.png') {
      return env.FILES.fetch(path)
    }
    if (path == '/drawn.png') {
      return new Response('drawn', {
        headers: { 'content-type': 'image/png', 'cache-control': 'max-age=300' },
      })
    }
    return new Response(null, { status: 404 })
  },
}`)
// A 1×1 picture, as an app's icon.png must decode.
let PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
let k = await workerKernel(new URL(worker))
cleanup(() => k.stop())

let space = unique('kept')
let { cookie } = await seed(k, [{ slug: space, apps: ['made', 'front'] }])
let agent = connector(k, cookie)
let host = `${space}.yaks.app`
await agent.tool('app_files', {
  space,
  app: 'made',
  files: [
    serverSource,
    { path: 'icon.svg', content: '<svg/>' },
    { path: 'fonts/f.ttf', content: 'font bytes' },
    { path: 'art/p.svg', content: '<svg>art</svg>' },
    { path: 'views.js', content: 'export let view = 1' },
  ],
})
await agent.tool('app_deploy', { space, app: 'made' })
await agent.tool('app_files', {
  space,
  app: 'front',
  files: [
    serverSource,
    { path: 'icon.svg', content: '<svg/>' },
    { path: 'styles/studio.css', content: '.front{}' },
  ],
})
await agent.tool('app_deploy', { space, app: 'front' })
let customHost = `${space}.example`
await agent.tool('app_new', {
  space,
  slug: 'gated',
  title: 'Gated',
  access: 'private',
})
await agent.tool('app_files', {
  space,
  app: 'gated',
  files: [
    serverSource,
    { path: 'wrangler.jsonc', content: '{"assets":{"public":["theme/"]}}' },
    { path: 'theme/kit.css', content: '.kit{}' },
    { path: 'owner.css', content: '.owner{}' },
    { path: 'icon.png', base64: PNG },
    { path: 'fonts/f.ttf', content: 'gated font' },
    { path: 'images/photo.svg', content: '<svg>photo</svg>' },
    { path: 'images/dynamic.svg', content: '<svg>file</svg>' },
    {
      path: 'styles/studio.css',
      content: "@font-face{src:url('../fonts/f.ttf')}",
    },
  ],
})
await agent.tool('app_deploy', { space, app: 'gated' })
let placed = (await k.dir.space(space))!
let app = (await k.dir.app(placed, 'gated'))!
let front = (await k.dir.app(placed, 'front'))!
await k.dir.apply({
  entities: [{
    entity: { eid: crypto.randomUUID() },
    hostname: { name: customHost, serves: app.eid, stage: 'active' },
  }, { entity: { eid: front.eid }, home: {} }],
}, KERNEL)
let at = (path: string, init: RequestInit = {}) => k.at(host, path, init)
let release = (path: string) =>
  new RegExp(`/made/api/assets/[0-9a-f]{64}/${path}`)

test("a worker's page names release files by their hashes", async () => {
  let html = await (await at('/made/made')).text()
  assertMatch(
    html,
    new RegExp(`<link rel="icon" href="${release('icon.svg').source}"`),
  )
  assertMatch(
    html,
    new RegExp(`as="font" href="${release('fonts/f.ttf').source}"`),
  )
  assertMatch(html, new RegExp(`<img src="${release('art/p.svg').source}"`))
  assertMatch(html, /href="look.css"/)
  assertMatch(html, /href="private.css"/)
  assertMatch(html, /<img src="drawn.png">/)
  assertMatch(html, /<a href="art\/p.svg">/)
  // And it wears the platform's reporter, as every page does.
  assertMatch(html, /data-yak-version/)
})

test('a worker links a release stylesheet relative to its page base', async () => {
  for (let [domain, mount] of [[host, '/gated/'], [customHost, '/']]) {
    let html = () => k.at(domain, mount + 'studio').then((res) => res.text())
    let link = (markup: string) => markup.match(/href="([^"]+\.css)"/)![1]
    let url = link(await html())
    assertMatch(
      url,
      new RegExp(`^${mount}api/assets/[a-f0-9]{64}/styles/studio\\.css$`),
    )
    let file = await k.at(domain, url)
    equal(file.status, 200)
    equal(
      file.headers.get('cache-control'),
      'private, max-age=31536000, immutable',
    )
    let css = await file.text()
    let font = new URL(
      css.match(/url\('([^']+)'\)/)![1],
      'https://' + domain + url,
    )
    assertMatch(
      font.pathname,
      new RegExp(`^${mount}api/assets/[a-f0-9]{64}/fonts/f\\.ttf$`),
    )
    let bytes = await k.at(domain, font.pathname)
    equal(await bytes.text(), 'gated font')
    equal(
      bytes.headers.get('cache-control'),
      'private, max-age=31536000, immutable',
    )
    equal(link(await html()), url)
  }
})

test('a worker-served release icon at its bare address leads to its fingerprint', async () => {
  let icon = await at('/made/icon.svg', {
    headers: { 'sec-fetch-dest': 'image' },
  })
  equal(icon.status, 307)
  let location = icon.headers.get('location')!
  assertMatch(location, release('icon.svg'))
  let named = await at(location)
  equal(await named.text(), '<svg/>')
  equal(
    named.headers.get('cache-control'),
    'public, max-age=31536000, immutable',
  )
})

test("a home app's mounted icon and stylesheet lead to their fingerprints", async () => {
  for (
    let [path, dest, body] of [
      ['icon.svg', 'image', '<svg/>'],
      ['styles/studio.css', 'style', '.front{}'],
    ]
  ) {
    let alias = await at('/front/' + path, {
      headers: { 'sec-fetch-dest': dest },
    })
    equal(alias.status, 307)
    let location = alias.headers.get('location')!
    assertMatch(location, /^\/api\/assets\/[a-f0-9]{64}\//)
    equal(await (await at(location)).text(), body)
  }
})

test('the home worker links from the root at both of its page addresses', async () => {
  let icon = /href="(\/api\/assets\/[a-f0-9]{64}\/icon\.svg)"/
  for (let path of ['/home-page', '/front/home-page']) {
    let page = await at(path)
    equal(page.status, 200)
    assertMatch(await page.text(), icon)
  }
})

test('a private release serves its public assets without dispatching', async () => {
  for (let domain of [host, customHost]) {
    let mount = domain == host ? '/gated/' : '/'
    let get = (path: string, init?: RequestInit) => k.at(domain, path, init)
    let html = await (await get(mount + 'public-files')).text()
    let kit = html.match(/href="([^"]+\/theme\/kit\.css)"/)![1]
    let owner = html.match(/href="([^"]+\/owner\.css)"/)![1]
    assertMatch(kit, /\/api\/assets\/[a-f0-9]{64}\//)
    equal((await get(mount + 'theme/kit.css')).headers.get('location'), kit)
    let css = await get(kit)
    equal(await css.text(), '.kit{}')
    equal(
      css.headers.get('cache-control'),
      'private, max-age=31536000, immutable',
    )
    equal((await get(kit, { method: 'HEAD' })).status, 200)
    equal((await get(owner)).status, 401)
    if (domain == host) {
      equal(
        await (await get(owner, { headers: { cookie } })).text(),
        '.owner{}',
      )
      equal(await (await get(kit, { headers: { cookie } })).text(), '.kit{}')
    }
  }
})

test('a file the worker passes at its bare address leads to its fingerprint', async () => {
  for (
    let [path, dest, body] of [
      ['views.js', 'script', 'export let view = 1'],
      ['art/p.svg', 'image', '<svg>art</svg>'],
    ]
  ) {
    let asset = await at('/made/' + path, {
      headers: { 'sec-fetch-dest': dest },
    })
    equal(asset.status, 307)
    let location = asset.headers.get('location')!
    assertMatch(location, release(path))
    let named = await at(location)
    equal(await named.text(), body)
    equal(
      named.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
    )
  }
})

test("a worker's stylesheet names the release's fonts by their hashes", async () => {
  let css = await at('/made/look.css')
  let sheet = await css.text()
  assertMatch(sheet, new RegExp(`url\\('${release('fonts/f.ttf').source}'\\)`))
  assertMatch(sheet, /url\(drawn\.png\)/)
  let again = await at('/made/look.css', {
    headers: { 'if-none-match': css.headers.get('etag')! },
  })
  equal(again.status, 304)
})

test('a release file is kept for good, publicly for a public app', async () => {
  let html = await (await at('/made/made')).text()
  let font = await at(html.match(release('fonts/f.ttf'))![0])
  equal(await font.text(), 'font bytes')
  equal(
    font.headers.get('cache-control'),
    'public, max-age=31536000, immutable',
  )
})

test('a file the worker hands on at its own address answers 304 when it is held', async () => {
  let font = await at('/made/fonts/f.ttf')
  equal(
    font.headers.get('cache-control'),
    'private, max-age=60, must-revalidate',
  )
  equal(await font.text(), 'font bytes')
  let held = await at('/made/fonts/f.ttf', {
    headers: { 'if-none-match': font.headers.get('etag')! },
  })
  equal(held.status, 304)
  equal(held.headers.get('cache-control'), font.headers.get('cache-control'))
  equal(await held.text(), '')
})

test('a file a page loads at an address the browser asks again is reported, once', async () => {
  let before = k.reported.length
  let load = () =>
    at('/made/drawn.png', { headers: { 'sec-fetch-dest': 'image' } })
  equal(await (await load()).text(), 'drawn')
  equal(await (await load()).text(), 'drawn')
  // Fetched by the page's own script, it is the page's data, not a load.
  await (await at('/made/fonts/f.ttf')).text()
  await k.flushReports()
  let paths = k.reported.slice(before).filter((row) => row.error)
    .map((row) => (row.error as { tags: Record<string, string> }).tags.path)
  equal(paths, ['/made/drawn.png'])
})

// However a page names the icon, it is loaded by the address that names its
// version, and kept there, even when the worker is what hands it out
// (T-3334).
test("a private app's worker hands a stranger its icon at the address a browser keeps", async () => {
  let image = { headers: { 'sec-fetch-dest': 'image' } }
  let named = ''
  for (let asked of ['/gated/icon.png', '/gated/icon.png?v=old']) {
    let moved = await at(asked, image)
    equal(moved.status, 307)
    named = moved.headers.get('location')!
    assertMatch(named, /^\/gated\/icon\.png\?v=[^&]+$/)
  }
  let icon = await at(named, image)
  equal(btoa(String.fromCharCode(...await icon.bytes())), PNG)
  equal(
    icon.headers.get('cache-control'),
    'private, max-age=31536000, immutable',
  )
})

test("a private app's worker hands a stranger its release's file, kept privately", async () => {
  let html = await (await at('/gated/made')).text()
  let url = html.match(/\/gated\/api\/assets\/[0-9a-f]{64}\/fonts\/f\.ttf/)![0]
  let font = await at(url)
  equal(await font.text(), 'gated font')
  equal(
    font.headers.get('cache-control'),
    'private, max-age=31536000, immutable',
  )
  let held = await at(url, {
    headers: { 'if-none-match': font.headers.get('etag')! },
  })
  equal(held.status, 304)
})

test('a passcode-gated worker can replace headers and still serve fingerprinted images', async () => {
  let headers = { 'sec-fetch-dest': 'image', cookie: 'photos=allowed' }
  let path = '/images/photo.svg'
  let sha = await digest('<svg>photo</svg>')
  let url = `/gated/api/assets/${sha}${path}`
  let moved = await at('/gated' + path, { headers })
  equal([moved.status, moved.headers.get('location')], [307, url])
  let named = await at(url, { headers })
  equal(
    named.headers.get('cache-control'),
    'private, max-age=31536000, immutable',
  )
  equal(await named.text(), '<svg>photo</svg>')
  let range = await at(url, { headers: { ...headers, range: 'bytes=5-9' } })
  equal([range.status, await range.text()], [206, 'photo'])
  for (let asked of ['/gated' + path, url]) {
    let denied = await at(asked)
    equal([denied.status, await denied.text()], [403, 'Passcode required'])
  }
  let dynamic = await at('/gated/images/dynamic.svg', { headers })
  equal([dynamic.status, await dynamic.text()], [200, '<svg>drawn</svg>'])
})
