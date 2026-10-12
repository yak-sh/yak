import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { ownerCost } from './owner_cost_fixture.ts'
import { orderedOwners } from '../../packages/sql/owner_fixture_test.ts'
import type { Row } from '@yaks/sql'

test('finite owners cost their selected rows rather than unrelated shapes', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?owners=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as ReturnType<typeof ownerCost>
  console.log('OWNER_COST', JSON.stringify(report))
  for (let example of report) {
    assertEquals(
      orderedOwners(example.actual as Row[]),
      orderedOwners(example.rows),
      example.name,
    )
    assertEquals(example.written, 0, example.name)
    if (example.bounded) {
      assert(example.read < 20, `${example.name}: ${example.read} paid rows`)
    }
  }
})
