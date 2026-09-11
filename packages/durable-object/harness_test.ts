/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from '@std/assert'
import { durable } from './harness.ts'

Deno.test('statement reuse resets rows and bindings, including after a failed step', () => {
  using d = durable()
  let { sql } = d
  sql.exec('create table item (id integer primary key, value text)')
  let insert = 'insert into item values (?, ?)'
  sql.exec(insert, 1, 'one')
  assertThrows(() => sql.exec(insert, 1, 'duplicate'))
  sql.exec(insert, 2, 'two')
  let read = 'select value from item where id = ?'
  assertEquals(sql.exec(read, 1).toArray(), [{ value: 'one' }])
  assertEquals(sql.exec(read, 3).toArray(), [])
  assertEquals(sql.exec(read, 2).toArray(), [{ value: 'two' }])
  // Previously returned cursors are materialized, not a shared native cursor.
  let held = sql.exec(read, 1)
  sql.exec(read, 2)
  assertEquals(held.toArray(), [{ value: 'one' }])
})

Deno.test('eviction, schema changes, scripts and deleteAll leave reusable storage', async () => {
  using d = durable()
  d.sql.exec("create table item (value text); insert into item values ('one');")
  assertEquals(d.sql.exec('select * from item').toArray(), [{ value: 'one' }])
  d.sql.exec('alter table item add column extra integer')
  assertEquals(d.sql.exec('select * from item').toArray(), [{
    value: 'one',
    extra: null,
  }])
  for (let i = 0; i < 260; i++) d.sql.exec(`select ${i}`)
  assertEquals(d.sql.exec('select * from item').toArray(), [{
    value: 'one',
    extra: null,
  }])
  await d.deleteAll()
  assertThrows(() => d.sql.exec('select * from item'))
  d.sql.exec('create table item (value integer)')
  d.sql.exec('insert into item values (?)', 42)
  assertEquals(d.sql.exec('select * from item').toArray(), [{ value: 42 }])
  assertThrows(() =>
    d.transactionSync(() => {
      d.sql.exec('alter table item add column rolled_back text')
      assertEquals(d.sql.exec('select * from item').toArray(), [{
        value: 42,
        rolled_back: null,
      }])
      throw new Error('rollback DDL')
    })
  )
  assertEquals(d.sql.exec('select * from item').toArray(), [{ value: 42 }])
})

Deno.test('disposed storage rejects queries and can be disposed twice', () => {
  let d = durable()
  d.sql.exec('select 1')
  d[Symbol.dispose]()
  d[Symbol.dispose]()
  assertThrows(() => d.sql.exec('select 1'), Error, 'storage is disposed')
})
