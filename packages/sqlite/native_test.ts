// The native driver's statement cache: what a store repeats stays prepared, a
// kept statement answers with the columns its table has now, and a fault only
// the handle itself can produce is recovered from. A store in memory is made
// from the template the first one like it left.

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

let failed = new Database(':memory:')
let sql = driver(failed)
sql.query({
  t: 'create table',
  name: 'sample',
  cols: [{ name: 'value', type: 'integer', unique: true }],
})
let tx = (...steps: Tx[]) => steps.forEach((s) => sql.query(s))
let prepare = failed.prepare.bind(failed)
let attempts = 0
let fault = render(insert(0)).sql
let original = new Error('row conversion failed')
failed.prepare = (text: string) => {
  let statement = prepare(text)
  if (text == fault && ++attempts == 1) {
    // Fault once, exactly after sqlite3_step returned SQLITE_ROW, before
    // all() resets it. No fake SQLite error: left there, the statement makes
    // the next SAVEPOINT throw "cannot open savepoint - SQL statements in
    // progress". A retry would decode the row the fault spared.
    let decoder = statement.getRowObject.bind(statement)
    let faults = 1
    statement.getRowObject = () => {
      let decode = decoder()
      return (...row) => {
        if (faults-- > 0) throw original
        return decode(...row)
      }
    }
  }
  return statement
}

tx({ t: 'savepoint', name: 'outer' })

test('failed row decoding releases a cached write before rollback and the next savepoint', () => {
  try {
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
    assertEquals(attempts, 1, 'failed statement was kept, not prepared again')
    tx({ t: 'release', name: 'nested' }, { t: 'release', name: 'next' })
  } finally {
    failed.close()
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

// SQLite's flags for a database named by a URI, read-write and made when
// missing (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_URI).
let URI = 0x2 | 0x4 | 0x40

// Where a kept statement's table gains a column: in its own connection's temp
// or attached schema, or by another connection to the same database, which
// keeps a schema of its own. The memdb VFS shares one database in memory by
// name; a shared cache would share the schema too. These forms are inputs to
// the native text boundary: @yaks/sql's graph AST does not express temp
// tables, ATTACH or a URI.
let changers: Record<string, () => [Database, Database, string]> = {
  'in its own temp schema': () => {
    let db = new Database(':memory:')
    return [db, db, 'temp.sample']
  },
  'in its own attached schema': () => {
    let db = new Database(':memory:')
    db.exec("attach ':memory:' as attached")
    return [db, db, 'attached.sample']
  },
  'by another connection': () => {
    let path = 'file:/native_test?vfs=memdb'
    let open = () => new Database(path, { flags: URI })
    return [open(), open(), 'sample']
  },
}

for (let [where, make] of Object.entries(changers)) {
  let [db, changer, table] = make()
  test(`a kept select answers at once with a column added ${where}`, () => {
    try {
      let run = prepared(db), all = `select * from ${table}`
      changer.exec(`create table ${table} (x); insert into ${table} values (1)`)
      assertEquals(run(all), [{ x: 1 }])
      changer.exec(`alter table ${table} add column y default 2`)
      assertEquals(run(all), [{ x: 1, y: 2 }])
    } finally {
      db.close()
      changer.close()
    }
  })
}

// A warm graph can cycle through more shapes than the old 256-entry cache.
// Keep the workload outside the assertion timer; count actual preparations.
let shapeReuse = (() => {
  let db = new Database(':memory:')
  try {
    let native = db.prepare.bind(db)
    let count = 0
    db.prepare = (sql: string) => (count++, native(sql))
    let run = prepared(db)
    for (let n = 0; n < 600; n++) run(`select 7 as shape_${n}`)
    let first = count
    let answer = 0
    for (let n = 0; n < 600; n++) {
      answer += Number(run(`select 7 as shape_${n}`)[0][`shape_${n}`])
    }
    return { first, extra: count - first, answer }
  } finally {
    db.close()
  }
})()
test('a graph cycling through hundreds of SQL shapes reuses its statements', () => {
  assertEquals(shapeReuse, { first: 600, extra: 0, answer: 4200 })
})

// Index validation belongs to SQLite's parser, not a table_info round trip
// for every index. Keep this fixture outside the timed assertion.
let indexChecks = (() => {
  let db = new Database(':memory:')
  let sql = driver(db)
  sql.query({ t: 'create table', name: 'indexed', cols: [{ name: 'value' }] })
  let reads = 0
  let prepare = db.prepare.bind(db)
  db.prepare = (text: string) => {
    if (/table_info/i.test(text)) reads++
    return prepare(text)
  }
  for (let i = 0; i < 12; i++) {
    sql.query({
      t: 'create index',
      name: `indexed_${i}`,
      on: 'indexed',
      cols: [col('value')],
    })
  }
  db.close()
  return reads
})()
test('native index creation does not inspect table columns separately', () => {
  assertEquals(indexChecks, 0)
})
