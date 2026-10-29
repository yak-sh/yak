import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { durable } from '../../packages/durable-object/testing.ts'
import { sqlRun } from './sql_run_fixture.ts'

test('Durable Object writes count affected rows without returning stored rows', () => {
  using storage = durable()
  let report = sqlRun(storage)
  assertEquals(report.counts, [1, 0, 1, 1, 0, 1, 0, 1, 1])
  assertEquals(report.rolled, true)
  assertEquals(report.rows, [])
  assertEquals(report.audits, 3)
})
