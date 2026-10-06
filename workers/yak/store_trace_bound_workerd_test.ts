// The runtime's cursor totals, not query-result counts, prove a Store loop
// emits only one automatic trace an hour and writes no source quota rows.
import { equal, ok, test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { traceSourceBound } from './store_trace_bound_fixture.ts'

test('over-the-line Store loop sends one automatic trace per hour with repeats', async () => {
  let response = await fetch(`${workerd().base}/__store_trace_bound/`)
  equal(response.status, 200, await response.clone().text())
  let report = await response.json() as Awaited<
    ReturnType<typeof traceSourceBound>
  >
  console.log('STORE_TRACE_SOURCE_BOUND', JSON.stringify(report))
  equal(report.firstHour, 1)
  equal(report.justBeforeHour, 1)
  equal(report.afterHour, 2)
  equal(report.firstRepeats, undefined)
  equal(report.secondRepeats, { n: 10 })
  equal(report.onDemand, 1)
  equal(report.afterOnDemand, 0)
  equal(report.samples, 2)
  for (let cost of report.costs) {
    ok(cost.read > 10_000)
    equal(cost, report.costs[0])
    equal(cost.written, 0)
  }
})
