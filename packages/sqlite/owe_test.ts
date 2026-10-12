import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  catalogue,
  col,
  type CreateIndex,
  eq,
  fn,
  lit,
  lt,
  op,
  select,
  table,
  unionAll,
} from '@yaks/sql'
import { open } from './db.ts'
import { META } from './layout.ts'
import { BIG, build, FILL, filler, owed, RETRY, work } from './owe.ts'
import { adopt, type Field, heal } from '@yaks/fts'

// Insert `n` rows into `into`, numbered from one in `entity` where `x` is
// given as `entity` (a text index's table), else with `x` alone.
let count = (
  db: ReturnType<typeof open>,
  into: string,
  n: number,
  x = fn('printf', lit('w%d'), col('i')),
) => {
  let ns = unionAll(
    select({ cols: [lit(1)] }),
    select({
      cols: [op('+', col('i'), lit(1))],
      from: table('n'),
      where: lt(col('i'), lit(n)),
    }),
  )
  let text = into == 'note'
  db.query({
    t: 'insert',
    with: [{ name: 'n', cols: ['i'], q: ns, recursive: true }],
    into,
    cols: text ? ['entity', 'text'] : ['x'],
    q: select({ cols: text ? [col('i'), x] : [x], from: table('n') }),
  })
}

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
  count(db, 'big', BIG, lit(1))
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

test('a text index over many rows fills in windows behind its cursor', () => {
  let { db, done } = file()
  let notes: Field[] = [{ comp: 'note', prop: 'text' }]
  db.query({
    t: 'create table',
    name: 'note',
    cols: [{ name: 'entity', type: 'integer', pk: true }, { name: 'text' }],
  })
  count(db, 'note', FILL + 500)
  adopt(db, notes, {}, { heal: false, fill: filler(db) })
  let match = (word: string) =>
    db.query(select({
      cols: [col('rowid')],
      from: table('note_fts'),
      where: op('match', col('note_fts'), lit(word)),
    })).map((r) => Number(r.rowid))
  let write = (stmt: Parameters<typeof db.query>[0]) => db.query(stmt)
  assertEquals([match('w10'), owed(db).map((w) => w.name)], [[], ['note_fts']])
  assertEquals(work(db), { name: 'owed:fill:note_fts', done: false })
  // Behind the cursor the triggers keep the index; ahead of it the windows do.
  write({
    t: 'update',
    table: 'note',
    set: { text: lit('changed') },
    where: eq(col('entity'), lit(10)),
  })
  write({ t: 'delete', from: 'note', where: eq(col('entity'), lit(1200)) })
  write({
    t: 'insert',
    into: 'note',
    cols: ['entity', 'text'],
    rows: [[lit(2000), lit('late')]],
  })
  while (!(work(db) as { done: boolean }).done) { /* the next window */ }
  assertEquals(
    [match('changed'), match('w10'), match('w1200'), match('late')],
    [[10], [], [], [2000]],
  )
  assertEquals(heal(db, notes, { deep: true }), [])
  write({
    t: 'insert',
    into: 'note',
    cols: ['entity', 'text'],
    rows: [[lit(2001), lit('after')]],
  })
  assertEquals([match('after'), owed(db)], [[2001], []])
  done()
})
