// The one door to an embedded database: what `open()` sets on a connection,
// and what its driver does once the connection is closed.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertThrows } from '@std/assert'
import { as, col, insert, isNull, lit, scan, select, val } from '@yaks/sql'
import { open } from './db.ts'

let value = (v: number) => select({ cols: [as(val(v), 'value')] })

test('a closed database refuses cached and new statements', () => {
  let sql = open(':memory:')
  assertEquals(sql.query(value(1)), [{ value: 1 }])
  sql.close()
  for (
    let operation of [
      () => sql.query(value(2)),
      () => sql.query(select({ cols: [as(lit(3), 'value')] })),
      () =>
        sql.query({ t: 'create table', name: 'stale', cols: [{ name: 'id' }] }),
    ]
  ) assertThrows(operation, Error, 'the database is closed')
})

test('a file opens in WAL with NORMAL sync and a bounded journal', () => {
  let dir = Deno.makeTempDirSync()
  let sql = open(`${dir}/nested/graph.db`)
  try {
    let pragma = (name: string) => sql.query({ t: 'pragma', name })[0]
    assertEquals(pragma('journal_mode'), { journal_mode: 'wal' })
    assertEquals(pragma('synchronous'), { synchronous: 1 })
    let limit = pragma('journal_size_limit')?.journal_size_limit
    assert(typeof limit == 'number' && Number.isFinite(limit) && limit >= 0)
  } finally {
    sql.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

test('an in-memory database leaves the journal size unlimited', () => {
  using sql = scratch()
  assertEquals(sql.query({ t: 'pragma', name: 'journal_size_limit' }), [{
    journal_size_limit: -1,
  }])
})

test('a kept statement answers with the columns the schema now has', () => {
  using sql = scratch()
  sql.query({ t: 'create table', name: 't', cols: [{ name: 'x' }] })
  sql.query(insert('t', { x: 1 }))
  assertEquals(scan(sql, 't'), [{ x: 1 }])
  sql.query({
    t: 'alter table',
    table: 't',
    add: { name: 'y', default: lit(5) },
  })
  assertEquals(scan(sql, 't'), [{ x: 1, y: 5 }])
})

test('an index cannot name a column the table has not gained', () => {
  using sql = scratch()
  sql.query({ t: 'create table', name: 't', cols: [{ name: 'x' }] })
  assertThrows(
    () =>
      sql.query({
        t: 'create index',
        name: 't_y',
        on: 't',
        cols: [col('y')],
      }),
    Error,
    'missing column t.y',
  )
  assertThrows(
    () =>
      sql.query({
        t: 'create index',
        name: 't_x_y',
        on: 't',
        cols: [col('x')],
        where: isNull(col('y')),
      }),
    Error,
    'missing column t.y',
  )
  sql.query({ t: 'alter table', table: 't', add: { name: 'y' } })
  sql.query({ t: 'create index', name: 't_y', on: 't', cols: [col('y')] })
})

let scratch = () => {
  let sql = open(':memory:')
  return { ...sql, [Symbol.dispose]: sql.close }
}
