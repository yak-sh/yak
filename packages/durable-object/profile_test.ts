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

Deno.test('a profile reports first costs promptly and later costs at most once per minute', () => {
  let at = 100
  let reports: Summary[] = []
  let p = profile((summary) => reports.push(summary), () => at)
  for (let i = 0; i < 70; i++) {
    p.observe({ shape: `select "table_${i}"`, rowsRead: 1, rowsWritten: 0 })
  }
  p.observe({ shape: 'select "large"', rowsRead: 500, rowsWritten: 2 })
  p.observe({ shape: 'update "write"', rowsRead: 0, rowsWritten: 500 })
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
  p.observe({ shape: 'select "next"', rowsRead: 7, rowsWritten: 1 })
  at += 59_999
  p.flush()
  assertEquals(reports.length, 1)
  at++
  p.flush()
  assertEquals(reports[1].total, { calls: 1, rowsRead: 7, rowsWritten: 1 })
})

Deno.test('interleaved async invocations keep their own SQL costs', async () => {
  let reports: Summary[] = []
  let p = profile((summary) => reports.push(summary))
  let resume!: () => void
  let wait = new Promise<void>((resolve) => resume = resolve)
  let first = p.run('GET /query', async () => {
    p.observe({ shape: 'select "before"', rowsRead: 2, rowsWritten: 0 })
    await wait
    p.observe({ shape: 'select "after"', rowsRead: 3, rowsWritten: 0 })
  })
  await p.run('ws subscribe', async () => {
    await Promise.resolve()
    p.observe({ shape: 'select "socket"', rowsRead: 7, rowsWritten: 0 })
  })
  resume()
  await first
  p.flush()
  assertEquals(
    reports[0].operations.map(({ kind, total }) => ({
      kind,
      rowsRead: total.rowsRead,
    })),
    [
      { kind: 'GET /query', rowsRead: 5 },
      { kind: 'ws subscribe', rowsRead: 7 },
    ],
  )
  assertEquals(reports[0].total.rowsRead, 12)
})

Deno.test('many invocation labels and shapes remain bounded and fully counted', () => {
  let reports: Summary[] = []
  let p = profile((summary) => reports.push(summary))
  for (let i = 0; i < 30; i++) {
    p.run(`kind-${i}`, () => {
      for (let j = 0; j < 30; j++) {
        p.observe({
          shape: `select "table_${i}_${j}"`,
          rowsRead: 1,
          rowsWritten: 0,
        })
      }
    })
  }
  p.flush()
  assertEquals(reports[0].total, {
    calls: 900,
    rowsRead: 900,
    rowsWritten: 0,
  })
  assertEquals(reports[0].operations.length, 16)
  assertEquals(
    reports[0].operations.reduce((n, op) => n + op.total.rowsRead, 0),
    900,
  )
  assertEquals(
    reports[0].operations.every((op) => op.statements.length <= 7),
    true,
  )
})
