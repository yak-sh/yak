/// <reference lib="deno.ns" />
// The socket half: the two verbs a client sends, the frames that come back,
// and the `/ws` route that wires one to a graph through the host's upgrade.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { fake, req, shopGraph } from './testing.ts'
import { api } from './route.ts'
import { attach, queue, sink } from './socket.ts'
import { subscriptions } from './subs.ts'

let ids = (frames: { bundles?: { entity: { eid: string } }[] }[]) =>
  frames.flatMap((f) => (f.bundles ?? []).map((b) => b.entity.eid))

let ws = () => req('/ws', { headers: { upgrade: 'websocket' } })

test('subscriber queue stops when the socket closes during a flush', () => {
  let open = false
  let sent: string[] = []
  let q = queue(
    {
      send: (data) => {
        if (!open) {
          throw new TypeError(
            "Can't call WebSocket send() after close().",
          )
        }
        sent.push(data)
        open = false
      },
    },
    undefined,
    () => open,
  )
  q.send({ id: 'one', bundles: [] })
  q.send({ id: 'two', bundles: [] })

  open = true
  q.flush()
  assertEquals(sent.map((data) => JSON.parse(data).id), ['one'])
})

test('subscriber queue folds relay patches without crossing a data frame', () => {
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

test('acknowledged subscriber sends coalesced peer relays without ACKs', () => {
  let socket = fake()
  let due: (() => void)[] = []
  let q = queue(socket, (fn) => due.push(fn))
  q.enable()
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, pointing: { x: 1 } }] })
  assertEquals(socket.sent, [])
  due.shift()!()
  let [first] = socket.taken()
  assertEquals(first.ack, undefined)
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, pointing: { x: 2 } }] })
  q.send({ id: 's', relay: [{ entity: { eid: 'b' }, pointing: { x: 3 } }] })
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, pointing: null }] })
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, pointing: { x: 4 } }] })
  assertEquals(socket.sent, [])
  q.ack('old-token')
  assertEquals(socket.sent, [])
  due.shift()!()
  let [second] = socket.taken()
  assertEquals(second.ack, undefined)
  assertEquals(second.relay, [
    { entity: { eid: 'a' }, pointing: null },
    { entity: { eid: 'a' }, pointing: { x: 4 } },
    { entity: { eid: 'b' }, pointing: { x: 3 } },
  ])
  assertEquals(socket.sent, [])
})

test('crowded peer movement sends one current frame per tick', () => {
  let socket = fake()
  let due: (() => void)[] = []
  let q = queue(socket, (fn) => due.push(fn))
  for (let tick = 0; tick < 10; tick++) {
    for (let peer = 0; peer < 100; peer++) {
      q.send({
        id: 'players',
        relay: [{ entity: { eid: `p${peer}` }, browsing: { x: tick } }],
      })
    }
  }
  assertEquals(socket.sent, [])
  assertEquals(due.length, 1)
  due.shift()!()
  let [frame] = socket.taken()
  assertEquals(frame.relay?.length, 100)
  assertEquals(
    frame.relay?.map((b) => b.browsing),
    Array.from({ length: 100 }, () => ({ x: 9 })),
  )
  assertEquals(socket.sent, [])
})

test('membership and durable frames keep their place among peer relays', () => {
  let socket = fake()
  let due: (() => void)[] = []
  let q = queue(socket, (fn) => due.push(fn))
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, browsing: { x: 1 } }] })
  q.send({ id: 's', gone: ['a'] })
  q.send({ id: 's', bundles: [{ entity: { eid: 'b' }, book: { price: 2 } }] })
  q.send({ id: 's', relay: [{ entity: { eid: 'b' }, browsing: { x: 3 } }] })
  assertEquals(socket.taken(), [
    { id: 's', relay: [{ entity: { eid: 'a' }, browsing: { x: 1 } }] },
    { id: 's', gone: ['a'] },
    { id: 's', bundles: [{ entity: { eid: 'b' }, book: { price: 2 } }] },
  ])
  assertEquals(due.length, 1)
  due.shift()!()
  assertEquals(socket.taken(), [
    { id: 's', relay: [{ entity: { eid: 'b' }, browsing: { x: 3 } }] },
  ])
})

