/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import type { Filter } from './route.ts'
import { handler } from './routes.ts'
import { req, shopGraph } from './testing.ts'

class Denied extends Error {
  override name = 'Denied'
}

// A host with one route at `/hello`, behind `filters`.
let host = (filters: Filter[]) =>
  handler({
    graph: shopGraph(),
    who: () => null,
    routes: [{
      method: 'GET',
      path: '/hello',
      handle: () => new Response('hi'),
    }],
    filters,
  })

let status = async (h: ReturnType<typeof host>, path: string) =>
  (await h(req(path))).status

test('a filter that throws answers the request, and nothing behind it runs', async () => {
  let asked: string[] = []
  let h = host([
    (r) => void asked.push(new URL(r.url).pathname),
    (r) => {
      if (new URL(r.url).pathname == '/hello') throw new Denied('not you')
    },
  ])
  let res = await h(req('/hello'))
  assertEquals(res.status, 403)
  assertEquals((await res.json()).message, 'not you')
  assertEquals(await status(h, '/query?q=.price'), 200)
  assertEquals(asked, ['/hello', '/query'])
})

test('with no filter, every route and door answers as before', async () => {
  let h = host([])
  assertEquals(await (await h(req('/hello'))).text(), 'hi')
  assertEquals(await status(h, '/query?q=.price'), 200)
  assertEquals(await status(h, '/nowhere'), 404)
})

test('an HTTP route answers while the graph reader is busy', async () => {
  let graph = shopGraph()
  let slow = Promise.withResolvers<Awaited<ReturnType<typeof graph.read>>>()
  let called = false
  let h = handler({
    graph,
    reader: {
      ...graph,
      read: () => {
        called = true
        return slow.promise
      },
    },
    who: () => null,
    routes: [{
      method: 'GET',
      path: '/hello',
      handle: () => new Response('hi'),
    }],
  })
  let waiting = h(req('/query?q=.book'))
  assertEquals(await (await h(req('/hello'))).text(), 'hi')
  assertEquals(called, true)
  slow.resolve([])
  assertEquals(await (await waiting).json(), [])
})

test('a request that broke is answered with its id and reported once', async () => {
  let graph = shopGraph()
  let told: [Bundle, unknown][] = []
  let h = handler({
    graph,
    reader: { ...graph, read: () => Promise.reject(new Error('disk gone')) },
    who: () => null,
    routes: [
      { method: 'GET', path: '/hello', handle: () => new Response('hi') },
      {
        method: 'GET',
        path: '/boom/*',
        handle: () => Promise.reject(new Error('boom')),
      },
    ],
    report: (b, err) => void told.push([b, err]),
  })
  assertEquals((await h(req('/hello'))).headers.get('x-request-id'), null)
  assertEquals(told, [])
  for (
    let [path, route, message] of [
      ['/boom/x?secret=1', '/boom/*', 'boom'],
      ['/query?q=.book', '/query', 'disk gone'],
    ]
  ) {
    told = []
    let res = await h(req(path, { headers: { 'user-agent': 'curl/8.5.0' } }))
    assertEquals(res.status, 500)
    assertEquals(told.length, 1)
    let [[b, err]] = told
    assertEquals(b.entity.eid, res.headers.get('x-request-id'))
    assertEquals((err as Error).message, message)
    let { ms: _, ...rest } = b.request as Record<string, unknown>
    assertEquals(rest, {
      method: 'GET',
      url: `http://shop.test${path.split('?')[0]}`,
      route,
      status: 500,
      agent: 'curl 8.5.0',
    })
  }
})
