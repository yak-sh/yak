import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { ftsCost } from './fts_cost_fixture.ts'

test('a screened text ranking bounds work beyond its term statistics', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?fts=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as ReturnType<typeof ftsCost>
  console.log(
    'FTS_COST',
    JSON.stringify({
      ...report,
      queries: Object.fromEntries(
        Object.entries(report.queries).map((
          [q, r],
        ) => [q, { ...r, rows: r.rows.length }]),
      ),
    }),
  )
  assertEquals(report.rows.map((r) => r.entity), ['near', 'far'])
  assert(report.rows[0].snippet.includes('\x01dragon\x02'))
  assertEquals(report.written, 0)
  // Term postings and the broad screen are linear. Excluded matches must not
  // also cost ranking and owner lookups, or repeat MATCH per eligible owner.
  assert(report.read < report.history * 4 + 100, `${report.read} billed rows`)
  let sparse = report.queries['needle thread .comment .limit=2']
  assertEquals(sparse.rows, [{ eid: 'far' }, { eid: 'near' }])
  assertEquals(sparse.written, 0)
  assert(sparse.read < 100, `${sparse.read} mixed-query billed rows`)
  assertEquals(report.queries['.comment (needle|thread)'].rows, [
    { eid: 'near' },
    { eid: 'far' },
  ])
  assertEquals(report.queries['needle .comment !extra'].rows, [{ eid: 'far' }])
  // Ranking decorates its first 1000 hits, but membership retains every hit.
  assertEquals(
    report.queries['dragon .comment .order=search .limit=1005'].rows.length,
    report.history + 1,
  )
  assertEquals(report.lookups.stable.rows, report.lookups.linear.rows)
  assertEquals(report.lookups.bound.rows, report.lookups.linear.rows)
  assertEquals(report.lookups.stable.written, 0)
  assertEquals(report.lookups.bound.written, 0)
  assert(report.lookups.stable.read <= report.lookups.linear.read)
  assert(report.lookups.bound.read <= report.lookups.linear.read)
})
