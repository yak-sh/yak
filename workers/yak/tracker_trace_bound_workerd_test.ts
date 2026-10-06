// A billable-row ceiling must cover index/reference writes, not just entities.
import { equal, ok, test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { trackerBound } from './tracker_trace_bound_fixture.ts'

test('tracker trace reservations bound actual billed writes', async () => {
  let response = await fetch(`${workerd().base}/__tracker_trace_bound/`)
  equal(response.status, 200, await response.clone().text())
  let report = await response.json() as Awaited<ReturnType<typeof trackerBound>>
  console.log('TRACKER_TRACE_BOUND', JSON.stringify(report))
  for (let shape of report.shapes) ok(shape.cost.written <= shape.entities * 64)
  let accepted = report.flood.filter((row) => row.accepted).length
  equal(accepted, 5)
  equal(report.budget.dropped, 15)
  ok(report.floodCost.written <= 700)
  equal(report.budget.reserved, 680)
  for (let n of report.complete) ok(n == 0 || n == 2)
  equal(report.before.accepted, false)
  equal(report.beforeCost.written, 0)
  equal(report.after.accepted, true)
  equal(report.cold.accepted, true)
  ok(report.coldCost.written <= 136)
  equal(report.oversized.accepted, false)
  equal(report.orphan.accepted, false)
  equal(report.droppedCost.written, 0)
})
