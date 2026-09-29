import { test } from '@yaks/testing'
import './testing.ts'
import { assertEquals } from '@std/assert'
import { type Route, routed } from '@yaks/api'
import { handler } from '@yaks/api/routes'
import { aliasDoc, aliases } from '@yaks/alias'
import { docDoc } from '@yaks/doc'
import { graph as open } from '@yaks/graph'
import { human } from '@yaks/id'
import { ids } from '@yaks/id/rules'
import { idDoc } from '@yaks/id/vocab'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { ram } from '@yaks/ram'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { taskDoc } from '@yaks/task'
import { loadVocab } from '@yaks/vocab'
import { letters, routes } from './routes.ts'

let vocab = loadVocab([kernelDoc, docDoc, taskDoc, keyDoc, aliasDoc, idDoc], [
  kernelKeywords,
  keyKeywords,
])
let graph = open({
  storage: ram(vocab, { number: true }),
  vocab,
  plugins: [keys(vocab), aliases(), ids(vocab)],
})
await graph.apply([
  { entity: { eid: '$r' }, alias: { name: 'lemon-cake' }, doc: { title: 'x' } },
  {
    entity: { eid: 'a83446de-17c9-45df-8f57-719b4102667d' },
    doc: { title: 'session link' },
  },
  {
    entity: { eid: '0123456789abcdef0123456789abcdef01234567' },
    doc: { title: 'sha address' },
  },
  { entity: { eid: 'kindless' }, favorite: {} },
])
let table = routes({ vocab, graph })

let reached = (path: string): Route | undefined =>
  table.find((r) => routed(r, 'GET', path) && r.path != '/*')

// The host's handler over these routes and one other plugin's.
let host = handler({
  graph,
  who: () => null,
  routes: [...table, {
    method: '*',
    path: '/mcp',
    handle: () => new Response('mcp'),
  }],
})
let get = (path: string) => host(new Request(`http://x${path}`))

test('every id letter the vocabulary uses has a route, in both cases', () => {
  let ls = letters(vocab)
  for (let l of ['T', 't', 'D', 'd']) assertEquals(ls.includes(l), true, l)
  for (
    let path of [
      '/',
      '/T-9',
      '/t-9',
      '/T',
      '/%23abc123',
      '/D-3',
      '/admin/task',
    ]
  ) {
    assertEquals(reached(path)?.method, 'GET', path)
  }
})

test('the doors and the other plugins keep their paths', async () => {
  assertEquals((await get('/query')).status, 400)
  assertEquals(await (await get('/mcp')).text(), 'mcp')
})

test('a name opens the page, and a path naming nothing is the 404 page', async () => {
  let page = async (path: string) => {
    let r = await get(path)
    return [r.status, (await r.text()).includes('src="/web/app.js"')]
  }
  assertEquals(await page('/lemon-cake'), [200, true])
  assertEquals(await page('/%23a83446de17'), [200, true])
  assertEquals(await page('/a83446de17'), [200, true])
  assertEquals(await page('/0123456789abcdef0123456789abcdef01234567'), [
    200,
    true,
  ])
  assertEquals(await page('/T-9'), [200, true])
  for (
    let path of ['/lemon-pie', '/lemon-cake/x', '/favicon.ico', '/T%23abc123']
  ) {
    assertEquals(await page(path), [404, true], path)
  }
})

test('a kindless entity opens at the id the page displays', async () => {
  let [row] = await graph.get(['kindless'])
  let id = human(vocab)(row)
  assertEquals(id.startsWith('E-'), true)
  assertEquals((await graph.address([id])).get(id), row.entity.eid)
  assertEquals((await get(`/${id}`)).status, 200)
})

test('every address answers the one page, which loads the bundled app', async () => {
  let page = await reached('/T-9')!.handle(new Request('http://x/T-9'))
  assertEquals(page.headers.get('content-type'), 'text/html; charset=utf-8')
  assertEquals((await page.text()).includes('src="/web/app.js"'), true)
})

test('the vocabulary is served with a tag the browser revalidates', async () => {
  let get = (headers: HeadersInit = {}) =>
    reached('/web/vocab.json')!.handle(
      new Request('http://x/web/vocab.json', { headers }),
    )
  let first = await get()
  assertEquals(JSON.parse(await first.text()).length, vocab.docs.length)
  let tag = first.headers.get('etag')!
  assertEquals((await get({ 'if-none-match': tag })).status, 304)
})
