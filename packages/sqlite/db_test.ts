// The one door to an embedded database: what `open()` sets on a connection,
// and what its driver does once the connection is closed.

import { assertEquals, assertThrows } from '@std/assert'
import { open } from './db.ts'

Deno.test('a closed database refuses cached and new statements', () => {
  let sql = open(':memory:')
  assertEquals(sql.query('select ? as value', [1]), [{ value: 1 }])
  sql.close()
  for (
    let operation of [
      () => sql.query('select ? as value', [2]),
      () => sql.query('select 3 as value', []),
      () => sql.exec('create table stale (id integer)'),
    ]
  ) assertThrows(operation, Error, 'the database is closed')
})

Deno.test('a file opens in WAL with NORMAL sync and a busy timeout', () => {
  let dir = Deno.makeTempDirSync()
  let sql = open(`${dir}/nested/graph.db`)
  try {
    let pragma = (name: string) => sql.query(`pragma ${name}`, [])[0]
    assertEquals(pragma('journal_mode'), { journal_mode: 'wal' })
    assertEquals(pragma('synchronous'), { synchronous: 1 })
    assertEquals(pragma('busy_timeout'), { timeout: 5000 })
  } finally {
    sql.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('a string of several statements runs every one', () => {
  using sql = scratch()
  sql.query('create table t (x); insert into t values (1), (2)', [])
  assertEquals(sql.query('select x from t order by x', []), [{ x: 1 }, {
    x: 2,
  }])
  assertThrows(
    () => sql.query('insert into t values (?); insert into t values (?)', [3]),
    Error,
    'one statement',
  )
  assertEquals(sql.query('select count(*) as n from t', []), [{ n: 2 }])
})

Deno.test('a kept statement answers with the columns the schema now has', () => {
  using sql = scratch()
  sql.query('create table t (x)', [])
  sql.query('insert into t values (1)', [])
  assertEquals(sql.query('select * from t', []), [{ x: 1 }])
  sql.query('alter table t add column y default 5', [])
  assertEquals(sql.query('select * from t', []), [{ x: 1, y: 5 }])
})

let scratch = () => {
  let sql = open(':memory:')
  return { ...sql, [Symbol.dispose]: sql.close }
}
