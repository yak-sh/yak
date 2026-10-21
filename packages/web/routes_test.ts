import { test } from '@yaks/testing'
import '../browse/testing.ts'
import { assertEquals, assertRejects } from '@std/assert'
import { type Route, routed } from '@yaks/api'
import { handler } from '@yaks/api/routes'
import { aliasDoc, aliases } from '@yaks/alias'
import { docDoc } from '@yaks/doc'
import { type Comp, graph as open } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { human } from '@yaks/id'
import { ids } from '@yaks/id/graph'
import { idDoc } from '@yaks/id/vocab'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { ram } from '@yaks/ram'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { taskDoc } from '@yaks/task'
import { loadVocab } from '@yaks/vocab'
import type { Context } from '@yaks/tracker/report'
import { letters, routes } from './routes.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  docDoc,
  taskDoc,
  keyDoc,
  aliasDoc,
  idDoc,
], [
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
let table = routes({
  vocab,
  graph,
  config: { db: ':memory:', plugins: ['@yaks/browse'] },
})

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

// Read the fixture once; address resolution and the HTTP door remain the
// behavior checked by the test below.
let [kindless] = await graph.get(['kindless'])
let kindlessId = human(vocab)(kindless)
let kindlessRequest = new Request(`http://x/${kindlessId}`)

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
  assertEquals(kindlessId.startsWith('E-'), true)
  assertEquals(
    (await graph.address([kindlessId])).get(kindlessId),
    kindless.entity.eid,
  )
  assertEquals((await host(kindlessRequest)).status, 200)
})

test('every address answers the one page, which loads the bundled app', async () => {
  let page = await reached('/T-9')!.handle(new Request('http://x/T-9'))
  assertEquals(page.headers.get('content-type'), 'text/html; charset=utf-8')
  let html = await page.text()
  assertEquals(html.includes('src="/web/app.js"'), true)
  // The tracker's page reporter runs before it, reporting to /api/report.
  assertEquals(html.includes('<script data-yak-at="/">'), true)
})

test("a page's report reaches the host's telemetry as the owner's break", async () => {
  let said: [Error, Partial<Context> | undefined][] = []
  let door = routes({
    vocab,
    graph,
    config: { db: ':memory:', plugins: ['@yaks/browse'], person: 'lemon-cake' },
    report: (error, context) => said.push([error as Error, context]),
  }).find((r) => r.path == '/api/report')!
  let send = (body: unknown) =>
    door.handle(
      new Request('http://x/api/report', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    )
  assertEquals(
    (await send({
      message: 'x is undefined',
      stack: 'TypeError: x is undefined\n    at draw (http://x/web/app.js:9:2)',
      url: 'http://x/T-9',
      mechanism: 'onerror',
    })).status,
    204,
  )
  await send({ message: '403 /apply: no', status: 403 }) // a no it meant
  let [owner] = await graph.read('.doc.title=x')
  assertEquals(
    said.map(([e, c]) => [
      e.message,
      e.stack?.split('\n')[1].trim(),
      c?.mechanism,
      c?.tags?.request,
      c?.tags?.user_id,
    ]),
    [[
      'x is undefined',
      'at draw (http://x/web/app.js:9:2)',
      'onerror',
      'page /T-9',
      owner.entity.eid,
    ]],
  )
})

test('the page learns the configured owner by the graph address interface', async () => {
  let rs = routes({
    vocab,
    graph,
    config: { db: ':memory:', plugins: ['@yaks/browse'], person: 'lemon-cake' },
  })
  let owner = rs.find((r) => r.path == '/web/owner')!
  let response = await owner.handle(new Request('http://x/web/owner'))
  let [row] = await graph.read('.doc.title=x')
  assertEquals(await response.json(), { owner: row.entity.eid })
})

test('a graph that names no person answers no owner and refuses page writes', async () => {
  let rs = routes({
    vocab,
    graph,
    config: { db: ':memory:', plugins: ['@yaks/browse'] },
    who: () => ({ by: 'server' }),
  })
  let at = (path: string) => rs.find((r) => r.path == path)!
  let owner = await at('/web/owner').handle(new Request('http://x/web/owner'))
  assertEquals(await owner.json(), {})
  await assertRejects(
    async () =>
      await at('/web/apply').handle(
        new Request('http://x/web/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify([{ entity: { eid: 'nobody' }, doc: {} }]),
        }),
      ),
    Refused,
    'This graph names no person for its page to write as',
  )
  assertEquals(await graph.get(['nobody']), [])
})

// Resolve the owner and prepare its admitted write once, then inspect the
// stamps through the graph and retain the malformed-body refusal.
let terminal = '00000000-0000-4000-8000-000000000001'
let ownerRoutes = routes({
  vocab,
  graph,
  config: { db: ':memory:', plugins: ['@yaks/browse'], person: 'lemon-cake' },
  who: () => ({ by: 'server', via: terminal }),
})
let post = ownerRoutes.find((r) => r.path == '/web/apply')!
let [owner] = await graph.read('.doc.title=x')
let response = await post.handle(
  new Request('http://x/web/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{
      entity: { eid: 'reply' },
      doc: { body: 'My reply' },
      comment: { target: owner.entity.eid },
      $actor: { by: 'spoofed' },
    }, {
      entity: { eid: 'question' },
      task: {},
      decided: { choice: 'Train' },
    }]),
  }),
)
test('web and terminal writes are attributed to the configured owner through API admission', async () => {
  assertEquals(response.status, 200)
  let [reply, decided] = await graph.get(['reply', 'question'])
  assertEquals((reply.created as Comp)?.by, owner.entity.eid)
  assertEquals((reply.created as Comp)?.via, terminal)
  assertEquals((decided.decided as Comp)?.by, owner.entity.eid)
  await assertRejects(
    async () =>
      await post.handle(
        new Request('http://x/web/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      ),
    Error,
    '/apply takes a JSON array of bundles',
  )
})
