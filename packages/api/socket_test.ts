/// <reference lib="deno.ns" />
// The socket half: the two verbs a client sends, the frames that come back,
// and the `/ws` route that wires one to a graph through the host's upgrade.

import { assert, assertEquals } from '@std/assert'
import { fake, req, shopGraph } from './testing.ts'
import { api } from './route.ts'
import { attach, queue, sink } from './socket.ts'
import { subscriptions } from './subs.ts'

let ids = (frames: { bundles?: { entity: { eid: string } }[] }[]) =>
  frames.flatMap((f) => (f.bundles ?? []).map((b) => b.entity.eid))

let ws = () => req('/ws', { headers: { upgrade: 'websocket' } })

Deno.test('subscriber queue folds relay patches without crossing a data frame', () => {
  let socket = fake()
  let due: (() => void)[] = []
  let to = sink(socket, (fn) => {
    due.push(fn)
  })
  socket.bufferedAmount = 8192
  to({ id: 's', relay: [{ entity: { eid: 'a' }, browsing: { x: 1 } }] })
  to({ id: 's', relay: [{ entity: { eid: 'a' }, browsing: { y: 2 } }] })
  to({ id: 's', relay: [{ entity: { eid: 'b' }, browsing: { x: 3 } }] })
  to({ id: 's', bundles: [{ entity: { eid: 'a' }, book: { price: 4 } }] })
  to({ id: 's', relay: [{ entity: { eid: 'a' }, browsing: null }] })
  to({ id: 's', relay: [{ entity: { eid: 'a' }, browsing: { x: 5 } }] })
  assertEquals(socket.sent, [])
  assertEquals(due.length, 1)

  socket.bufferedAmount = 0
  due.shift()!()
  assertEquals(socket.taken(), [
    {
      id: 's',
      relay: [
        { entity: { eid: 'a' }, browsing: { x: 1, y: 2 } },
        { entity: { eid: 'b' }, browsing: { x: 3 } },
      ],
    },
    {
      id: 's',
      bundles: [
        { entity: { eid: 'a' }, book: { price: 4 } },
      ],
    },
    {
      id: 's',
      relay: [
        { entity: { eid: 'a' }, browsing: null },
        { entity: { eid: 'a' }, browsing: { x: 5 } },
      ],
    },
  ])
})

Deno.test('acknowledged subscriber holds one frame and sends latest relay next', () => {
  let socket = fake()
  let q = queue(socket)
  q.enable()
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, pointing: { x: 1 } }] })
  let [first] = socket.taken()
  assert(typeof first.ack == 'string')
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, pointing: { x: 2 } }] })
  q.send({ id: 's', relay: [{ entity: { eid: 'b' }, pointing: { x: 3 } }] })
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, pointing: null }] })
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, pointing: { x: 4 } }] })
  assertEquals(socket.sent, [])
  q.ack('old-token')
  assertEquals(socket.sent, [])
  q.ack(first.ack)
  let [second] = socket.taken()
  assert(typeof second.ack == 'string' && second.ack != first.ack)
  assertEquals(second.relay, [
    { entity: { eid: 'a' }, pointing: null },
    { entity: { eid: 'a' }, pointing: { x: 4 } },
    { entity: { eid: 'b' }, pointing: { x: 3 } },
  ])
  q.ack(first.ack)
  assertEquals(socket.sent, [])
})

Deno.test('a subscriber opts into acknowledgements through the socket', () => {
  let graph = shopGraph()
  let socket = fake()
  attach(subscriptions(graph), socket)
  socket.emit(
    'message',
    JSON.stringify({ subscribe: '.price<20', id: 's', acks: true }),
  )
  let [first] = socket.taken()
  assert(typeof first.ack == 'string')
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 1 } }])
  assertEquals(socket.sent, [])
  socket.emit('message', JSON.stringify({ ack: first.ack }))
  assertEquals(ids(socket.taken()), ['b1'])
})

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
