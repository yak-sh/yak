/// <reference lib="deno.ns" />
// The socket half: the two verbs a client sends, the frames that come back,
// and the `/ws` route that wires one to a graph through the host's upgrade.

import { assert, assertEquals } from '@std/assert'
import { fake, req, shopGraph } from './harness.ts'
import { api } from './route.ts'
import { attach } from './socket.ts'
import { subscriptions } from './subs.ts'

let ids = (frames: { bundles?: { entity: { eid: string } }[] }[]) =>
  frames.flatMap((f) => (f.bundles ?? []).map((b) => b.entity.eid))

let ws = () => req('/ws', { headers: { upgrade: 'websocket' } })

Deno.test('a socket subscribes, hears its set, and hears every change', () => {
  let graph = shopGraph()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let socket = fake()
  attach(subscriptions(graph), socket)

  socket.emit('message', JSON.stringify({ subscribe: '.price<20', id: 'c' }))
  assertEquals(ids(socket.taken()), ['b1'])

  graph.apply([{ entity: { eid: 'b2' }, book: { price: 9 } }])
  assertEquals(ids(socket.taken()), ['b2'])

  // and nothing the query does not select
  graph.apply([{ entity: { eid: 'b3' }, book: { price: 99 } }])
  assertEquals(socket.taken(), [])
})

Deno.test('unsubscribe stops one, closing stops them all', () => {
  let graph = shopGraph()
  let socket = fake()
  attach(subscriptions(graph), socket)

  socket.emit('message', JSON.stringify({ subscribe: '.price<20', id: 'c' }))
  socket.emit('message', JSON.stringify({ subscribe: true, id: 'all' }))
  socket.taken()

  socket.emit('message', JSON.stringify({ unsubscribe: 'c' }))
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  assertEquals(socket.taken().map((f) => f.id), ['all'])

  socket.emit('close')
  graph.apply([{ entity: { eid: 'b2' }, book: { price: 9 } }])
  assertEquals(socket.taken(), [])
})

Deno.test('frames sent before the socket opens are held for it', () => {
  let graph = shopGraph()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let socket = fake()
  socket.readyState = 0
  attach(subscriptions(graph), socket)

  socket.emit('message', JSON.stringify({ subscribe: '.price<20', id: 'c' }))
  assertEquals(socket.sent, [])

  socket.readyState = 1
  socket.emit('open')
  assertEquals(ids(socket.taken()), ['b1'])
})

Deno.test('a frame the server cannot read is refused', () => {
  let graph = shopGraph()
  let socket = fake()
  attach(subscriptions(graph), socket)

  socket.emit('message', 'not json')
  socket.emit('message', JSON.stringify({ hello: true, id: 'x' }))
  let said = socket.taken()
  assertEquals(said.map((f) => f.id), ['', 'x'])
  assert(said.every((f) => f.refused))
})

Deno.test('/ws upgrades through the host and serves that socket', async () => {
  let graph = shopGraph()
  let socket = fake()
  let handler = api({
    graph,
    upgrade: () => ({ socket, response: new Response(null, { status: 101 }) }),
  })

  let r = await handler(ws())
  assertEquals(r.status, 101)

  socket.emit('message', JSON.stringify({ subscribe: '.price<20', id: 'c' }))
  assertEquals(ids(socket.taken()), [])

  await handler(req('/apply', {
    method: 'POST',
    body: JSON.stringify([{ entity: { eid: 'b1' }, book: { price: 12 } }]),
  }))
  assertEquals(ids(socket.taken()), ['b1'])
})
