import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  col,
  type CreateTable,
  insert,
  lit,
  notNull,
  select,
  table,
} from '@yaks/sql'
import { columns, objects } from './physical.ts'
import {
  classified,
  preparedDriver,
  type Snapshot,
  snapshot,
} from './testing.ts'
import { add, follow, forget, lacking, type Named, printOf } from './follow.ts'
import { storage as readStore } from './read-store.ts'
import { storage } from './mod.ts'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    note: { component: true, properties: { text: { type: 'string' } } },
  },
})
let log = (cols: CreateTable['cols']): CreateTable => ({
  t: 'create table',
  name: 'log',
  ifNot: true,
  cols: [{ name: 'id', type: 'integer', pk: true }, ...cols],
})

// A file the vocabulary is installed in, holding the note `n1`.
let image = classified(snapshot(vocab, {}, [
  insert('entity', { id: 1, eid: 'n1', num: 1 }),
  insert('note', { entity: 1, text: 'hi' }),
  log([]),
]))
let fresh = () => preparedDriver(image)
let [a, b] = ['a', 'b'].map((s) => printOf(s, []))

test('a file follows its schema once per print', () => {
  let db = fresh()
  let passes = 0
  let at = (print: string) => follow(db, print, () => void passes++)
  assertEquals([at(a), at(a), passes], [true, false, 1])
  assertEquals([at(b), at(b), passes], [true, false, 2])
  // The older print is still recorded: its process finds nothing to do.
  assertEquals([at(a), passes], [false, 2])
})

test('a file is added the columns its tables lack', () => {
  let db = fresh()
  add(db, [log([
    { name: 'at', type: 'text', notNull: true },
    { name: 'n', type: 'integer', notNull: true, default: lit(0) },
  ])])
  assertEquals(columns(db, 'log'), ['id', 'at', 'n'])
  db.query({ t: 'insert', into: 'log', cols: ['id'], rows: [[lit(1)]] })
  assertEquals(db.query(select({ cols: [col('n')], from: table('log') })), [
    { n: 0 },
  ])
})

test('a pass reads the columns only of tables that stood declared otherwise', () => {
  let db = fresh(), asked: unknown[] = []
  let query = db.query.bind(db)
  db.query = (s) => {
    if (s.t == 'pragma' && s.name == 'table_info') asked.push(s.arg)
    return query(s)
  }
  let made = (cols: CreateTable['cols']) => ({ ...log(cols), name: 'made' })
  add(db, [log([]), made([]), made([{ name: 'at', type: 'text' }])])
  assertEquals(asked, ['made'])
  assertEquals(columns(db, 'made'), ['id', 'at'])
})

test('a reader asks no table about its columns where the file declares it as the vocabulary does', () => {
  let db = fresh(), asked: unknown[] = []
  let query = db.query.bind(db)
  db.query = (s) => {
    if (s.t == 'pragma' && ['entity', 'note'].includes(String(s.arg))) {
      asked.push(s.arg)
    }
    return query(s)
  }
  assertEquals(lacking(db, vocab, {}, true), { derived: {}, absent: [] })
  assertEquals(asked, [])
})

test('an unfinished pass leaves its print for the next opener, and so does forget', () => {
  let db = fresh()
  let print = printOf('store', [])
  let passes = 0
  let at = (done: boolean) =>
    follow(db, print, () => {
      passes++
      return done
    })
  assertEquals([at(false), at(true), at(true), passes], [true, true, false, 2])
  forget(db, print)
  assertEquals([at(true), passes], [true, 3])
})

// A file a wider vocabulary was installed in: of the components `vocab` no
// longer names, `pin` was never worn and `jot` still is, and of the
// properties, `note.mood` was given once and `note.tone` never, though an
// index and a view name it. `queue` is a host's table beside the store's.
let wide = loadVocab({
  $defs: {
    note: {
      component: true,
      properties: Object.fromEntries(
        ['text', 'mood', 'tone'].map((p) => [p, { type: 'string' }]),
      ),
    },
    pin: { component: true, properties: { at: { type: 'string' } } },
    jot: { component: true, properties: { at: { type: 'string' } } },
  },
})
let queue: CreateTable = {
  t: 'create table',
  name: 'queue',
  ifNot: true,
  cols: [{ name: 'entity', type: 'integer', pk: true }],
}
let wider = classified(snapshot(wide, {}, [
  insert('entity', { id: 1, eid: 'n1', num: 1 }),
  insert('entity', { id: 2, eid: 'j1', num: 2 }),
  insert('note', { entity: 1, text: 'hi', mood: 'glad' }),
  insert('jot', { entity: 2, at: 'now' }),
  { t: 'create index', name: 'by_tone', on: 'note', cols: [col('tone')] },
  {
    t: 'create view',
    name: 'tones',
    q: select({ cols: [col('tone')], from: table('note') }),
  },
  queue,
]))
let narrow: Named = { vocab, beside: [queue] }
// What of the wider file stands: the note's columns, and which of the objects
// beside them.
let stands = (db: ReturnType<typeof fresh>) => [
  columns(db, 'note'),
  ['pin', 'jot', 'queue', 'by_tone', 'tones'].filter((name) =>
    objects(db, { name }).length
  ),
]

