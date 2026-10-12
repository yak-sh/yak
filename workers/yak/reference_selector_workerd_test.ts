import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { referenceSelectorCost } from './reference_selector_fixture.ts'

test('a short reference list resolves without billed JSON rows', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?reference-selector=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as ReturnType<typeof referenceSelectorCost>
  console.log('REFERENCE_SELECTOR_COST', JSON.stringify(report))
  assertEquals(report.rows, [{ eid: 'look' }])
  assertEquals(report.written, 0)
  assert(
    report.read <= 22,
    `${report.read} billed rows for nine reference targets`,
  )
})
