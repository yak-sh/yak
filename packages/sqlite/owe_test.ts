import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import {
  as,
  catalogue,
  col,
  count,
  type CreateIndex,
  type CreateTable,
  eq,
  erect,
  type Expr,
  fn,
  lit,
  lt,
  op,
  select,
  type Stmt,
  table,
  unionAll,
} from '@yaks/sql'
import type { Bundle } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { open } from './db.ts'
import { META } from './layout.ts'
import { storage } from './mod.ts'
import { BIG, build, COPY, FILL, filler, owed, RETRY, work } from './owe.ts'
import { adopt, type Field, heal } from '@yaks/fts'

// Insert rows numbered `from` to `to` into `into`, as `entity` and `x`.
let rows = (
  db: ReturnType<typeof open>,
  into: string,
  to: number,
  x: Expr = fn('printf', lit('w%d'), col('i')),
  from = 1,
) => {
  let ns = unionAll(
    select({ cols: [lit(from)] }),
    select({
      cols: [op('+', col('i'), lit(1))],
      from: table('n'),
      where: lt(col('i'), lit(to)),
    }),
  )
  db.query({
    t: 'insert',
    with: [{ name: 'n', cols: ['i'], q: ns, recursive: true }],
    into,
    cols: into == 'entity' ? ['id', 'eid'] : ['entity', 'x'],
    q: select({ cols: [col('i'), x], from: table('n') }),
  })
}

// A table keyed by entity, with a column `x`.
let keyed = (name: string): CreateTable => ({
  t: 'create table',
  name,
  cols: [{ name: 'entity', type: 'integer', pk: true }, { name: 'x' }],
})

// A database standing in for a file (owing is what a file does), with a
// `server_meta` and three tables: `big` holding BIG rows, `small` holding one,
// (all ones in `x`, so a unique index over `big` fails) and `note`, empty.
let file = () => {
  let db = Object.assign(open(':memory:'), { file: true })
  db.query({
    t: 'create table',
    name: META,
    ifNot: true,
    cols: [{ name: 'k', type: 'text', pk: true }, { name: 'v', type: 'text' }],
  })
  for (let name of ['big', 'small', 'note']) db.query(keyed(name))
  rows(db, 'big', BIG, lit(1))
  rows(db, 'small', 1, lit(1))
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
  let notes: Field[] = [{ comp: 'note', prop: 'x' }]
  rows(db, 'note', FILL + 500)
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
    set: { x: lit('changed') },
    where: eq(col('entity'), lit(10)),
  })
  write({ t: 'delete', from: 'note', where: eq(col('entity'), lit(1200)) })
  write({
    t: 'insert',
    into: 'note',
    cols: ['entity', 'x'],
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
    cols: ['entity', 'x'],
    rows: [[lit(2001), lit('after')]],
  })
  assertEquals([match('after'), owed(db)], [[2001], []])
  done()
})

// A creature whose `x` is one of `kinds`.
let creatures = (kinds: string[]) =>
  loadVocab({
    $defs: {
      entity: { component: true, type: 'object', wire: false, properties: {} },
      creature: {
        component: true,
        type: 'object',
        properties: { x: { type: 'string', enum: kinds } },
      },
    },
  })

// A file holding `n` foxes, each `c<i>`, under a vocabulary that also allows
// hens, with what the composed schema puts on their table beside it (an index,
// and a trigger writing each new creature to `log`) and a view over it.
let foxes = (n: number) => {
  let db = Object.assign(open(':memory:'), { file: true })
  storage(db, creatures(['fox', 'owl', 'hen'])).install()
  rows(db, 'entity', n, fn('printf', lit('c%d'), col('i')))
  rows(db, 'creature', n, lit('fox'))
  let beside: Stmt[] = [{ ...index('creature'), name: 'creature_x' }, {
    t: 'create trigger',
    name: 'creature_log',
    ifNot: true,
    timing: 'after',
    event: 'insert',
    on: 'creature',
    body: [{
      t: 'insert',
      into: 'log',
      cols: ['entity'],
      rows: [[col('entity', 'new')]],
    }],
  }]
  erect(db, [
    { t: 'create table', name: 'log', cols: [{ name: 'entity' }] },
    {
      t: 'create view',
      name: 'seen',
      q: select({ cols: [col('entity'), col('x')], from: table('creature') }),
    },
    ...beside,
  ])
  return { db, beside }
}
let aside = (db: ReturnType<typeof open>) =>
  catalogue(db).filter((o) => o.name.startsWith('_yaks_')).map((o) => o.name)
let drain = (db: ReturnType<typeof open>) => {
  for (let w; (w = work(db));) if ('error' in w) throw w.error
}

test('a big table whose check moved is rebuilt beside itself in windows', () => {
  let n = COPY + 500
  let { db, beside } = foxes(n)
  let s = storage(db, creatures(['fox', 'owl']))
  s.install(beside)
  assertEquals(owed(db).map((w) => w.name), ['creature'])
  assertEquals(work(db), { name: 'owed:refit:creature', done: false })
  // Behind the cursor the triggers carry each write across; ahead of it the
  // windows read it.
  let write = (...b: Bundle[]) => s.tx((tx) => tx.patch(b))
  let owl = (eid: string) => ({ entity: { eid }, creature: { x: 'owl' } })
  write(owl('c10'), { entity: { eid: 'c6' }, creature: null })
  write({ entity: { eid: 'c5' }, creature: null })
  write(owl('c5'), { entity: { eid: `c${COPY + 100}` }, creature: null })
  write(owl('late'))
  drain(db)
  let tally = (from: string) =>
    db.query(select({
      cols: [col('x'), as(count(), 'n')],
      from: table(from),
      group: [col('x')],
      order: [col('x')],
    })).map((r) => Object.values(r))
  assertEquals(tally('seen'), [['fox', n - 4], ['owl', 3]])
  assertEquals([aside(db), owed(db)], [[], []])
  // What stood on the old table stands on the new one, with its check.
  write(owl('after'))
  let logged = db.query(select({ cols: [col('entity')], from: table('log') }))
  assertEquals(logged.length, 3)
  assertEquals(catalogue(db).some((o) => o.name == 'creature_x'), true)
  let hen = { entity: { eid: 'hen' }, creature: { x: 'hen' } }
  assertThrows(() => write(hen), Error, 'CHECK')
})

test('a rebuild is given up once the table fits its vocabulary again', () => {
  let { db, beside } = foxes(BIG)
  storage(db, creatures(['fox', 'owl'])).install(beside)
  assertEquals(aside(db).includes('_yaks_refit_creature'), true)
  let s = storage(db, creatures(['fox', 'owl', 'hen']))
  s.install(beside)
  assertEquals([aside(db), owed(db)], [[], []])
  s.tx((tx) => tx.patch([{ entity: { eid: 'hen' }, creature: { x: 'hen' } }]))
})
