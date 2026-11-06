// The native driver's statement cache: what a store repeats stays prepared, a
// kept statement answers with the columns its table has now, and a fault only
// the handle itself can produce is recovered from. A store in memory is made
// from the template the first one like it left.

import { test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from './legacy.ts'
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
import { epoch, epochAt } from './meta.ts'
import { mem, shop } from './testing.ts'

test('a plain SQL schema is copied without store metadata', () => {
  let [a, b] = [open(':memory:'), open(':memory:')]
  try {
    for (let d of [a, b]) {
      d.template!('plain SQL schema', () =>
        d.query({
          t: 'create table',
          name: 'sample',
          cols: [{ name: 'value', type: 'integer' }],
        }))
    }
    a.query(insert(7))
    assertEquals(scan(a, 'sample'), [{ value: 7 }])
    assertEquals(scan(b, 'sample'), [])
    assertEquals(epochAt(b), undefined)
  } finally {
    a.close()
    b.close()
  }
})

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

// A copy is a store of its own: the epoch its template's make minted is never
// another copy's.
test('each store in memory made from a template mints its own epoch', () => {
  let made = () => {
    let d = mem()
    d.template!('a store with an epoch', () => {
      for (let s of storage(d, shop).ddl()) d.query(s)
      epoch(d)
    })
    return epochAt(d)
  }
  let [a, b] = [made(), made()]
  assertEquals(!!a && !!b && a != b, true)
})

// A store in memory that closed lends its connection to the next store made
// from the same template: rolled back to it, every statement compiled.
let lent = (body: (d: Driver) => void) => {
  let d = open(':memory:')
  try {
    storage(d, shop).install()
    body(d)
  } finally {
    d.close()
  }
}
let titles = (d: Driver) => scan(d, 'doc', undefined, ['title'])
let write = (d: Driver, title: string) =>
  storage(d, shop).tx((tx) =>
    tx.patch([{ entity: { eid: title }, doc: { title } }])
  )
let compiles = (body: () => void) => {
  let prepare = Database.prototype.prepare, n = 0
  Database.prototype.prepare = function (this: Database, sql: string) {
    n++
    return prepare.call(this, sql)
  }
  try {
    body()
  } finally {
    Database.prototype.prepare = prepare
  }
  return n
}

test('a store in memory lent a closed one’s connection has only its own rows, epoch and compiled writes', () => {
  let epochs: unknown[] = []
  lent((d) => {
    write(d, 'first')
    epochs.push(epochAt(d))
  })
  let n = compiles(() =>
    lent((d) => {
      assertEquals(titles(d), [])
      write(d, 'second')
      assertEquals(titles(d), [{ title: 'second' }])
      epochs.push(epochAt(d))
    })
  )
  assertEquals(n < 10, true, `${n} statements compiled again`)
  assertEquals(!!epochs[0] && epochs[0] != epochs[1], true)
})

test('a caller’s own transaction on a lent connection commits and rolls back', () =>
  lent((d) => {
    d.query({ t: 'begin' })
    write(d, 'undone')
    d.query({ t: 'rollback' })
    d.query({ t: 'begin', mode: 'immediate' })
    write(d, 'kept')
    d.query({ t: 'commit' })
    assertEquals(titles(d), [{ title: 'kept' }])
  }))

test('a setting said to a lent connection takes effect, and it is not lent again', () => {
  lent((d) => {
    write(d, 'kept')
    d.query({ t: 'pragma', name: 'foreign_keys', value: 'off' })
    assertEquals(d.query({ t: 'pragma', name: 'foreign_keys' }), [{
      foreign_keys: 0,
    }])
    assertEquals(titles(d), [{ title: 'kept' }])
  })
  lent((d) => {
    assertEquals(titles(d), [])
    assertEquals(d.query({ t: 'pragma', name: 'foreign_keys' }), [{
      foreign_keys: 1,
    }])
  })
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

test('a statement that answers no columns runs every step it has', () => {
  let sql = open(':memory:')
  try {
    let free = () => sql.query({ t: 'pragma', name: 'freelist_count' })[0]
    sql.query({ t: 'pragma', name: 'page_size', value: 512 })
    sql.query({ t: 'pragma', name: 'auto_vacuum', value: 'incremental' })
    sql.query({ t: 'create table', name: 't', cols: [{ name: 'x' }] })
    let rows = Array.from({ length: 20 }, () => [val('x'.repeat(400))])
    sql.query({ t: 'insert', into: 't', cols: ['x'], rows })
    sql.query({ t: 'delete', from: 't' })
    let { freelist_count: was } = free()
    sql.query({ t: 'pragma', name: 'incremental_vacuum', arg: 5 })
    assertEquals(free(), { freelist_count: Number(was) - 5 })
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
