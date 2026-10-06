import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { browser, tick } from './page-release_fixture.ts'

test('page release watches only own sockets, forwards frames untouched, and never reloads without a click', async () => {
  let b = browser()
  let other = new b.world.WebSocket('wss://ada.yaks.app/other/api/ws')
  other.fire('message', { data: '{"release":{"version":2}}' })
  await tick()
  assertEquals(b.asks.length, 0)
  let socket = new b.world.WebSocket('wss://ada.yaks.app/cookbook/api/ws')
  assertEquals(b.world.WebSocket.OPEN, 1)
  let frame = { data: '{"pos":{"x":1}}' }
  socket.fire('message', frame)
  assertEquals(frame.data, '{"pos":{"x":1}}')
  assertEquals(b.asks.length, 0)
  socket.fire('message', { data: '{"release":{"version":2}}' })
  await tick()
  assertEquals(b.asks, ['https://ada.yaks.app/cookbook/api/release?version=1'])
  assertEquals(b.events[0].options, {
    detail: { version: 2, reload: 'optional' },
    cancelable: true,
  })
  assertEquals(
    b.nodes[0].children[0].textContent,
    'A new version of this app is out',
  )
  assertEquals(b.reloads(), 0)
  b.nodes[0].children[2].click()
  assertEquals(b.nodes.length, 0)
  socket.fire('open')
  await tick()
  assertEquals(b.events.length, 1)
  b.result({ version: 3, reload: 'required' })
  socket.fire('message', { data: '{"release":{"version":3}}' })
  await tick()
  assertEquals(b.nodes[0].children.length, 2)
  assertEquals(
    b.nodes[0].children[0].textContent,
    'This app has changed. Reload to keep using it',
  )
  assertEquals(b.reloads(), 0)
  b.nodes[0].children[1].click()
  assertEquals(b.reloads(), 1)
})

test('canceling yak-release replaces the default; returning to view is throttled with no background polling', async () => {
  let b = browser(true)
  b.fire('visibilitychange')
  await tick()
  assertEquals(b.events.length, 1)
  assertEquals(b.nodes.length, 0)
  b.fire('pageshow', { persisted: true })
  b.fire('visibilitychange')
  await tick()
  assertEquals(b.asks.length, 1)
  b.time(160000)
  b.document.visibilityState = 'hidden'
  b.fire('visibilitychange')
  await tick()
  assertEquals(b.asks.length, 1)
  b.document.visibilityState = 'visible'
  b.result({ version: 3 })
  b.fire('pageshow', { persisted: true })
  await tick()
  assertEquals(b.asks.length, 2)
  assertEquals(b.events.length, 1)
  b.time(220000)
  b.result({ version: 4, reload: 'required' })
  b.fire('visibilitychange')
  await tick()
  assertEquals(b.events.length, 2)
  assertEquals(b.nodes.length, 0)
  assertEquals(b.reloads(), 0)
})
