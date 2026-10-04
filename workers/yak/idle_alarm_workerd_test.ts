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
  for (let [name, cost] of Object.entries(report.loads)) {
    assert(
      cost.read <= 150,
      `${name} cold+warm identity load: ${cost.read} rows`,
    )
    assertEquals(cost.written, 0)
  }
  for (let [path, cost] of Object.entries(report.requests)) {
    assert(
      cost.read <= (path == 'alarm' ? 300 : 20),
      `${path}: ${cost.read} rows read`,
    )
  }
})
