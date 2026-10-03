// The native driver's statement cache: what a store repeats stays prepared, and
// a fault only the handle itself can produce is recovered from. A store in
// memory is made from the template the first one like it left.

import { test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assertEquals, assertThrows } from '@std/assert'
import {
  col,
  type Driver,
  type Insert,
  lit,
  render,
  scan,
  type Stmt,
  type Tx,
  val,
} from '@yaks/sql'
import { driver, prepared } from './native.ts'
import { open } from './db.ts'
import { storage } from './mod.ts'
import { mem, shop } from './testing.ts'

// Stores in memory past the first are copies of the schema it made: each has
// every object a store made by its statements has, and only its own rows.
test('a store in memory made from a template has the whole schema and only its own rows', () => {
  let names = (d: Driver) =>
    scan(d, 'sqlite_schema', undefined, ['name']).map((o) => o.name)
  let made = mem()
  for (let s of storage(made, shop).ddl()) made.query(s)
  let [a, b] = [mem(), mem()]
  for (let d of [a, b]) storage(d, shop).install()
  for (let name of names(made)) assertEquals(names(b).includes(name), true)
  storage(a, shop).tx((tx) =>
    tx.patch([{ entity: { eid: 'mine' }, doc: { title: 'a' } }])
  )
  assertEquals(scan(b, 'doc'), [])
})

// A database that already holds rows is made in place: a copy would lose them.
test('a store in memory that already holds rows keeps them through install', () => {
  let kept = (d: Driver) =>
    d.query({ t: 'create table', name: 'kept', cols: [{ name: 'v' }] })
  let [empty, held] = [mem(), mem()]
  kept(empty)
  storage(empty, shop).install()
  kept(held)
  held.query({ t: 'insert', into: 'kept', cols: ['v'], rows: [[val(1)]] })
  storage(held, shop).install()
  assertEquals(scan(held, 'kept'), [{ v: 1 }])
})

test('a store in memory prepares nothing more for the same writes, however many units run them', () => {
  let db = new Database(':memory:')
  try {
    let s = storage(driver(db), shop)
    s.install()
    let write = (i: number) =>
      s.tx((tx) =>
        tx.patch([{ entity: { eid: `p${i % 3}` }, doc: { title: `t${i}` } }])
      )
    for (let i = 0; i < 6; i++) write(i)
    let prepare = db.prepare.bind(db)
    let prepared = 0
    db.prepare = (text: string) => (prepared++, prepare(text))
    for (let i = 0; i < 20; i++) write(i)
    assertEquals(prepared, 0)
  } finally {
    db.close()
  }
})

let insert = (value: number): Insert => ({
  t: 'insert',
  into: 'sample',
  cols: ['value'],
  rows: [[val(value)]],
  returning: [col('value')],
})

test('failed row decoding releases a cached write before rollback and the next savepoint', () => {
  let db = new Database(':memory:')
  try {
    let sql = driver(db)
    sql.query({
      t: 'create table',
      name: 'sample',
      cols: [{ name: 'value', type: 'integer', unique: true }],
    })
    let tx = (...steps: Tx[]) => steps.forEach((s) => sql.query(s))
    let prepare = db.prepare.bind(db)
    let attempts = 0
    let original = new Error('row conversion failed')
    db.prepare = (text: string) => {
      let statement = prepare(text)
      if (text == render(insert(0)).sql && ++attempts == 1) {
        // Fault exactly after sqlite3_step returned SQLITE_ROW, before all()
        // resets it. No fake SQLite error: without eviction the next SAVEPOINT
        // actually throws "cannot open savepoint - SQL statements in progress".
        statement.getRowObject = () => () => {
          throw original
        }
      }
      return statement
    }
    tx({ t: 'savepoint', name: 'outer' })
    let error = assertThrows(() => sql.query(insert(1)))
    assertEquals(error, original)
    tx(
      { t: 'savepoint', name: 'after_failure' },
      { t: 'release', name: 'after_failure' },
      { t: 'rollback', to: 'outer' },
      { t: 'release', name: 'outer' },
      { t: 'savepoint', name: 'next' },
      { t: 'savepoint', name: 'nested' },
    )
    assertEquals(scan(sql, 'sample'), [])
    assertEquals(sql.query(insert(2)), [{ value: 2 }])
    assertEquals(attempts, 2, 'failed statement was re-prepared, not retried')
    tx({ t: 'release', name: 'nested' }, { t: 'release', name: 'next' })
  } finally {
    db.close()
  }
})

