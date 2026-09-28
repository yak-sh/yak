/// <reference lib="deno.ns" />
import { assertEquals, assertStringIncludes } from '@std/assert'
import { col, eq, lit, render, select, shape, val } from '@yaks/sql'
import { profile, type Summary } from './profile.ts'
import { driver } from './sql.ts'
import { durable } from './testing.ts'

Deno.test('the Durable Object driver observes cursor costs after execution', () => {
  using d = durable()
  let exec = d.sql.exec.bind(d.sql)
  d.sql.exec = (query, ...bindings) => {
    let cursor = exec(query, ...bindings)
    let drained = false
    return {
      toArray: () => {
        let rows = cursor.toArray()
        drained = true
        return rows
      },
      [Symbol.iterator]: () => cursor[Symbol.iterator](),
      get rowsRead() {
        return drained ? 19 : 0
      },
      get rowsWritten() {
        return drained ? 3 : 0
      },
    }
  }
  let seen: { shape: string; rowsRead: number; rowsWritten: number }[] = []
  let sql = driver(d, (sample) => seen.push(sample))
  sql.query(select({
    cols: [lit("Alice's secret")],
    where: eq(lit('person@example.com'), val('person@example.com')),
  }))
  let sample = seen.at(-1)!
  assertEquals({ read: sample.rowsRead, written: sample.rowsWritten }, {
    read: 19,
    written: 3,
  })
  assertStringIncludes(sample.shape, 'select ? where ? = ?')
  assertEquals(sample.shape.includes('Alice'), false)
  assertEquals(sample.shape.includes('example.com'), false)
})

Deno.test('statement shapes keep identifiers but omit inline and bound values', () => {
  let query = (secret: string) =>
    select({
      cols: [col("owner's"), lit(secret), lit(secret.length * 1024)],
      where: eq(lit(secret), val(secret)),
    })
  assertEquals(shape(render(query('one'))), shape(render(query('longer'))))
  assertStringIncludes(shape(render(query('one'))), '"owner\'s"')
})

Deno.test('a profile reports bounded read costs once per minute', () => {
  let at = 100
  let reports: Summary[] = []
  let p = profile((summary) => reports.push(summary), () => at)
  for (let i = 0; i < 70; i++) {
    p.observe({ shape: `select "table_${i}"`, rowsRead: 1, rowsWritten: 0 })
  }
  p.observe({ shape: 'select "large"', rowsRead: 500, rowsWritten: 2 })
  p.observe({ shape: 'update "write"', rowsRead: 0, rowsWritten: 500 })
  at += 59_999
  p.flush()
  assertEquals(reports.length, 0)
  at++
  p.flush()
  p.flush()
  assertEquals(reports.length, 1)
  assertEquals(reports[0].total, {
    calls: 72,
    rowsRead: 570,
    rowsWritten: 502,
  })
  assertEquals(reports[0].statements.length, 12)
  assertEquals(reports[0].statements[0].shape, 'select "large"')
  assertEquals(
    reports[0].statements.some((row) => row.shape == 'update "write"'),
    true,
  )
  assertEquals(
    reports[0].other.rowsRead +
      reports[0].statements.reduce((n, row) => n + row.rowsRead, 0),
    570,
  )
})
