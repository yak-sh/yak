/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from '@std/assert'
import {
  by,
  col,
  type CreateTable,
  insert,
  lit,
  render,
  scan,
  select,
  table,
} from '@yaks/sql'
import { driver } from './sql.ts'
import { durable } from './testing.ts'

let item = (...cols: CreateTable['cols']): CreateTable => ({
  t: 'create table',
  name: 'item',
  cols,
})

Deno.test('statement reuse resets rows and bindings, including after a failed step', () => {
  using d = durable()
  let sql = driver(d)
  sql.query(item({ name: 'id', type: 'integer', pk: true }, {
    name: 'value',
    type: 'text',
  }))
  sql.query(insert('item', { id: 1, value: 'one' }))
  assertThrows(() => sql.query(insert('item', { id: 1, value: 'duplicate' })))
  sql.query(insert('item', { id: 2, value: 'two' }))
  let reading = (id: number) =>
    select({ cols: [col('value')], from: table('item'), where: by({ id }) })
  let read = (id: number) => sql.query(reading(id))
  assertEquals(read(1), [{ value: 'one' }])
  assertEquals(read(3), [])
  assertEquals(read(2), [{ value: 'two' }])
  // Previously returned cursors are materialized, not a shared native cursor.
  let one = render(reading(1))
  let held = d.sql.exec(one.sql, ...one.params.map(Number))
  read(2)
  assertEquals(held.toArray(), [{ value: 'one' }])
})

Deno.test('eviction, schema changes and deleteAll leave reusable storage', async () => {
  using d = durable()
  let sql = driver(d)
  let all = () => scan(sql, 'item')
  sql.query(item({ name: 'value', type: 'text' }))
  sql.query(insert('item', { value: 'one' }))
  assertEquals(all(), [{ value: 'one' }])
  sql.query({
    t: 'alter table',
    table: 'item',
    add: { name: 'extra', type: 'integer' },
  })
  assertEquals(all(), [{ value: 'one', extra: null }])
  for (let i = 0; i < 260; i++) sql.query(select({ cols: [lit(i)] }))
  assertEquals(all(), [{ value: 'one', extra: null }])
  await d.deleteAll()
  assertThrows(all)
  sql.query(item({ name: 'value', type: 'integer' }))
  sql.query(insert('item', { value: 42 }))
  assertEquals(all(), [{ value: 42 }])
  assertThrows(() =>
    sql.tx!(() => {
      sql.query({
        t: 'alter table',
        table: 'item',
        add: { name: 'rolled_back', type: 'text' },
      })
      assertEquals(all(), [{ value: 42, rolled_back: null }])
      throw new Error('rollback DDL')
    })
  )
  assertEquals(all(), [{ value: 42 }])
})

Deno.test('disposed storage rejects queries and can be disposed twice', () => {
  let d = durable()
  let one = select({ cols: [lit(1)] })
  let sql = driver(d)
  sql.query(one)
  d[Symbol.dispose]()
  d[Symbol.dispose]()
  assertThrows(() => sql.query(one), Error, 'storage is disposed')
})
