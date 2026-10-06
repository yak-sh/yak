// A billable-row ceiling must cover index/reference writes, not just entities.
import { equal, ok, test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { trackerBound } from './tracker_trace_bound_fixture.ts'

test('tracker trace reservations bound actual billed writes', async () => {
  let response = await fetch(`${workerd().base}/__tracker_trace_bound/`)
  equal(response.status, 200, await response.clone().text())
  let report = await response.json() as Awaited<ReturnType<typeof trackerBound>>
  console.log(
    'TRACKER_TRACE_BOUND',
    JSON.stringify({ ...report, stored: undefined, ordinaryStored: undefined }),
  )
  for (let shape of report.shapes) ok(shape.cost.written <= shape.entities * 64)
  equal(report.useful.map((r) => r.accepted), [true, true])
  equal(report.ordinarySize, 74)
  equal(report.cappedSize, 201)
  ok(report.usefulCost.written <= (74 + 201) * 64 + 16)
  for (
    let [stored, totals, count] of [
      [report.stored, report.cappedTotals, 200],
      [report.ordinaryStored, report.ordinaryTotals, 73],
    ] as const
  ) {
    let spans = stored.filter((row) => row.span)
    equal(spans.length, count)
    let root = spans.find((row) => !(row.span as { parent?: string }).parent)!
    for (
      let [metric, total] of [
        ['rows_read', totals.read],
        ['rows_written', totals.written],
        ['statements', totals.statements],
      ] as const
    ) {
      let n = (row: typeof root) =>
        (row[metric] as { n?: number } | undefined)?.n ?? 0
      let exclusive = spans.map((row) =>
        n(row) - spans
          .filter((child) =>
            (child.span as { parent?: string }).parent == row.entity.eid
          )
          .reduce((sum, child) => sum + n(child), 0)
      )
      ok(exclusive.every((n) => n >= 0))
      equal(exclusive.reduce((a, b) => a + b, 0), total)
      equal(n(root), total)
    }
  }
  equal(report.cappedTotals.statements, 5000)
  let accepted = report.flood.filter((row) => row.accepted).length
  equal(accepted, 3)
  equal(report.budget.dropped, 17)
  ok(report.floodCost.written <= 42_000)
  equal(report.budget.reserved, 38616)
  for (let n of report.complete) ok(n == 0 || n == 201)
  equal(report.before.accepted, false)
  equal(report.beforeCost.written, 0)
  equal(report.after.accepted, true)
  equal(report.cold.accepted, true)
  ok(report.coldCost.written <= 136)
  equal(report.oversized.accepted, false)
  equal(report.orphan.accepted, false)
  equal(report.droppedCost.written, 0)
})