test('a resumed socket sends peers without changing its owed durable frame', () => {
  let socket = fake()
  let due: (() => void)[] = []
  let sent: unknown[] = []
  let q = queue(socket, (fn) => due.push(fn), () => true, {
    owed: 'before-hibernation',
    sent: (frame) => sent.push(frame),
  })
  q.enable()
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, browsing: { x: 1 } }] })
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, browsing: { x: 2 } }] })
  q.send({ id: 's', gone: ['a'] })
  due.shift()!()
  let [relay] = socket.taken()
  assertEquals(relay.relay, [{ entity: { eid: 'a' }, browsing: { x: 2 } }])
  assertEquals(relay.ack, undefined)
  assertEquals(sent, [])
  assertEquals(socket.sent, [])
  q.ack('before-hibernation')
  let [gone] = socket.taken()
  assertEquals(gone.gone, ['a'])
  assert(typeof gone.ack == 'string')
  assertEquals(sent, [[{ id: 's', gone: ['a'] }]])
})

test('an ACK received during send releases the next durable frame', () => {
  let seen: { id: string; ack?: string }[] = []
  let q: ReturnType<typeof queue>
  q = queue({
    send: (data) => {
      let frame = JSON.parse(data)
      seen.push(frame)
      q.ack(frame.ack)
    },
  })
  q.enable()
  q.send({ id: 'first', bundles: [] })
  q.send({ id: 'second', bundles: [] })
  assertEquals(seen.map((f) => f.id), ['first', 'second'])
})

test('a pending membership frame stays ahead of later peer relays', () => {
  let socket = fake()
  let due: (() => void)[] = []
  let sent: unknown[] = []
  let q = queue(socket, (fn) => due.push(fn), () => true, {
    sent: (frame) => sent.push(frame),
  })
  q.enable()
  q.send({ id: 's', bundles: [{ entity: { eid: 'a' }, book: {} }] })
  let [snapshot] = socket.taken()
  q.send({ id: 's', gone: ['a'] })
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, browsing: null }] })
  due.shift()!()
  assertEquals(socket.sent, [])
  q.ack(snapshot.ack!)
  let [gone, relay] = socket.taken()
  assertEquals(gone.gone, ['a'])
  assert(typeof gone.ack == 'string')
  assertEquals(relay.relay, [{ entity: { eid: 'a' }, browsing: null }])
  assertEquals(relay.ack, undefined)
  assertEquals(sent, [
    [{ id: 's', bundles: [{ entity: { eid: 'a' }, book: {} }] }],
    [{ id: 's', gone: ['a'] }],
  ])
})

test('a batched subscriber lands adjacent frames under one ACK', () => {
  let sent: Record<string, unknown>[] = []
  let take = () => sent.splice(0, sent.length)
  let q = queue({ send: (data) => void sent.push(JSON.parse(data)) })
  q.enable(true)
  q.send({ id: 's', bundles: [] })
  let [initial] = take()
  assertEquals(initial.frames, [{ id: 's', bundles: [] }])
  q.send({ id: 's', gone: ['a'] })
  q.send({ id: 't', bundles: [{ entity: { eid: 'b' } }] })
  q.send({ id: 's', relay: [{ entity: { eid: 'a' }, pointing: { x: 1 } }] })
  q.send({ id: 's', gone: ['b'] })
  q.ack(String(initial.ack))
  let [group, relay] = take()
  assertEquals(group.frames, [
    { id: 's', gone: ['a'] },
    { id: 't', bundles: [{ entity: { eid: 'b' } }] },
  ])
  assertEquals(relay.relay, [
    { entity: { eid: 'a' }, pointing: { x: 1 } },
  ])
  assertEquals(relay.ack, undefined)
  assertEquals(sent, [])
  q.ack(String(group.ack))
  assertEquals(take()[0].frames, [{ id: 's', gone: ['b'] }])
})

