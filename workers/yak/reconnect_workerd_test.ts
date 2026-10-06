import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import { browser, tick } from './page-release_fixture.ts'
import type { reconnect } from './reconnect_fixture.ts'

test('a signed-in socket survives repeated cold incarnations without losing current standing', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__store_cost/?kind=reconnect`)
  assertEquals(res.status, 200, await res.clone().text())
  let r = await res.json() as Awaited<ReturnType<typeof reconnect>>
  console.log('COLD_SOCKET', JSON.stringify(r))
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
  console.log(
    'COLD_RELEASE',
    JSON.stringify({
      reconnects: r.validCloses.length,
      releaseChecks: page.asks.length,
    }),
  )
  assertEquals(r.validCloses, [])
  // One lookup per cold principal, not one per message.
  assertEquals(r.validQueries, 29)
  assertEquals(r.accepted.length, 1)
  assertEquals(r.accepted[0].endsWith(' cursor'), true)
  assertEquals(r.revokedCloses, [{
    code: 1012,
    reason: 'writer handshake required',
  }])
})