test('native integer values round-trip beyond 32 bits', () => {
  let sql = open(':memory:')
  try {
    sql.query({
      t: 'create table',
      name: 'numbers',
      cols: [{ name: 'value', type: 'integer' }],
    })
    for (
      let value of [20261003140000, -20261003140000, Number.MAX_SAFE_INTEGER]
    ) {
      sql.query({
        t: 'insert',
        into: 'numbers',
        cols: ['value'],
        rows: [[val(value)]],
      })
      assertEquals(scan(sql, 'numbers', undefined, ['value']).at(-1), { value })
    }
  } finally {
    sql.close()
  }
})

test('cached native row metadata follows external schema edits and rollback', () => {
  let db = new Database(':memory:')
  try {
    let sql = driver(db)
    let outside = (s: Stmt) => db.exec(render(s).sql)
    sql.query({ t: 'create table', name: 'sample', cols: [{ name: 'x' }] })
    sql.query({ t: 'insert', into: 'sample', cols: ['x'], rows: [[lit(1)]] })
    for (let i = 0; i < 2; i++) assertEquals(scan(sql, 'sample'), [{ x: 1 }])
    sql.query({ t: 'savepoint', name: 'shape' })
    outside({
      t: 'alter table',
      table: 'sample',
      add: { name: 'y', default: lit(2) },
    })
    assertEquals(scan(sql, 'sample'), [{ x: 1, y: 2 }])
    outside({ t: 'drop', kind: 'table', name: 'sample' })
    outside({ t: 'create table', name: 'sample', cols: [{ name: 'z' }] })
    sql.query({ t: 'insert', into: 'sample', cols: ['z'], rows: [[lit(3)]] })
    assertEquals(scan(sql, 'sample'), [{ z: 3 }])
    sql.query({ t: 'rollback', to: 'shape' })
    sql.query({ t: 'release', name: 'shape' })
    assertEquals(scan(sql, 'sample'), [{ x: 1 }])
    sql.query({ t: 'update', table: 'sample', set: { x: lit(4) } })
    assertEquals(scan(sql, 'sample'), [{ x: 4 }])
  } finally {
    db.close()
  }
})

test('native decoders follow temp and attached schema metadata on every read', () => {
  for (let schema of ['temp', 'attached']) {
    let db = new Database(':memory:')
    try {
      // These SQLite schema forms are inputs to the native text boundary;
      // @yaks/sql's graph AST does not express temp tables or ATTACH.
      if (schema == 'attached') db.exec("attach ':memory:' as attached")
      db.exec(
        `create table ${schema}.sample (x); insert into ${schema}.sample values (1)`,
      )
      let text = `select * from ${schema}.sample`
      let plain = db.prepare(text)
      let run = prepared(db)
      let same = () => {
        let expected = plain.all()
        assertEquals(run(text), expected)
        return expected
      }
      same()
      same()
      db.exec(`alter table ${schema}.sample add column y default 2`)
      // The dependency reads metadata before stepping a statement. A schema
      // recompile updates that metadata during the step; preserve its answer
      // on that first read, then use the refreshed columns on the next one.
      same()
      assertEquals(same(), [{ x: 1, y: 2 }])
      db.exec(
        `drop table ${schema}.sample; create table ${schema}.sample (z); insert into ${schema}.sample values (3)`,
      )
      same()
      assertEquals(same(), [{ z: 3 }])
    } finally {
      db.close()
    }
  }
})
