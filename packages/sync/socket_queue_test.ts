/// <reference lib="deno.ns" />
// A congested relay sends the newest patch when the socket can take it.

import { assertEquals } from '@std/assert'
import { pair } from './testing.ts'
import { type Frame, wire } from './socket.ts'

Deno.test('waiting relay patches replace older motion and preserve clears', () => {
  let socket = pair().client
  let due: (() => void)[] = []
  let w = wire({
    url: 'http://box.test',
    connect: () => socket,
    timer: (fn) => due.push(fn),
    land: () => {},
    report: (err) => {
      throw err
    },
  })
  w.open()
  socket.emit('open')
  socket.bufferedAmount = 8192
  w.relay([{ entity: { eid: 'a' }, pointing: { x: 1, y: 2 } }])
  w.relay([{ entity: { eid: 'a' }, pointing: { x: 3 } }])
  w.relay([{ entity: { eid: 'b' }, motion: { yaw: 4 } }])
  w.relay([{ entity: { eid: 'a' }, pointing: null }])
  w.relay([{ entity: { eid: 'a' }, pointing: { x: 5 } }])
  assertEquals(socket.sent, [])
  assertEquals(due.length, 1)

  socket.bufferedAmount = 0
  due.shift()!()
  assertEquals(socket.sent, [{
    relay: [
      { entity: { eid: 'a' }, pointing: null },
      { entity: { eid: 'a' }, pointing: { x: 5 } },
      { entity: { eid: 'b' }, motion: { yaw: 4 } },
    ],
  }])
  w.close()
})

Deno.test('a subscriber acknowledges only after landing a frame', async () => {
  let socket = pair().client
  let done: () => void = () => {}
  let settled = new Promise<void>((resolve) => done = resolve)
  let w = wire({
    url: 'http://box.test',
    connect: () => socket,
    land: () => settled,
    report: (err) => {
      throw err
    },
  })
  w.subscribe(true, 's')
  socket.emit('open')
  assertEquals(socket.sent, [{ subscribe: true, id: 's', acks: true }])
  socket.emit('message', JSON.stringify({ id: 's', bundles: [], ack: 'token' }))
  assertEquals(socket.sent.length, 1)
  done()
  await settled
  await Promise.resolve()
  assertEquals(socket.sent.at(-1), { ack: 'token' })
  w.close()
})

Deno.test('an unacknowledged peer frame lands before the next durable frame', async () => {
  let socket = pair().client
  let done: () => void = () => {}
  let settled = new Promise<void>((resolve) => done = resolve)
  let seen: string[] = []
  let w = wire({
    url: 'http://box.test',
    connect: () => socket,
    land: (frame) => {
      seen.push(frame.relay ? 'peer' : 'durable')
      if (frame.relay) return settled
    },
    report: (err) => {
      throw err
    },
  })
  w.subscribe(true, 's')
  socket.emit('open')
  socket.emit(
    'message',
    JSON.stringify({
      id: 's',
      relay: [{ entity: { eid: 'a' }, pointing: { x: 1 } }],
    }),
  )
  socket.emit('message', JSON.stringify({ id: 's', gone: ['a'], ack: 'next' }))
  assertEquals(seen, ['peer'])
  assertEquals(socket.sent.length, 1)
  done()
  await settled
  await Promise.resolve()
  assertEquals(seen, ['peer', 'durable'])
  assertEquals(socket.sent.at(-1), { ack: 'next' })
  w.close()
})

Deno.test('a server without acknowledgements can send consecutive frames', () => {
  let sockets = pair()
  let seen: Frame[] = []
  let w = wire({
    url: 'http://box.test',
    connect: () => sockets.client,
    land: (frame) => {
      seen.push(frame)
    },
    report: (err) => {
      throw err
    },
  })
  w.subscribe('.recipe', 's')
  sockets.client.emit('open')
  sockets.server.send(JSON.stringify({ id: 's', bundles: [] }))
  sockets.server.send(JSON.stringify({
    id: 's',
    bundles: [{ entity: { eid: 'r1' }, recipe: {} }],
  }))
  assertEquals(seen.length, 2)
  assertEquals(seen[1].bundles?.[0].entity.eid, 'r1')
  assertEquals(sockets.client.sent, [{
    subscribe: '.recipe',
    id: 's',
    acks: true,
  }])
  w.close()
})
