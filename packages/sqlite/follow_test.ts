import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { col, type CreateTable, lit, select, table } from '@yaks/sql'
import { open } from './db.ts'
import { columns } from './physical.ts'
import { storage } from './mod.ts'
import { add, follow, printOf } from './follow.ts'
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

test('a file follows its schema once per print, adding what it lacks', () => {
  let db = open(':memory:')
  let store = storage(db, vocab)
  let passes = 0
  let at = (stmts: CreateTable[]) =>
    follow(db, printOf(store.print(), stmts), () => {
      passes++
      store.install()
      add(db, stmts)
    })
  let v1 = [log([])]
  assertEquals([at(v1), at(v1), passes], [true, false, 1])
  let v2 = [log([
    { name: 'at', type: 'text', notNull: true },
    { name: 'n', type: 'integer', notNull: true, default: lit(0) },
  ])]
  assertEquals([at(v2), at(v2), passes], [true, false, 2])
  assertEquals(columns(db, 'log'), ['id', 'at', 'n'])
  // The older print is still recorded: its process finds nothing to do.
  assertEquals([at(v1), passes], [false, 2])
  db.query({ t: 'insert', into: 'log', cols: ['id'], rows: [[lit(1)]] })
  assertEquals(db.query(select({ cols: [col('n')], from: table('log') })), [
    { n: 0 },
  ])
})
