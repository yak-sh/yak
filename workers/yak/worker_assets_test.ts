// What a page an app's worker made loads of the release's files is kept by
// the browser for good, as a file page's loads are (T-3170): its fonts,
// pictures and icon move to the release's address, its stylesheet's too, and
// what the worker answers with a validator is answered 304 when held.
import { cleanup, equal, test } from '@yaks/testing'
import { assertMatch } from '@std/assert'
import { connector, seed, unique } from './probe.ts'
import { serverSource, workerKernel } from './worker-probe.ts'

let worker = 'data:text/javascript,' + encodeURIComponent(`export default {
  fetch: (req, env) => {
    let path = new URL(req.url).pathname.replace(/^\\/[^/]+/, '')
    let text = (body, type) =>
      new Response(body, { headers: { 'content-type': type } })
    if (path == '/made') {
      return text('<link rel="icon" href="icon.svg">' +
        '<link rel="preload" as="font" href="fonts/f.ttf">' +
        '<link rel="stylesheet" href="look.css">' +
        '<img src="art/p.svg"><img src="drawn.png"><a href="art/p.svg">p</a>',
        'text/html')
    }
    if (path == '/look.css') {
      return text("@font-face{src:url('fonts/f.ttf')}" +
        '.x{background:url(drawn.png)}', 'text/css')
    }
    if (path.startsWith('/fonts/')) return env.FILES.fetch(path)
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
  new RegExp(`/made/api/assets/[0-9a-f-]{36}/${path}`)

test("a worker's page names the release's files by the release's address, and nothing else", async () => {
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
  // What the worker draws itself, and a link, stay where it put them.
  assertMatch(html, /<link rel="stylesheet" href="look.css">/)
  assertMatch(html, /<img src="drawn.png">/)
  assertMatch(html, /<a href="art\/p.svg">/)
})

test("a worker's stylesheet names the release's fonts by the release's address", async () => {
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
  let url = html.match(/\/gated\/api\/assets\/[0-9a-f-]{36}\/fonts\/f\.ttf/)![0]
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
