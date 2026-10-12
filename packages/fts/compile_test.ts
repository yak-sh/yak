// A bare word in a query line, compiled to an FTS match through @yaks/sql.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parse } from '@yaks/query'
import { bind, compile } from '@yaks/sql'
import { fields } from './fields.ts'
import { search } from './compile.ts'
import { shelf, shop } from './testing.ts'

let text = fields(shop)
let sql = (line: string) =>
  compile(parse(line), shop, { extend: [search(text)] })
let found = (line: string) => {
  return shelf().query(sql(line)).map((r) => String(r.eid)).sort()
}

test('a word matches every index, and its term rides as a param', () => {
  let { sql: s, params } = sql('dragon')
  assert(s.includes('"book_fts" match ?'), s)
  assert(s.includes('"review_fts" match ?'), s)
  assertEquals(params, ['"dragon"*', '"dragon"*'])
})

test('a word finds prose in any component', () => {
  // Two books say dragon, and so does a review of a third.
  assertEquals(found('dragon'), ['book-1', 'book-2', 'review-4'])
})

test('words and filters mix on one line', () => {
  assertEquals(found('dragon .book.price<15'), ['book-1'])
})

test('two words both have to match', () => {
  assertEquals(found('dragon burglar'), ['book-1'])
})

test('a trailing star prefix-matches the last word', () => {
  assertEquals(found('drag*'), ['book-1', 'book-2', 'review-4'])
})

test('a bare word reaches the longer word it starts', () => {
  assertEquals(found('drag'), ['book-1', 'book-2', 'review-4'])
})

test('a quoted run is one phrase, matched as it stands', () => {
  assertEquals(found('"leaves home"'), ['book-1'])
  assertEquals(found('"home leaves"'), [])
})

test('a search with no word in it finds nothing', () => {
  assertEquals(found('""'), [])
})

let indexed = shelf()
test('a matched entity is found by its spine id, needing no join', () => {
  let db = indexed
  let stmt = bind(parse('dragon'), shop, { extend: [search(text)] })
  assertEquals(
    db.query(stmt).map((row) => String(row.eid)).sort(),
    ['book-1', 'book-2', 'review-4'],
  )
  let plan = db.query({ t: 'explain query plan', of: stmt })
    .map((row) => String(row.detail)).join('\n')
  assert(plan.includes('SEARCH entity USING INTEGER PRIMARY KEY'), plan)
  assert(!/\b(?:SCAN|SEARCH) (?:book|review)\b/.test(plan), plan)
})
