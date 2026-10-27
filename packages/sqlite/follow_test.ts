import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { col, type CreateTable, insert, lit, select, table } from '@yaks/sql'
import { columns } from './physical.ts'
import { preparedDriver, snapshot } from './testing.ts'
import { add, follow, forget, lacking, printOf } from './follow.ts'
import { storage as readStore } from './read-store.ts'
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
let image = snapshot(vocab, {}, [
  insert('entity', { id: 1, eid: 'n1', num: 1 }),
  insert('note', { entity: 1, text: 'hi' }),
  log([]),
])
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
