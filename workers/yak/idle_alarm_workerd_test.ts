// SQL driver row counts include boot and asynchronous work, not just returned rows.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { idleWake } from './play_cost_fixture.ts'

test('idle Vale-sized Store wakes seek no work and write nothing', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__play_cost/?idle=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as Awaited<ReturnType<typeof idleWake>>
  console.log('IDLE_COST', JSON.stringify(report))
  assertEquals(report.total.written, 0)
  assertEquals(report.alarm, null)
  for (let [path, cost] of Object.entries(report.requests)) {
    assert(cost.read <= 20, `${path}: ${cost.read} rows read (budget 20)`)
  }
})
