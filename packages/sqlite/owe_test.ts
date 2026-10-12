import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  catalogue,
  col,
  type CreateIndex,
  lit,
  lt,
  op,
  select,
  table,
  unionAll,
} from '@yaks/sql'
import { open } from './db.ts'
import { META } from './layout.ts'
import { BIG, build, owed, RETRY, work } from './owe.ts'

// A database standing in for a file (owing is what a file does), with a
// `server_meta` and two tables: `big` holding BIG rows, `small` holding one,
// each with a column `x` (all ones in `big`, so a unique index over it fails).
let file = () => {
  let db = Object.assign(open(':memory:'), { file: true })
  db.query({
    t: 'create table',
    name: META,
    ifNot: true,
    cols: [{ name: 'k', type: 'text', pk: true }, { name: 'v', type: 'text' }],
  })
  for (let name of ['big', 'small']) {
    db.query({ t: 'create table', name, cols: [{ name: 'x' }] })
  }
  let n = unionAll(
    select({ cols: [lit(1)] }),
    select({
      cols: [op('+', col('i'), lit(1))],
      from: table('n'),
      where: lt(col('i'), lit(BIG)),
    }),
  )
  db.query({
    t: 'insert',
    with: [{ name: 'n', cols: ['i'], q: n, recursive: true }],
    into: 'big',
    cols: ['x'],
    q: select({ cols: [lit(1)], from: table('n') }),
  })
  db.query({ t: 'insert', into: 'small', cols: ['x'], rows: [[lit(1)]] })
  return { db, done: () => db.close() }
}
let index = (on: string, unique = false): CreateIndex => ({
  t: 'create index',
  name: `${on}_x`,
  on,
  cols: [col('x')],
  ifNot: true,
  unique,
})
let has = (db: ReturnType<typeof open>, name: string) =>
  catalogue(db).some((o) => o.name == name)

test('an index over a big table is owed, and one window builds it', () => {
  let { db, done } = file()
  build(db, [index('big'), index('small')])
  assertEquals([has(db, 'big_x'), has(db, 'small_x')], [false, true])
  assertEquals(owed(db).map((w) => w.name), ['big_x'])
  assertEquals(work(db), { name: 'owed:index:big_x', done: true })
  assertEquals([has(db, 'big_x'), owed(db), work(db)], [true, [], undefined])
  done()
})

test('a window that fails waits an hour, and a dropped table takes its work', () => {
  let { db, done } = file()
  let now = Date.now()
  build(db, [index('big', true)])
  let failed = work(db, now)
  assertEquals(failed && 'error' in failed, true)
  assertEquals(owed(db)[0].next, new Date(now + RETRY).toISOString())
  assertEquals(work(db, now + 1), undefined)
  db.query({ t: 'drop', kind: 'table', name: 'big' })
  assertEquals(work(db, now + RETRY), {
    name: 'owed:index:big_x',
    done: true,
  })
  assertEquals(owed(db), [])
  done()
})

test('a database in memory builds every index at once', () => {
  let db = open(':memory:')
  db.query({ t: 'create table', name: 'big', cols: [{ name: 'x' }] })
  build(db, [index('big')])
  assertEquals([has(db, 'big_x'), owed(db)], [true, []])
  db.close()
})
