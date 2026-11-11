// A failed statement names itself, whichever engine ran it.
import { test } from '@yaks/testing'
import './sqlitepath.ts'
import { assertEquals, assertThrows } from '@std/assert'
import { col, type Driver, insert, render, select, table } from '@yaks/sql'
import { Database } from './legacy.ts'
import { driver } from './native.ts'
import { open } from './read-db.ts'

let named = (d: Driver, s: Parameters<Driver['query']>[0]) =>
  (assertThrows(() => d.query(s)) as { statement?: string }).statement

let missing = select({ cols: [col('x')], from: table('nowhere') })

test('a statement SQLite will not compile is named by its error', () => {
  let native = driver(new Database(':memory:')), reader = open(':memory:')
  assertEquals(named(native, missing), render(missing).sql)
  assertEquals(named(reader, missing), render(missing).sql)
  native.close()
  reader.close()
})

test('a kept statement that fails as it runs is named by its error', () => {
  let d = driver(new Database(':memory:'))
  let add = insert('t', { x: 1 })
  d.query({ t: 'create table', name: 't', cols: [{ name: 'x', pk: true }] })
  d.query(add)
  assertEquals(named(d, add), render(add).sql)
  d.close()
})
