/// <reference lib="deno.ns" />
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import type { Filter } from './route.ts'
import { handler } from './routes.ts'
import { fake, req, shopGraph } from './testing.ts'
import { Refused } from '@yaks/graph/errors'
import { type Asker, asker, installAsker } from '@yaks/graph/asker'
import { AsyncLocalStorage } from 'node:async_hooks'

class Denied extends Error {
  override name = 'Denied'
}

// A host with one route at `/hello`, behind `filters`, whose sockets are
// `sockets`.
let sockets: ReturnType<typeof fake>[] = []
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
  }, {
    upgrade: () => {
      let socket = fake()
      sockets.push(socket)
      return { socket, response: new Response(null, { status: 101 }) }
    },
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
  assertEquals(await status(h, '/query?q=.book.price'), 200)
  assertEquals(asked, ['/hello', '/query'])
})

test('a socket a filter refuses opens, and answers each subscription with the refusal', async () => {
  let h = host([(r) => {
    if (new URL(r.url).pathname == '/ws') throw new Refused('reload it')
  }])
  let res = await h(
    new Request('http://box.test/ws', { headers: { upgrade: 'websocket' } }),
  )
  assertEquals(res.status, 101)
  let socket = sockets.at(-1)!
  socket.emit('message', JSON.stringify({ subscribe: '.book', id: 's1' }))
  assertEquals(socket.taken(), [{
    id: 's1',
    refused: { error: 'Refused', message: 'reload it' },
  }])
})

test('a socket a filter denies is answered as any request is', async () => {
  let h = host([() => {
    throw new Denied('not you')
  }])
  let res = await h(
    new Request('http://box.test/ws', { headers: { upgrade: 'websocket' } }),
  )
  assertEquals(res.status, 403)
})

test('with no filter, every route and door answers as before', async () => {
  let h = host([])
  assertEquals(await (await h(req('/hello'))).text(), 'hi')
  assertEquals(await status(h, '/query?q=.book.price'), 200)
  assertEquals(await status(h, '/nowhere'), 404)
})

test('a GET route answers a HEAD with its headers and no body', async () => {
  let res = await host([])(req('/hello', { method: 'HEAD' }))
  assertEquals([res.status, await res.text()], [200, ''])
})

test('an HTTP route answers while a graph read is pending', async () => {
  let graph = shopGraph()
  let slow = Promise.withResolvers<Awaited<ReturnType<typeof graph.read>>>()
  let called = false
  let h = handler({
    graph: {
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

let brokenRequest = (() => {
  let graph = shopGraph()
  let disk = new Error('disk gone'), boom = new Error('boom')
  let reported: { told: [Bundle, unknown][] } = { told: [] }
  let h = handler({
    graph: { ...graph, read: () => Promise.reject(disk) },
    who: () => null,
    routes: [
      { method: 'GET', path: '/hello', handle: () => new Response('hi') },
      {
        method: 'GET',
        path: '/boom/*',
        handle: () => Promise.reject(boom),
      },
    ],
    report: (err, context) => {
      assertEquals(context?.during?.request, context?.request?.entity.eid)
      reported.told.push([context!.request!, err])
    },
  })
  return { h, reported }
})()

test('a request that broke is answered with its id and reported once', async () => {
  let { h, reported } = brokenRequest
  assertEquals((await h(req('/hello'))).headers.get('x-request-id'), null)
  assertEquals(reported.told, [])
  for (
    let [path, route, message] of [
      ['/boom/x?secret=1', '/boom/*', 'boom'],
      ['/query?q=.book', '/query', 'disk gone'],
    ]
  ) {
    reported.told = []
    let res = await h(req(path, { headers: { 'user-agent': 'curl/8.5.0' } }))
    assertEquals(res.status, 500)
    assertEquals(reported.told.length, 1)
    let [[b, err]] = reported.told
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

// Whatever a request starts answers who asked it, as a host's task-local
// carrier keeps it: the route it came through and the page that sent it (its
// path alone), and a socket's subscription the page it says it came from.
test('a read answers the door and page that asked it', async () => {
  let local = new AsyncLocalStorage<Asker | undefined>()
  let restore = installAsker({
    get: () => local.getStore(),
    run: (who, work) => local.run(who, work),
  })
  let asked: (Asker | undefined)[] = []
  let graph = shopGraph()
  let h = handler({
    graph: {
      ...graph,
      read: (q, o) => (asked.push(asker()), graph.read(q, o)),
    },
    who: () => null,
    routes: [],
  }, {
    upgrade: () => {
      let socket = fake()
      sockets.push(socket)
      return { socket, response: new Response(null, { status: 101 }) }
    },
  })
  try {
    let from = { referer: 'http://shop.test/P-19?token=secret' }
    await h(req('/query?q=.book', { headers: from }))
    await h(req('/ws', { headers: { upgrade: 'websocket' } }))
    sockets.at(-1)!.emit(
      'message',
      JSON.stringify({ subscribe: '.book', id: 's1', page: '/P-7' }),
    )
    await new Promise((done) => setTimeout(done, 0))
    assertEquals(asked, [
      { door: '/query', page: '/P-19' },
      { door: '/ws', page: '/P-7' },
    ])
  } finally {
    restore()
  }
})
