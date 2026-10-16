import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { countCost } from './count_cost_fixture.ts'

test('cold owner queries read their candidates without unrelated descriptors', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?count=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as ReturnType<typeof countCost>
  console.log(
    'COUNT_COST',
    JSON.stringify({
      ...report,
      cardinality: {
        before: { read: report.cardinality.before.read },
        after: { read: report.cardinality.after.read },
      },
    }),
  )
  for (let [name, cost] of Object.entries(report.counts)) {
    assertEquals(cost.rows, [{
      value: '',
      n: cost.expected,
    }])
    assertEquals(cost.written, 0)
    // Policies may probe the owner's identity, ownership and grave. Those
    // probes still cost the component's owners, never unrelated descriptors.
    let budget = cost.owners * (name.endsWith('/plain') ? 2 : 6) + 3
    assert(cost.read <= budget, `${name}: ${cost.read} billed rows`)
  }
  assertEquals(report.activation.rows, [{ value: '', n: report.owners - 1 }])
  assert(report.activation.written > 0, 'first count seeds populations once')
  let { before, after, added } = report.cardinality
  assertEquals(after.component[0].n, Number(before.component[0].n) + added)
  assertEquals(after.total[0].n, Number(before.total[0].n) + added)
  assertEquals(after.tally.length, before.tally.length)
  assertEquals(after.tally.total, before.tally.total + added)
  assertEquals(after.read, before.read)
  assertEquals([before.written, after.written], [0, 0])
  for (let [name, cost] of Object.entries(report.nearby)) {
    assertEquals(cost.rows, cost.expected)
    assertEquals(cost.written, 0)
    // Eight candidate owners may each need several policy/component probes.
    let budget = name == 'empty' ? 3 : 150
    assert(cost.read <= budget, `${name}: ${cost.read} unrelated rows`)
  }
})
