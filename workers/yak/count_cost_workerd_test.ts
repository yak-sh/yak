import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { countCost } from './count_cost_fixture.ts'

test('cold owner queries read their candidates without unrelated descriptors', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?count=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as ReturnType<typeof countCost>
  console.log('COUNT_COST', JSON.stringify(report))
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
  for (let [name, cost] of Object.entries(report.nearby)) {
    assertEquals(cost.rows, cost.expected)
    assertEquals(cost.written, 0)
    // Eight candidate owners may each need several policy/component probes.
    let budget = name == 'empty' ? 3 : 150
    assert(cost.read <= budget, `${name}: ${cost.read} unrelated rows`)
  }
})
