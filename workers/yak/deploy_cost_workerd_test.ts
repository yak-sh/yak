// Release changes must not turn retained history into billed installation work.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { deployCost } from './deploy_cost_fixture.ts'

test('one changed word installs independently of retained Store history', async () => {
  let reports: Awaited<ReturnType<typeof deployCost>>[] = []
  for (let history of [100, 5000]) {
    let res = await fetch(
      `${workerd().base}/__play_cost/?deploy=1&history=${history}`,
    )
    assertEquals(res.status, 200, await res.clone().text())
    reports.push(await res.json())
  }
  console.log(
    'DEPLOY_COST',
    JSON.stringify(reports.map(({ history, costs }) => ({ history, costs }))),
  )
  for (let report of reports) {
    assertEquals(report.costs.constructed, { read: 0, written: 0, calls: 0 })
    assertEquals(report.costs.unchanged.written, 0)
    assert(
      report.costs.description.written < 100,
      JSON.stringify(report.costs.description),
    )
  }
  for (let name of ['description', 'added', 'releaseWake']) {
    let [small, large] = reports.map((r) => r.costs[name])
    assert(
      large.read <= small.read + 100,
      `${name}: ${small.read} → ${large.read} reads`,
    )
    assert(
      large.written <= small.written + 10,
      `${name}: ${small.written} → ${large.written} writes`,
    )
  }
})
