import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { state } from './testing.ts'
import { browser, tick } from './page-release_fixture.ts'
import { reconnect } from './reconnect_fixture.ts'

test('a signed-in socket survives repeated cold incarnations without losing current standing', async () => {
  let r = await reconnect(state('probe/reconnect').storage)
  let page = browser()
  let opened = async () => {
    let socket = new page.world.WebSocket('wss://ada.yaks.app/cookbook/api/ws')
    socket.fire('open')
    await tick()
  }
  await opened()
  for (let _close of r.validCloses) await opened()
  // The real served release script checks once on opening; the loop does
  // not amplify polls when the inherited connection no longer retires.
  assertEquals(page.asks.length, 1)
  assertEquals(r.validCloses, [])
  // App and membership lookups once per cold principal, not per message.
  assertEquals(r.validQueries, 28)
  assertEquals(r.accepted.length, 1)
  assertEquals(r.accepted[0].endsWith(' cursor'), true)
  assertEquals(r.revokedCloses, [{
    code: 1012,
    reason: 'writer handshake required',
  }])
})
