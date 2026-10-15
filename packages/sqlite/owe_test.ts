import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import {
  as,
  catalogue,
  col,
  count,
  type CreateIndex,
  type CreateTable,
  type Driver,
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
import { loadVocab } from '@yaks/vocab'
import { imaged, preparedDriver, type Snapshot } from './testing.ts'
import { META } from './layout.ts'
import { storage } from './mod.ts'
import {
  build as buildAt,
  type Daily,
  DAY,
  filler as fillerAt,
  owed,
  RETRY,
  type Sizes,
  statistics,
  work as workAt,
} from './owe.ts'
import { adopt, type Field, heal } from '@yaks/fts'

// Insert rows numbered `from` to `to` into `into`, as `entity` and `x`.
let rows = (
  db: Driver,
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

// A table is big at three rows and a window is two or three: the same rules as
// the box's thousands, without building them.
let tiny: Sizes = { big: 3, fill: 2, copy: 3, clear: 3 }
let build = (db: Driver, stmts: Stmt[]) => buildAt(db, stmts, tiny)
let filler = (db: Driver) => fillerAt(db, tiny)
let work = (db: Driver, now?: number, daily?: Daily[]) =>
  workAt(db, now, daily, tiny)

// A copy of a database standing in for a file (owing is what a file does).
let copy = (from: Snapshot) =>
  Object.assign(preparedDriver(from), { file: true })

// A file with a `server_meta` and four tables: `big` holding `tiny.big` rows,
// `small` one, and `dup` two (all ones in `x`, so a unique index over `big` or
// `dup` fails), and `note` holding words.
let files = imaged((db) => {
  db.query({
    t: 'create table',
    name: META,
    ifNot: true,
    cols: [{ name: 'k', type: 'text', pk: true }, { name: 'v', type: 'text' }],
  })
  for (let name of ['big', 'small', 'dup', 'note']) db.query(keyed(name))
  rows(db, 'big', tiny.big, lit(1))
  rows(db, 'small', 1, lit(1))
  rows(db, 'dup', 2, lit(1))
  rows(db, 'note', tiny.fill + 1)
})
let file = () => copy(files)
let index = (on: string, unique = false): CreateIndex => ({
  t: 'create index',
  name: `${on}_x`,
  on,
  cols: [col('x')],
  ifNot: true,
  unique,
})
let has = (db: Driver, name: string) =>
  catalogue(db).some((o) => o.name == name)
// Work every owed window off.
let drain = (db: Driver) => {
  for (let w; (w = work(db));) if ('error' in w) throw w.error
}

test('an index over a big table is owed, and one window builds it', () => {
  using db = file()
  build(db, [index('big'), index('small')])
  assertEquals([has(db, 'big_x'), has(db, 'small_x')], [false, true])
  assertEquals(owed(db).map((w) => w.name), ['big_x'])
  assertEquals(work(db), { name: 'owed:index:big_x', done: true })
  assertEquals([has(db, 'big_x'), owed(db), work(db)], [true, [], undefined])
})

test('a window that fails waits an hour, and a dropped table takes its work', () => {
  using db = file()
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
})

test('a unique index the rows break is answered unbuilt, and the rest stands', () => {
  using db = file()
  let left = build(db, [index('dup', true), index('small', true)])
  assertEquals([has(db, 'dup_x'), has(db, 'small_x')], [false, true])
  assertEquals(left.map((e) => e.message.split(':')[0]), [
    'dup_x is not built',
  ])
  assertThrows(() => build(db, [{ ...index('dup', true), cols: [col('y')] }]))
})

test('a database in memory builds every index at once', () => {
  using db = preparedDriver(files)
  build(db, [index('big')])
  assertEquals([has(db, 'big_x'), owed(db)], [true, []])
})

// The rowids the text index `fts` finds `word` in.
let match = (db: Driver, word: string, fts = 'note_fts') =>
  db.query(select({
    cols: [col('rowid')],
    from: table(fts),
    where: op('match', col(fts), lit(word)),
  })).map((r) => Number(r.rowid))
let notes: Field[] = [{ comp: 'note', prop: 'x' }]
let adopted = (fields: Field[]) => (db: Driver) =>
  adopt(db, fields, {}, { heal: false, fill: filler(db) })
// A text index over `note`, `n` windows into its fill: the first takes w1 and
// w2, the second w3, the third finds nothing more and ends it.
let filling = (n: number) =>
  imaged((db) => {
    adopted(notes)(db)
    for (let i = 0; i < n; i++) work(db)
  }, files)
let [started, filled] = [1, 3].map(filling)

test('a text index over many rows is owed, and empty until a window fills it', () => {
  using db = file()
  adopted(notes)(db)
  assertEquals(
    [match(db, 'w1'), owed(db).map((w) => w.name)],
    [[], ['note_fts']],
  )
})

// Writes to `note`.
let word = (id: number, x: string): Stmt => ({
  t: 'update',
  table: 'note',
  set: { x: lit(x) },
  where: eq(col('entity'), lit(id)),
})
let unsaid = (id: number): Stmt => ({
  t: 'delete',
  from: 'note',
  where: eq(col('entity'), lit(id)),
})
let said = (id: number, x: string): Stmt => ({
  t: 'insert',
  into: 'note',
  cols: ['entity', 'x'],
  rows: [[lit(id), lit(x)]],
})

// The fill with w1 and w2 in, written to as `stmt` says, and `more` windows
// on: the rowids `word` is found in. Behind the cursor the triggers keep the
// index; ahead of it the windows do.
for (
  let [name, stmt, more, found, want] of [
    [
      'a write behind the cursor is kept by the triggers',
      word(1, 'changed'),
      0,
      'changed',
      [1],
    ],
    [
      'a delete behind the cursor is kept by the triggers',
      unsaid(2),
      0,
      'w2',
      [],
    ],
    [
      'a write ahead of the cursor is read by its window',
      word(3, 'changed'),
      1,
      'changed',
      [3],
    ],
    [
      'a delete ahead of the cursor is read by its window',
      unsaid(3),
      1,
      'w3',
      [],
    ],
    [
      'a row made ahead of the cursor is read by its window',
      said(100, 'late'),
      1,
      'late',
      [100],
    ],
  ] as [string, Stmt, number, string, number[]][]
) {
  test(name, () => {
    using db = copy(started)
    db.query(stmt)
    for (let i = 0; i < more; i++) work(db)
    assertEquals(match(db, found), want)
  })
}

test('a text index filled stands whole, its triggers kept', () => {
  using db = copy(filled)
  assertEquals([heal(db, notes, { deep: true }), owed(db)], [[], []])
  db.query(said(101, 'after'))
  assertEquals(match(db, 'after'), [101])
})

test('a new text index read through a view is sized by the view, and owed', () => {
  using db = file()
  adopted(scopedFields)(db)
  assertEquals(owed(db).map((w) => w.name), ['big_fts'])
})

let scopedFields: Field[] = [{ comp: 'note', prop: 'x', on: 'big' }]
let scoped = imaged(adopted(scopedFields), files)

test('a text index read through a view is filled whole', () => {
  using db = copy(scoped)
  drain(db)
  assertEquals(
    ['w1', 'w2', 'w3'].flatMap((w) => match(db, w, 'big_fts')),
    [1, 2, 3],
  )
})

// A write its trigger missed: the index no longer holds every row.
let drifted = imaged((db) => {
  adopt(db, notes)
  db.query({ t: 'drop', kind: 'trigger', name: 'note_fts_insert' })
  rows(db, 'note', tiny.fill + 2, lit('missed'), tiny.fill + 2)
}, files)

test('a drifted text index is owed a refill, and one filling is left be', () => {
  using db = copy(drifted)
  let fill = filler(db)
  assertEquals(heal(db, notes, { fill }), ['note_fts'])
  assertEquals([owed(db).map((w) => w.name), heal(db, notes, { fill })], [
    ['note_fts'],
    [],
  ])
})

test('a drifted text index is refilled in windows', () => {
  using db = copy(drifted)
  heal(db, notes, { fill: filler(db) })
  drain(db)
  assertEquals(match(db, 'missed'), [tiny.fill + 2])
})

// What `work` does, each at the time it is asked.
let did = (db: Driver, at: number, daily: Daily[]) => {
  let names: string[] = []
  for (let w; (w = work(db, at, daily));) {
    names.push(`${w.name}${'error' in w ? ' failed' : ''}`)
  }
  return names
}

test('upkeep is done once a day, and one that fails waits an hour', () => {
  using db = file()
  let now = Date.now()
  let fails = true
  let daily: Daily[] = [statistics, {
    name: 'check',
    run: () => {
      if (fails) throw new Error('not today')
    },
  }]
  assertEquals(did(db, now, daily), ['daily:statistics', 'daily:check failed'])
  fails = false
  assertEquals(did(db, now + 1, daily), [])
  assertEquals(did(db, now + RETRY, daily), ['daily:check'])
  assertEquals(did(db, now + RETRY + DAY, daily), [
    'daily:statistics',
    'daily:check',
  ])
})

test('statistics are due as soon as an index is built', () => {
  using db = file()
  let now = Date.now()
  assertEquals(did(db, now, [statistics]), ['daily:statistics'])
  build(db, [index('big')])
  assertEquals(did(db, now, [statistics]), [
    'owed:index:big_x',
    'daily:statistics',
  ])
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
let hens = creatures(['fox', 'owl', 'hen'])
let owls = creatures(['fox', 'owl'])

// What the composed schema puts on the creature table beside it: an index, and
// a trigger writing each new creature to `log`.
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

// A file holding five foxes, each `c<i>`, under a vocabulary that also allows
// hens, with what `beside` puts on their table and a view over it.
let foxes = (db: Driver) => {
  storage(db, hens, { sizes: tiny }).install()
  rows(db, 'entity', 5, fn('printf', lit('c%d'), col('i')))
  rows(db, 'creature', 5, lit('fox'))
  erect(db, [
    { t: 'create table', name: 'log', cols: [{ name: 'entity' }] },
    {
      t: 'create view',
      name: 'seen',
      q: select({ cols: [col('entity'), col('x')], from: table('creature') }),
    },
    ...beside,
  ])
}
// The vocabulary drops hens: the table's rebuild is owed.
let refit = (db: Driver) => storage(db, owls, { sizes: tiny }).install(beside)
let standing = imaged(foxes)
// The rebuild `n` windows on: the first two copy c1 to c3 and c4 to c5, the
// third swaps the names, the next three clear the old rows and drop them.
let windows = (n: number) =>
  imaged((db) => {
    foxes(db)
    refit(db)
    for (let i = 0; i < n; i++) work(db)
  })
let [copying, copied, swapped, rebuilt] = [1, 2, 3, 6].map(windows)

let aside = (db: Driver) =>
  catalogue(db).filter((o) => o.name.startsWith('_yaks_')).map((o) => o.name)
let tally = (db: Driver, from: string) =>
  db.query(select({
    cols: [col('x'), as(count(), 'n')],
    from: table(from),
    group: [col('x')],
    order: [col('x')],
  })).map((r) => Object.values(r))

test('a big table whose check moved is owed a rebuild beside itself', () => {
  using db = copy(standing)
  refit(db)
  assertEquals(owed(db).map((w) => w.name), ['creature'])
  assertEquals(aside(db).includes('_yaks_refit_creature'), true)
})

// Writes to the creature table, as the store makes them.
let owl = (id: number): Stmt => ({
  t: 'update',
  table: 'creature',
  set: { x: lit('owl') },
  where: eq(col('entity'), lit(id)),
})
let gone = (id: number): Stmt => ({
  t: 'delete',
  from: 'creature',
  where: eq(col('entity'), lit(id)),
})
let back = (id: number): Stmt => ({
  t: 'insert',
  into: 'creature',
  cols: ['entity', 'x'],
  rows: [[lit(id), lit('owl')]],
})
let made = (id: number): Stmt[] => [{
  t: 'insert',
  into: 'entity',
  cols: ['id', 'eid'],
  rows: [[lit(id), lit('late')]],
}, back(id)]

// The rebuild with c1 to c3 copied, written to as `writes` say, and `more`
// windows on: what the new table holds. A write behind the cursor reaches it
// through the triggers, one ahead through the window that reads it.
let behind = 0, ahead = 1
let writes: [string, Stmt[], number, [string, number][]][] = [
  ['a write behind the cursor is carried across', [owl(2)], behind, [
    ['fox', 2],
    ['owl', 1],
  ]],
  ['a delete behind the cursor is carried across', [gone(3)], behind, [
    ['fox', 2],
  ]],
  [
    'a row put back behind the cursor is carried across',
    [gone(1), back(1)],
    behind,
    [['fox', 2], ['owl', 1]],
  ],
  ['a write ahead of the cursor is read by its window', [owl(5)], ahead, [
    ['fox', 4],
    ['owl', 1],
  ]],
  ['a delete ahead of the cursor is read by its window', [gone(5)], ahead, [
    ['fox', 4],
  ]],
  ['an entity made meanwhile is read by its window', made(6), ahead, [
    ['fox', 5],
    ['owl', 1],
  ]],
]
for (let [name, stmts, more, want] of writes) {
  test(name, () => {
    using db = copy(copying)
    for (let s of stmts) db.query(s)
    for (let i = 0; i < more; i++) work(db)
    assertEquals(tally(db, '_yaks_refit_creature'), want)
  })
}

test('once every row is across, one window swaps the names', () => {
  using db = copy(copied)
  assertEquals(work(db), { name: 'owed:refit:creature', done: true })
  assertEquals(tally(db, 'seen'), [['fox', 5]])
  assertEquals(owed(db).map((w) => w.name), [
    'creature_x',
    '_yaks_old_creature',
  ])
})

test('the old rows of a rebuilt table are cleared in windows, then dropped', () => {
  using db = copy(swapped)
  drain(db)
  assertEquals([aside(db), owed(db)], [[], []])
})

test('what stood on the old table stands on the rebuilt one, with its check', () => {
  using db = copy(rebuilt)
  let s = storage(db, owls, { sizes: tiny })
  s.tx((tx) => tx.patch([{ entity: { eid: 'after' }, creature: { x: 'owl' } }]))
  let logged = db.query(select({ cols: [col('entity')], from: table('log') }))
  assertEquals([logged.length, has(db, 'creature_x')], [1, true])
  let hen = { entity: { eid: 'hen' }, creature: { x: 'hen' } }
  assertThrows(() => s.tx((tx) => tx.patch([hen])), Error, 'CHECK')
})

test('a rebuild is given up once the table fits its vocabulary again', () => {
  using db = copy(copying)
  assertEquals(aside(db).includes('_yaks_refit_creature'), true)
  storage(db, hens, { sizes: tiny }).install(beside)
  assertEquals([aside(db), owed(db)], [[], []])
})
