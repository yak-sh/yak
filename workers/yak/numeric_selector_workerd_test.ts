import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { numericSelectorCost } from './numeric_selector_fixture.ts'

test('numeric lists bill by consecutive runs without admitting fractional rows', async () => {
  let k = workerd()
  let res = await fetch(`${k.base}/__play_cost/?numeric-selector=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as Awaited<
    ReturnType<typeof numericSelectorCost>
  >
  console.log('NUMERIC_SELECTOR_COST', JSON.stringify(report))
  assertEquals(report.empty.rows, [])
  assertEquals(report.empty.written, 0)
  assert(report.empty.read <= 2, `empty selector: ${report.empty.read} rows`)
  assertEquals(report.gaps.rows, [])
  assertEquals(report.gaps.written, 0)
  assert(report.gaps.read <= 6, `gapped selector: ${report.gaps.read} rows`)
  assertEquals(report.occupied.rows.map((b) => (b.point as { x: number }).x), [
    1000,
    1001,
  ])
  assertEquals(report.occupied.written, 0)
  assert(
    report.occupied.read <= 32,
    `occupied selector: ${report.occupied.read} rows`,
  )
})
