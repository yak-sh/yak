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
  assertEquals(report.screened.rows.map((r) => r.entity), ['near', 'far'])
  assert(report.screened.rows[0].snippet.includes('\x01needle\x02'))
  assertEquals(report.screened.written, 0)
  // A narrow term should probe the large owner screen only for its hits.
  assert(
    report.screened.read < 100,
    `${report.screened.read} billed rows for ${report.history} unrelated matches`,
  )
  for (
    let query of [
      'dragon needle .comment .limit=2',
      'needle dragon .comment .limit=2',
    ]
  ) {
    assertEquals(report.queries[query].rows, [])
    assertEquals(report.queries[query].written, 0)
  }
  let bounded = report.queries['dragon .entity.eid=later-1000001,later-1000002']
  assertEquals(
    bounded.rows.map((r) => String((r as { eid: string }).eid)).sort(),
    ['later-1000001', 'later-1000002'],
  )
  assertEquals(bounded.written, 0)
  assert(bounded.read < 100, `${bounded.read} bounded membership billed rows`)
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
  assertEquals(report.broad.rows, [{ eid: 'later-1000002' }, {
    eid: 'later-1000001',
  }])
  assertEquals(report.broad.written, 0)
  // A window of a search is its best rows (@yaks/fts `ranks`), and here every
  // comment's text is the two words: ranking reads each hit's postings and
  // size, and each one is a name to compare. Membership alone read 18,027.
  assert(report.broad.read <= 52000, `${report.broad.read} broad billed rows`)
  assertEquals(report.all, [{ value: '', n: report.history * 2 + 3 }])
  assertEquals(
    report.wide.rows.map((r) => String(r.eid)).sort(),
    [...report.wide.ids].sort(),
  )
  assertEquals(report.wide.written, 0)
  assert(report.wide.read <= 4554, `${report.wide.read} wide billed rows`)
  assert(
    report.wide.parameters <= 100,
    `${report.wide.parameters} bound parameters`,
  )
  assertEquals(report.few.rows.map((r) => String(r.eid)).sort(), report.few.ids)
  assertEquals(report.few.written, 0)
  assert(
    report.few.read < 300,
    `${report.few.read} finite multi-term billed rows`,
  )
  assert(
    report.few.parameters <= 100,
    `${report.few.parameters} bound parameters`,
  )
  assertEquals(report.prefix.rows, [{ eid: 'near' }])
  assertEquals(report.prefix.written, 0)
  assert(
    report.prefix.read < 30,
    `${report.prefix.read} prefix lookup billed rows`,
  )
  assertEquals(report.lookups.stable.rows, report.lookups.linear.rows)
  assertEquals(report.lookups.bound.rows, report.lookups.linear.rows)
  assertEquals(report.lookups.stable.written, 0)
  assertEquals(report.lookups.bound.written, 0)
  assert(report.lookups.stable.read <= report.lookups.linear.read)
  assert(report.lookups.bound.read <= report.lookups.linear.read)
})
