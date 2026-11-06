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
  RECLAIMING,
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
let tiny: Sizes = {
  big: 3,
  fill: 2,
  copy: 3,
  clear: 3,
  slack: 4,
  reclaim: 10,
}
let build = (db: Driver, stmts: Stmt[]) => buildAt(db, stmts, tiny)
let filler = (db: Driver) => fillerAt(db, tiny)
let work = (db: Driver, now?: number, daily?: Daily[]) =>
  workAt(db, now, daily, tiny)

// A copy of a database standing in for a file (owing is what a file does).
let copy = (from: Snapshot) =>
  Object.assign(preparedDriver(from), { file: true })

// What `make` does to a database standing in for a file, made empty or as a
// copy of `from`, kept as a fixture beside what `make` answered. The work a
// test reads is done here, once, as the file loads, each step from the one
// before: worked in the test, each of its statements would be compiled afresh
// on the test's own connection, most of a millisecond.
let stage = <T>(make: (db: Driver) => T, from?: Snapshot): [Snapshot, T] => {
  let out!: T
  return [imaged((db) => void (out = make(db)), from), out]
}
// The moment the stages work at.
let NOW = Date.now()

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

// The file given an index over `big` and one over `small`, and the window
// after.
let [indexing] = stage((db) => build(db, [index('big'), index('small')]), files)
let [indexed, built] = stage((db) => work(db), indexing)

test('an index over a big table is owed, and one over a small one built', () => {
  using db = copy(indexing)
  assertEquals([has(db, 'big_x'), has(db, 'small_x')], [false, true])
  assertEquals(owed(db).map((w) => w.name), ['big_x'])
})

test('one window builds an owed index', () => {
  assertEquals(built, { name: 'owed:index:big_x', done: true })
  using db = copy(indexed)
  assertEquals([has(db, 'big_x'), owed(db), work(db)], [true, [], undefined])
})

// A unique index over `big`, whose rows break it, and the window that fails
// to build it; then its table dropped, and the window an hour on.
let [failing, failed] = stage((db) => {
  build(db, [index('big', true)])
  return work(db, NOW)
}, files)
let [dropped, retried] = stage((db) => {
  db.query({ t: 'drop', kind: 'table', name: 'big' })
  return work(db, NOW + RETRY)
}, failing)

test('a window that fails waits an hour', () => {
  assertEquals(failed && 'error' in failed, true)
  using db = copy(failing)
  assertEquals(owed(db)[0].next, new Date(NOW + RETRY).toISOString())
  assertEquals(work(db, NOW + 1), undefined)
})

test('a dropped table takes the index it was owed', () => {
  assertEquals(retried, { name: 'owed:index:big_x', done: true })
  using db = copy(dropped)
  assertEquals(owed(db), [])
})

// Unique indexes over `dup`, whose rows break one, and over `small`.
let [unbuilt, left] = stage(
  (db) => build(db, [index('dup', true), index('small', true)]),
  files,
)

