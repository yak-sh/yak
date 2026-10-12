import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { ftsCost } from './fts_cost_fixture.ts'

test('a screened text ranking bounds work beyond its term statistics', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?fts=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as ReturnType<typeof ftsCost>
  console.log('FTS_COST', JSON.stringify(report))
  assertEquals(report.rows.map((r) => r.entity), ['near', 'far'])
  assert(report.rows[0].snippet.includes('\x01dragon\x02'))
  assertEquals(report.written, 0)
  // Term postings and the broad screen are linear. Excluded matches must not
  // also cost ranking and owner lookups, or repeat MATCH per eligible owner.
  assert(report.read < report.history * 4 + 100, `${report.read} billed rows`)
})
