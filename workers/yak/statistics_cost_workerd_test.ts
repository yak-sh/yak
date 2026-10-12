import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { statisticsCost } from './statistics_cost_fixture.ts'

test('reopened Store installs read and write no planner statistics', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?statistics=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as Awaited<ReturnType<typeof statisticsCost>>
  console.log('STATISTICS_INSTALL_COST', JSON.stringify(report))
  assert(report.statistics.length > 0, 'setup must take useful statistics')
  assertEquals(report.after, report.statistics)
  for (let cost of [...report.reopens, ...report.installs]) {
    assertEquals(cost.analysisRead, 0)
    assertEquals(cost.analysisWritten, 0)
    assertEquals(cost.written, 0)
  }
})