test('a unique index the rows break is answered unbuilt, and the rest stands', () => {
  assertEquals(left.map((e) => e.message.split(':')[0]), [
    'dup_x is not built',
  ])
  using db = copy(unbuilt)
  assertEquals([has(db, 'dup_x'), has(db, 'small_x')], [false, true])
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
// A text index over `note`, adopted, then into its fill: the first window
// takes w1 and w2, the second w3, the third finds nothing more and ends it.
let [adopting] = stage(adopted(notes), files)
let [started] = stage((db) => work(db), adopting)
let [filled] = stage(drain, started)

test('a text index over many rows is owed, and empty until a window fills it', () => {
  using db = copy(adopting)
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
  let [written] = stage((db) => {
    db.query(stmt)
    for (let i = 0; i < more; i++) work(db)
  }, started)
  test(name, () => {
    using db = copy(written)
    assertEquals(match(db, found), want)
  })
}

test('a text index filled stands whole', () => {
  using db = copy(filled)
  assertEquals([heal(db, notes, { deep: true }), owed(db)], [[], []])
})

test('a text index filled keeps its triggers', () => {
  using db = copy(filled)
  db.query(said(101, 'after'))
  assertEquals(match(db, 'after'), [101])
})

// A text index over `note` read through the view `big`, adopted, then every
// window of its fill.
let [scoped] = stage(adopted([{ comp: 'note', prop: 'x', on: 'big' }]), files)
let [whole] = stage(drain, scoped)

test('a new text index read through a view is sized by the view, and owed', () => {
  using db = copy(scoped)
  assertEquals(owed(db).map((w) => w.name), ['big_fts'])
})

test('a text index read through a view is filled whole', () => {
  using db = copy(whole)
  assertEquals(match(db, 'w1 OR w2 OR w3', 'big_fts'), [1, 2, 3])
})

// A write its trigger missed: the index no longer holds every row. Healed, it
// is owed a refill, then refilled.
let [drifted] = stage((db) => {
  adopt(db, notes)
  db.query({ t: 'drop', kind: 'trigger', name: 'note_fts_insert' })
  rows(db, 'note', tiny.fill + 2, lit('missed'), tiny.fill + 2)
}, files)
let [refilling, healed] = stage(
  (db) => heal(db, notes, { fill: filler(db) }),
  drifted,
)
let [refilled] = stage(drain, refilling)

test('a drifted text index is owed a refill, and one filling is left be', () => {
  assertEquals(healed, ['note_fts'])
  using db = copy(refilling)
  assertEquals(owed(db).map((w) => w.name), ['note_fts'])
  assertEquals(heal(db, notes, { fill: filler(db) }), [])
})

test('a drifted text index is refilled in windows', () => {
  using db = copy(refilled)
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

// The file's upkeep, with a check that fails the first time it runs: what
// was done now, a moment on, an hour on, and a day after that.
let [, upkept] = stage((db) => {
  let fails = true
  let daily: Daily[] = [statistics, {
    name: 'check',
    run: () => {
      if (fails) throw new Error('not today')
    },
  }]
  let first = did(db, NOW, daily)
  fails = false
  return [first, ...[1, RETRY, RETRY + DAY].map((t) => did(db, NOW + t, daily))]
}, files)

test('upkeep is done once a day, and one that fails waits an hour', () => {
  assertEquals(upkept, [
    ['daily:statistics', 'daily:check failed'],
    [],
    ['daily:check'],
    ['daily:statistics', 'daily:check'],
  ])
})

// The statistics done, then an index built over `big`: what was done each
// time.
let [counted, counting] = stage((db) => did(db, NOW, [statistics]), files)
let [, recounting] = stage((db) => {
  build(db, [index('big')])
  return did(db, NOW, [statistics])
}, counted)

test('statistics are due as soon as an index is built', () => {
  assertEquals([counting, recounting], [
    ['daily:statistics'],
    ['owed:index:big_x', 'daily:statistics'],
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
// hens, with what `beside` puts on their table and a view over it. Then the
// vocabulary drops hens, and the table's rebuild is owed.
let [owing] = stage((db) => {
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
  storage(db, owls, { sizes: tiny }).install(beside)
})
// The rebuild's windows: the first two copy c1 to c3 and c4 to c5, the third
// swaps the names, the next three clear the old rows and drop them.
let [copying] = stage((db) => work(db), owing)
let [copied] = stage((db) => work(db), copying)
let [swapped, swap] = stage((db) => work(db), copied)
let [rebuilt] = stage(drain, swapped)

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
  using db = copy(owing)
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
  let [written] = stage((db) => {
    for (let s of stmts) db.query(s)
    for (let i = 0; i < more; i++) work(db)
  }, copying)
  test(name, () => {
    using db = copy(written)
    assertEquals(tally(db, '_yaks_refit_creature'), want)
  })
}

test('once every row is across, one window swaps the names', () => {
  assertEquals(swap, { name: 'owed:refit:creature', done: true })
  using db = copy(swapped)
  assertEquals(tally(db, 'seen'), [['fox', 5]])
  assertEquals(owed(db).map((w) => w.name), [
    'creature_x',
    '_yaks_old_creature',
  ])
})

test('the old rows of a rebuilt table are cleared in windows, then dropped', () => {
  using db = copy(rebuilt)
  assertEquals([aside(db), owed(db)], [[], []])
})

test('what stood on the old table stands on the rebuilt one, with its check', () => {
  using db = copy(rebuilt)
  for (let s of [gone(1), back(1)]) db.query(s)
  let logged = db.query(select({ cols: [col('entity')], from: table('log') }))
  assertEquals([logged.length, has(db, 'creature_x')], [1, true])
  let hen = { ...owl(1), set: { x: lit('hen') } }
  assertThrows(() => db.query(hen), Error, 'CHECK')
})

// The vocabulary that allows hens again, installed mid-rebuild: what was set
// aside before it.
let [refitted, building] = stage((db) => {
  let was = aside(db)
  storage(db, hens, { sizes: tiny }).install(beside)
  return was
}, copying)

test('a rebuild is given up once the table fits its vocabulary again', () => {
  assertEquals(building.includes('_yaks_refit_creature'), true)
  using db = copy(refitted)
  assertEquals([aside(db), owed(db)], [[], []])
})

// A file whose forty rows, a page each, were all deleted, in `mode`.
let freed = (mode: string) =>
  imaged((db) => {
    db.query({ t: 'pragma', name: 'page_size', value: 512 })
    db.query({ t: 'pragma', name: 'auto_vacuum', value: mode })
    db.query({
      t: 'create table',
      name: META,
      cols: [{ name: 'k', type: 'text', pk: true }, { name: 'v' }],
    })
    db.query(keyed('note'))
    rows(db, 'note', 40, fn('printf', lit('%400d'), col('i')))
    db.query({ t: 'delete', from: 'note' })
  })
let incremental = freed('incremental')
let free = (db: Driver) =>
  Number(db.query({ t: 'pragma', name: 'freelist_count' })[0].freelist_count)

// What `work` did, each time asked, and the free pages before and after.
let reclaiming = (db: Driver, ats: number[]) => {
  let was = free(db)
  return { was, did: ats.map((at) => did(db, at, [])), left: free(db) }
}
let [, reclaimed] = stage((db) => reclaiming(db, [NOW]), incremental)
let [, kept] = stage((db) => reclaiming(db, [NOW]), freed('none'))
// A window refused once, then asked again a moment on and an hour on.
let [, refused] = stage((db) => {
  let refusing: Driver = {
    ...db,
    query: (s) => {
      if (s.t == 'pragma' && s.name == 'incremental_vacuum') {
        throw new Error('busy')
      }
      return db.query(s)
    },
  }
  return [
    did(refusing, NOW, []),
    reclaiming(db, [NOW + 1, NOW + RETRY]),
  ] as const
}, incremental)

test('the free pages past the slack are given back, a window at a time', () => {
  let { was, did: [names], left } = reclaimed
  let windows = Math.ceil((was - tiny.slack) / tiny.reclaim)
  assertEquals([names, left], [Array(windows).fill(RECLAIMING), tiny.slack])
})

test('a file not in incremental mode has nothing to give back', () => {
  assertEquals(kept, { was: kept.was, did: [[]], left: kept.was })
})

test('a window that fails to give pages back waits an hour', () => {
  let [failed, { did: [soon, later], left }] = refused
  assertEquals([failed, soon, later.length > 0, left], [
    [`${RECLAIMING} failed`],
    [],
    true,
    tiny.slack,
  ])
})
