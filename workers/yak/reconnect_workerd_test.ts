import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { reconnect } from './reconnect_fixture.ts'

test('a signed-in socket survives repeated cold incarnations without losing current standing', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__store_cost/?kind=reconnect`)
  assertEquals(res.status, 200, await res.clone().text())
  let r = await res.json() as Awaited<ReturnType<typeof reconnect>>
  console.log('COLD_SOCKET', JSON.stringify(r))
  assertEquals(r.validCloses, [])
  // One lookup per cold principal, not one per message.
  assertEquals(r.validQueries, 29)
  assertEquals(r.revokedCloses, [{
    code: 1012,
    reason: 'writer handshake required',
  }])
})
