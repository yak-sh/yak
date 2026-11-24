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
  fetch: (req, env) => {
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
        '<link rel="mask-icon" href="badge.svg?shade=red#mask">' +
        '<img src="' + new URL('art/p.svg', url).href + '"><img src="drawn.png"><a href="art/p.svg">p</a>',
        'text/html')
    }
    if (path == '/look.css') {
      return text("@font-face{src:url('fonts/f.ttf')}" +
        '.x{background:url(drawn.png)}', 'text/css')
    }
    if (path == '/private.css') return new Response('.p{}', {
      headers: { 'content-type': 'text/css', 'cache-control': 'private, no-store' },
    })
    if (path == '/badge.svg') return text('<svg>' + url.search + '</svg>', 'image/svg+xml')
    if (path.startsWith('/fonts/') || path == '/icon.svg') return env.FILES.fetch(path)
    if (path == '/drawn.png') {
      return new Response('drawn', {
        headers: { 'content-type': 'image/png', 'cache-control': 'max-age=300' },
      })
    }
    return new Response(null, { status: 404 })
  },
}`)
let k = await workerKernel(new URL(worker))
cleanup(() => k.stop())

let space = unique('kept')
let { cookie } = await seed(k, [{ slug: space, apps: ['made'] }])
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
  ],
})
await agent.tool('app_deploy', { space, app: 'made' })
let customHost = `${space}.example`
let placed = (await k.dir.space(space))!
let app = (await k.dir.app(placed, 'made'))!
await k.dir.apply({
  entities: [{
    entity: { eid: crypto.randomUUID() },
    hostname: { name: customHost, serves: app.eid, stage: 'active' },
  }],
}, KERNEL)
await agent.tool('app_new', {
  space,
  slug: 'gated',
  title: 'Gated',
  access: 'private',
})
await agent.tool('app_files', {
  space,
  app: 'gated',
  files: [serverSource, { path: 'fonts/f.ttf', content: 'gated font' }],
})
await agent.tool('app_deploy', { space, app: 'gated' })
let at = (path: string, init: RequestInit = {}) => k.at(host, path, init)
let release = (path: string) =>
  new RegExp(`/made/api/assets/[0-9a-f]{64}/${path}`)

test("a worker's page names release files and cacheable styles and icons by their hashes", async () => {
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
  assertMatch(html, /href="\/made\/look.css\?__yak_asset=[0-9a-f]{64}"/)
  assertMatch(html, /href="private.css"/)
  assertMatch(html, /<img src="drawn.png">/)
  assertMatch(html, /<a href="art\/p.svg">/)
  // And it wears the platform's reporter, as every page does.
  assertMatch(html, /data-yak-version/)
})

test('the custom domain serves the exact named stylesheet and icon on repeat visits', async () => {
  let at = (path: string, init: RequestInit = {}) =>
    k.at(customHost, path, init)
  let html = () => at('/made').then((res) => res.text())
  let first = await html()
  let url = first.match(/href="(\/look.css\?__yak_asset=([0-9a-f]{64}))"/)!
  let file = await at(url[1])
  let sheet = await file.text()
  equal(await digest(sheet), url[2])
  equal(
    file.headers.get('cache-control'),
    'private, max-age=31536000, immutable',
  )
  assertMatch(sheet, /url\('\/api\/assets\/[0-9a-f]{64}\/fonts\/f\.ttf'\)/)
  assertMatch(await html(), new RegExp(url[2]))
  let head = await at(url[1], { method: 'HEAD' })
  equal([head.status, await head.text(), head.headers.get('etag')], [
    200,
    '',
    `"${url[2]}"`,
  ])
  let stale = await at(url[1].replace(url[2], '0'.repeat(64)))
  equal([stale.status, stale.headers.get('location')], [307, '/look.css'])
  let badge = first.match(
    /href="(\/badge\.svg\?shade=red&(?:amp;)?__yak_asset=[0-9a-f]{64})#mask"/,
  )!
  let icon = await at(badge[1].replace('&amp;', '&'))
  equal(await icon.text(), '<svg>?shade=red</svg>')
  equal(
    icon.headers.get('cache-control'),
    'private, max-age=31536000, immutable',
  )
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
  equal(await font.text(), 'font bytes')
  let held = await at('/made/fonts/f.ttf', {
    headers: { 'if-none-match': font.headers.get('etag')! },
  })
  equal(held.status, 304)
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