test('peer movement remains bounded behind an unacknowledged frame', () => {
  let graph = shopGraph()
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  let socket = fake()
  let due: (() => void)[] = []
  let q = queue(socket, (fn) => due.push(fn))
  q.enable()
  let subs = subscriptions(graph)
  subs.open(q.send, 'near', '.book&.browsing.x<10')
  let [snapshot] = socket.taken()
  assert(typeof snapshot.ack == 'string')
  q.ack(snapshot.ack)

  let writer = () => {}
  subs.relay(writer, [{ entity: { eid: 'b1' }, browsing: { x: 1 } }])
  let [joined] = socket.taken()
  assertEquals(joined.bundles?.map((b) => b.entity.eid), ['b1'])
  assert(typeof joined.ack == 'string')
  for (let x = 2; x <= 201; x++) {
    subs.relay(writer, [{ entity: { eid: 'b1' }, browsing: { x: x % 9 } }])
  }
  assertEquals(socket.sent, [])
  due.shift()!()
  let [newest] = socket.taken()
  assertEquals(newest.relay, [
    { entity: { eid: 'b1' }, browsing: { x: 201 % 9 } },
  ])
  assertEquals(newest.bundles, undefined)
  assertEquals(newest.ack, undefined)
  q.ack(joined.ack)
  assertEquals(socket.sent, [])
})

test('a subscriber opts into acknowledgements through the socket', () => {
  let graph = shopGraph()
  let socket = fake()
  attach(subscriptions(graph), socket)
  socket.emit(
    'message',
    JSON.stringify({ subscribe: '.price<20', id: 's', acks: true }),
  )
  let [first] = socket.taken()
  assert(typeof first.ack == 'string')
  assertEquals(Object.hasOwn(first, 'frames'), false)
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 1 } }])
  assertEquals(socket.sent, [])
  socket.emit('message', JSON.stringify({ ack: first.ack }))
  assertEquals(ids(socket.taken()), ['b1'])
})

test('a socket subscribes, hears its set, and hears every change', () => {
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

test('unsubscribe stops one, closing stops them all', () => {
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

test('frames sent before the socket opens are held for it', () => {
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

test('a frame the server cannot read is refused', () => {
  let graph = shopGraph()
  let socket = fake()
  attach(subscriptions(graph), socket)

  socket.emit('message', 'not json')
  socket.emit('message', JSON.stringify({ hello: true, id: 'x' }))
  let said = socket.taken()
  assertEquals(said.map((f) => f.id), ['', 'x'])
  assert(said.every((f) => f.refused))
})

test('a flooding relay socket closes without affecting another socket', () => {
  let graph = shopGraph()
  let subs = subscriptions(graph)
  let writer = fake(), peer = fake()
  let closed: number[] = []
  writer.close = (code) => void closed.push(code ?? 0)
  attach(subs, writer)
  attach(subs, peer)
  peer.emit('message', JSON.stringify({ subscribe: '.book', id: 'books' }))
  peer.taken()

  let date = Date.now
  Date.now = () => 0
  try {
    for (let x = 0; x < 32; x++) {
      writer.emit(
        'message',
        JSON.stringify({
          relay: [{ entity: { eid: 'b1' }, browsing: { x } }],
        }),
      )
    }
  } finally {
    Date.now = date
  }
  assertEquals(closed, [1008])
  graph.apply([{ entity: { eid: 'b1' }, book: { price: 12 } }])
  assertEquals(ids(peer.taken()), ['b1'])
})

test('/ws upgrades through the host and serves that socket', async () => {
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
