import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { scopedTallyCost } from './scoped_tally_fixture.ts'
test('scoped archetype tallies do not bill repeated ownership probes', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?scoped-tally=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as ReturnType<typeof scopedTallyCost>
  console.log('SCOPED_TALLY_COST', JSON.stringify(report))
  for (let r of report) {
    assertEquals(r.written, 0)
    assert(r.read < 250, `${r.query}: ${r.read} billed rows`)
  }
  assertEquals(report[1].rows, [])
  assertEquals(report[2].rows.map((r) => r.n), [4])
})
