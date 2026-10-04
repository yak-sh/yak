// One-property applies must not scan retained receipts; sub-allowance writes
// must not repeatedly tell the directory their size. Actual workerd counters.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { storeCost } from './store_cost_fixture.ts'

for (let kind of ['directory', 'app']) {
  test(`Store ${kind} writes stay proportional to what changed`, async () => {
    let k = workerd()
    let res = await fetch(`${k.base}/__store_cost/?kind=${kind}`)
    assertEquals(res.status, 200, await res.clone().text())
    let report = await res.json() as Awaited<ReturnType<typeof storeCost>>
    console.log('STORE_COST', JSON.stringify(report))
    if (kind == 'directory') {
      let total = report.samples[0].total
      assert(
        total.rowsRead <= 55,
        `one meter property read ${total.rowsRead} rows`,
      )
      assert(
        total.rowsWritten <= 13,
        `one meter property wrote ${total.rowsWritten} rows`,
      )
    } else {
      assert(report.reports <= 1, `burst sent ${report.reports} size reports`)
      assertEquals(report.idleReports, 0)
      assertEquals(report.movementReports, 1)
    }
  })
}
