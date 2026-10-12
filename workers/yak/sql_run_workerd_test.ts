import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { workerd } from './probe.ts'
import type { sqlRun } from './sql_run_fixture.ts'

test('Durable Object writes count affected rows without returning stored rows', async () => {
  let res = await fetch(`${workerd().base}/__play_cost/?sql-run=1`)
  assertEquals(res.status, 200, await res.clone().text())
  let report = await res.json() as ReturnType<typeof sqlRun>
  console.log('SQL_RUN_COST', JSON.stringify(report))
  assertEquals(report.counts, [1, 0, 1, 1, 0, 1, 0, 1, 1])
  assertEquals(report.rolled, true)
  assertEquals(report.rows, [])
  assertEquals(report.audits, 3)
  assertEquals(report.changed.written, report.returned.written)
  assert(report.changed.read < report.returned.read, JSON.stringify(report))
})
