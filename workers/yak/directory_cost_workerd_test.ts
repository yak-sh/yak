import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { directoryLifecycleCost } from './directory_cost_fixture.ts'

test('directory app lifecycle costs rows in proportion to the app', async () => {
  let reports: Awaited<ReturnType<typeof directoryLifecycleCost>>[] = []
  for (let history of [100, 85000]) {
    let res = await fetch(
      `${workerd().base}/__play_cost/?directory-lifecycle=1&history=${history}`,
    )
    assertEquals(res.status, 200, await res.clone().text())
    let report = await res.json() as Awaited<
      ReturnType<typeof directoryLifecycleCost>
    >
    console.log('DIRECTORY_COST', JSON.stringify(report))
    reports.push(report)
    for (let [name, { total }] of Object.entries(report.steps)) {
      assert(total.written <= 200, `${name}: ${JSON.stringify(total)}`)
    }
  }
  for (let name of Object.keys(reports[0].steps)) {
    let [small, large] = reports.map((r) => r.steps[name].total)
    assert(
      large.read <= small.read + 50,
      `${name}: ${small.read} → ${large.read} reads`,
    )
    assert(
      large.written <= small.written + 10,
      `${name}: ${small.written} → ${large.written} writes`,
    )
  }
})
