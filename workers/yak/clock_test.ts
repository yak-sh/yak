// The real Store message seam must answer without booting a graph on wake.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { durable } from '../../packages/durable-object/testing.ts'
import { Store } from './graph.ts'

test('Store clock probes pass dormancy once without SQL, attachments or full boot', async () => {
  using storage = durable()
  let gates = 0
  storage.get = <T>(key: string) => {
    assertEquals(key, 'dormant')
    gates++
    return Promise.resolve(false as T)
  }
  storage.sql.exec = () => {
    throw new Error('clock booted SQL')
  }
  let sent: { clock: number; received: number; sent: number }[] = []
  let ws = {
    readyState: 1,
    send: (raw: string) => {
      sent.push(JSON.parse(raw))
    },
    serializeAttachment: () => {
      throw new Error('clock wrote attachment')
    },
    deserializeAttachment: () => {
      throw new Error('clock read attachment')
    },
  }
  let store = new Store({
    storage,
    acceptWebSocket: () => {},
    getWebSockets: () => [ws],
  })
  for (let clock of [0, 12.5]) {
    let before = Date.now()
    await store.webSocketMessage(ws, JSON.stringify({ clock }))
    let reply = sent.at(-1)!
    assertEquals(reply.clock, clock)
    assert(reply.received >= before)
    assert(reply.sent >= reply.received && reply.sent <= Date.now())
  }
  assertEquals(sent.length, 2)
  assertEquals(gates, 1)
})

test('a dormant Store never answers a clock probe or boots SQL', async () => {
  using storage = durable()
  await storage.put('dormant', true)
  storage.sql.exec = () => {
    throw new Error('dormant clock booted SQL')
  }
  let closed = 0
  let ws = {
    readyState: 1,
    send: () => {
      throw new Error('dormant store answered clock')
    },
    close: () => {
      closed++
    },
    serializeAttachment: () => {},
    deserializeAttachment: () => null,
  }
  let store = new Store({
    storage,
    acceptWebSocket: () => {},
    getWebSockets: () => [ws],
  })
  await store.webSocketMessage(ws, '{"clock":123}')
  assertEquals(closed, 1)
})
