/// <reference lib="deno.ns" />
// A congested relay sends the newest patch when the socket can take it.

import { assertEquals } from '@std/assert'
import { pair } from './testing.ts'
import { wire } from './socket.ts'

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
