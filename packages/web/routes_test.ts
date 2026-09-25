import './testing.ts'
import { assertEquals } from '@std/assert'
import { type Route, routed } from '@yaks/api'
import { handler } from '@yaks/api/routes'
import { aliasDoc, aliases } from '@yaks/alias'
import { docDoc } from '@yaks/doc'
import { graph as open } from '@yaks/graph'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { ram } from '@yaks/ram'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { taskDoc } from '@yaks/task'
import { loadVocab } from '@yaks/vocab'
import { letters, routes } from './routes.ts'

let vocab = loadVocab([kernelDoc, docDoc, taskDoc, keyDoc, aliasDoc], [
  kernelKeywords,
  keyKeywords,
])
let graph = open({
  storage: ram(vocab),
  vocab,
  plugins: [keys(vocab), aliases()],
})
await graph.apply([
  { entity: { eid: '$r' }, alias: { name: 'lemon-cake' }, doc: { title: 'x' } },
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

Deno.test('every id letter the vocabulary uses has a route, in both cases', () => {
  let ls = letters(vocab)
  for (let l of ['T', 't', 'D', 'd']) assertEquals(ls.includes(l), true, l)
  for (
    let path of [
      '/',
      '/T-9',
      '/t-9',
      '/T',
      '/T%23abc123',
      '/D-3',
      '/admin/task',
    ]
  ) {
    assertEquals(reached(path)?.method, 'GET', path)
  }
})

Deno.test('the doors and the other plugins keep their paths', async () => {
  assertEquals((await get('/query')).status, 400)
  assertEquals(await (await get('/mcp')).text(), 'mcp')
})

Deno.test('a name opens the page, and a path naming nothing is the 404 page', async () => {
  let page = async (path: string) => {
    let r = await get(path)
    return [r.status, (await r.text()).includes('src="/web/app.js"')]
  }
  assertEquals(await page('/lemon-cake'), [200, true])
  assertEquals(await page('/T-9'), [200, true])
  for (let path of ['/lemon-pie', '/lemon-cake/x', '/favicon.ico']) {
    assertEquals(await page(path), [404, true], path)
  }
})

Deno.test('every address answers the one page, which loads the bundled app', async () => {
  let page = await reached('/T-9')!.handle(new Request('http://x/T-9'))
  assertEquals(page.headers.get('content-type'), 'text/html; charset=utf-8')
  assertEquals((await page.text()).includes('src="/web/app.js"'), true)
})

Deno.test('the vocabulary is served with a tag the browser revalidates', async () => {
  let get = (headers: HeadersInit = {}) =>
    reached('/web/vocab.json')!.handle(
      new Request('http://x/web/vocab.json', { headers }),
    )
  let first = await get()
  assertEquals(JSON.parse(await first.text()).length, vocab.docs.length)
  let tag = first.headers.get('etag')!
  assertEquals((await get({ 'if-none-match': tag })).status, 304)
})
