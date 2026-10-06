// Billing proof uses actual workerd cursor counts, including trace intake.
import { equal, ok, test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { traceCost } from './store_trace_fixture.ts'

test('Store trace selection adds no billed rows to an untriggered request', async () => {
  let response = await fetch(`${workerd().base}/__store_trace/`)
  equal(response.status, 200, await response.clone().text())
  let report = await response.json() as Awaited<ReturnType<typeof traceCost>>
  console.log(
    'STORE_TRACE_COST',
    JSON.stringify({
      requests: report.requests,
      sizes: report.sizes,
      intake: report.intake,
    }),
  )
  for (let kind of ['read', 'write']) {
    equal(
      report.requests[`on/${kind}`].cost,
      report.requests[`off/${kind}`].cost,
    )
    equal(report.requests[`on/${kind}`].deliveries, 0)
    equal(report.requests[`off/${kind}`].deliveries, 0)
    ok(report.requests[`traced/${kind}`].deliveries > 0)
    ok(report.sizes[kind].spans > 1)
    ok(report.intake[kind].written > 0)
    equal(report.intake[`${kind}/duplicate`].written, 0)
    let rows = report.traces[kind]
    let root = rows.find((row) =>
      row.span && !(row.span as { parent?: string }).parent
    )
    if (!root) throw Error('missing recorded request root')
    equal(
      (root.rows_read as { n: number }).n,
      report.requests[`traced/${kind}`].cost.read,
    )
    equal(
      (root.rows_written as { n: number }).n,
      report.requests[`traced/${kind}`].cost.written,
    )
    equal(
      (root.statements as { n: number }).n,
      report.requests[`traced/${kind}`].cost.statements,
    )
    for (let row of rows) {
      equal(
        (row.during as { space: string }).space,
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      )
    }
  }
  equal(report.reordered.complete, report.reordered.expected)
  equal(report.intake['reordered/duplicate'].written, 0)
  ok(report.requests.sample.deliveries > 0)
  ok(report.requests.alarm.deliveries > 0)
  ok(report.requests.socket.deliveries > 0)
  equal(report.requests.exhausted.deliveries, 0)
  ok(report.requests.threshold.cost.read > 10_000)
  ok(report.requests.threshold.deliveries > 0)
})
