// A release is a store-wide notice, not a graph subscription or an ack.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { durable } from './testing.ts'
import { Store } from './graph.ts'
import type { Wire } from '@yaks/durable-object'

let released = (version: unknown, kernel = true, method = 'POST') =>
  new Request('https://store/released', {
    method,
    headers: {
      'x-store': 'releases/page',
      ...(kernel ? { 'x-yak-kernel': '1' } : {}),
    },
    ...(method == 'POST' ? { body: JSON.stringify({ version }) } : {}),
  })

test('only kernel POST /released tells every held socket, without subscriptions', async () => {
  using storage = durable()
  let socket = () => {
    let sent: unknown[] = []
    return {
      sent,
      readyState: 1,
      send: (data: string) => sent.push(JSON.parse(data)),
      serializeAttachment: () => {},
      deserializeAttachment: () => null,
    } satisfies Wire & { sent: unknown[] }
  }
  let one = socket()
  let two = socket()
  let store = new Store({
    storage,
    acceptWebSocket: () => {},
    getWebSockets: () => [one, two],
  })
  assertEquals((await store.fetch(released(2, false))).status, 404)
  assertEquals((await store.fetch(released(2, true, 'GET'))).status, 404)
  for (let version of ['2', null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assertEquals((await store.fetch(released(version))).status, 400)
  }
  assertEquals(one.sent, [])
  assertEquals(two.sent, [])
  assertEquals((await store.fetch(released(2))).status, 200)
  assertEquals(one.sent, [{ release: { version: 2 } }])
  assertEquals(two.sent, one.sent)
  assertEquals((await store.fetch(released(3))).status, 200)
  assertEquals(one.sent.at(-1), { release: { version: 3 } })
})
