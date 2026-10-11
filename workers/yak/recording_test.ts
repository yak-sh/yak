// A Store produces request activity for its reporter or an active observer.
import { assert, assertEquals } from '@std/assert'
import { channel, type Event, peek } from '@yaks/trace'
import { test } from '@yaks/testing'
import { Store } from './graph.ts'
import { durable } from './testing.ts'

let storage = durable()
await storage.put?.('dormant', true)
let get = storage.get!.bind(storage)
let store: Store
let observed: boolean[] = []
storage.get = (key) => {
  observed.push(!!peek(store))
  return get(key)
}
let request = () => {
  store = new Store({
    storage,
    getWebSockets: () => [],
    acceptWebSocket: () => {},
  })
  return new Request('http://store/query')
}

test('a Store with no reporter or observer leaves request activity inactive', async () => {
  let incoming = request()
  observed = []
  let response = await store.fetch(incoming)
  assertEquals(response.status, 404)
  await response.body?.cancel()
  assert(observed.length > 0)
  assert(observed.every((active) => !active))
})

test('a Store observer receives request activity without a reporter', async () => {
  let incoming = request()
  let events: Event[] = []
  let stop = channel(store).subscribe((event) => events.push(event))
  try {
    observed = []
    let response = await store.fetch(incoming)
    assertEquals(response.status, 404)
    await response.body?.cancel()
    assert(observed.some(Boolean))
    assert(events.some((e) => e.kind == 'request' && e.stage == 'end'))
  } finally {
    stop()
  }
})