test('a file sheds what its vocabulary stopped naming and holds nothing in', () => {
  let db = preparedDriver(wider)
  follow(db, a, () => {})
  assertEquals(stands(db), [
    ['entity', 'text', 'mood', 'tone'],
    ['pin', 'jot', 'queue', 'by_tone', 'tones'],
  ])
  let store = storage(db, vocab)
  follow(db, b, () => void store.install(), narrow)
  assertEquals(stands(db), [['entity', 'text', 'mood'], ['jot', 'queue']])
  assertEquals(store.get(['n1'])[0].note, { text: 'hi' })
})

test('a file keeps a column SQLite will not drop, and sheds the rest', () => {
  // `slot` is unique, `step`'s check names `lane`, and a view stands over a
  // table that is gone, which SQLite refuses any column's drop for.
  let held: CreateTable = {
    ...queue,
    cols: [
      ...queue.cols,
      { name: 'slot', type: 'text', unique: true },
      { name: 'lane', type: 'text' },
      { name: 'step', type: 'text', check: notNull(col('lane')) },
      { name: 'gap', type: 'text' },
    ],
  }
  let stray = {
    t: 'create view' as const,
    name: 'stray',
    q: select({ cols: [col('x')], from: table('gone') }),
  }
  let db = preparedDriver(classified(snapshot(vocab, {}, [held, stray])))
  let passes = 0
  follow(db, a, () => void passes++, narrow)
  assertEquals(
    [columns(db, 'queue'), objects(db, { name: 'stray' }), passes],
    [['entity', 'slot', 'lane'], [], 1],
  )
})

for (
  let [what, from, want] of [
    ['forgets the other prints it recorded', wider, [true, 3]],
    ['with nothing to shed keeps the prints it recorded', image, [false, 2]],
  ] as [string, Snapshot, [boolean, number]][]
) {
  test(`a file that follows what its schema names ${what}`, () => {
    let db = preparedDriver(from), passes = 0
    let at = (print: string, named?: Named) =>
      follow(db, print, () => void passes++, named)
    at(a)
    at(b, narrow)
    assertEquals([at(a), passes], want)
  })
}

// A vocabulary that gained a column and a component after the file was made,
// read by a reader no writer has caught up with.
let later = loadVocab({
  $defs: {
    note: {
      component: true,
      properties: { text: { type: 'string' }, mood: { type: 'string' } },
    },
    pin: { component: true, properties: { at: { type: 'string' } } },
  },
})
// The reader of such a file, which changes nothing and so serves every test.
let reader = fresh()
let lag = lacking(reader, later)
let read = readStore(reader, later, lag)

test('a reader reads a property the file has no column for as never given', () => {
  assertEquals(read.read(parse('.note')).map((b) => b.note), [
    { text: 'hi' },
  ])
})

// What a query finds beside the table `pin` the file has no table for.
for (
  let [q, want] of [
    ['.pin', []],
    ['.note !pin', ['n1']],
    ['.pin.at=x | .note', ['n1']],
    ['*', ['n1']],
  ] as [string, string[]][]
) {
  test(`a reader finds ${want.length} for ${q} where no entity wears a component the file has no table for`, () => {
    assertEquals(read.read(parse(q)).map((b) => b.entity.eid), want)
  })
}

test('a reader names the components the file has no table for, and reads the others whole', () => {
  assertEquals(lag.absent, ['pin'])
  assertEquals(read.get(['n1']).map((b) => Object.keys(b).sort()), [
    ['entity', 'note'],
  ])
})

test('a reader of a file at its vocabulary lacks nothing', () => {
  assertEquals(lacking(fresh(), vocab), { derived: {}, absent: [] })
})
