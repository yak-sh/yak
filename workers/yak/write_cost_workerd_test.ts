import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { WriteCost } from './write_cost_fixture.ts'

test('keyed writes insert only committed receipts, without transient log stages', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?writes=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let cost = await res.json() as WriteCost
  console.log('WRITE_COST', JSON.stringify(cost))
  assertEquals(cost.keyed, cost.requests)
  assertEquals(cost.receipts, cost.requests + 1)
  // Three inclusive writes per successful receipt: table, key, expiry index.
  // sqlite_sequence maintenance is also billed by the real cursor.
  assert(cost.log.written <= cost.requests * 4, JSON.stringify(cost.log))
  assert(
    !cost.shapes.some((s) =>
      /^update "yak_writes"/i.test(s.sql) && s.written > 0
    ),
  )
})
