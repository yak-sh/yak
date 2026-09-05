// A bare word in a query line, compiled to an FTS match through @yaks/sql.

import { assert, assertEquals } from '@std/assert'
import { parse } from '@yaks/query'
import { compile } from '@yaks/sql'
import { fields } from './fields.ts'
import { search } from './compile.ts'
import { shelf, shop } from './harness.ts'

let text = fields(shop)
let sql = (line: string) =>
  compile(parse(line), shop, { extend: [search(text)] })
let found = (line: string) => {
  let db = shelf()
  let { sql: s, params } = sql(line)
  return db.query(s, params).map((r) => String(r.eid)).sort()
}

Deno.test('a word matches every index, and its term rides as a param', () => {
  let { sql: s, params } = sql('dragon')
  assert(s.includes('"book_fts" match ?'), s)
  assert(s.includes('"review_fts" match ?'), s)
  assertEquals(params, ['"dragon"', '"dragon"'])
})

Deno.test('a word finds prose in any component', () => {
  // Two books say dragon, and so does a review of a third.
  assertEquals(found('dragon'), ['book-1', 'book-2', 'review-4'])
})

Deno.test('words and filters mix on one line', () => {
  assertEquals(found('dragon .price<15'), ['book-1'])
})

Deno.test('two words both have to match', () => {
  assertEquals(found('dragon burglar'), ['book-1'])
})

Deno.test('a trailing star prefix-matches the last word', () => {
  assertEquals(found('drag*'), ['book-1', 'book-2', 'review-4'])
})

Deno.test('a search with no word in it finds nothing', () => {
  assertEquals(found('""'), [])
})

Deno.test('a matched entity is found by its spine id, needing no join', () => {
  let { sql: s } = sql('dragon')
  assert(s.includes('"entity"."id" in (select rowid from "book_fts"'), s)
  assert(!s.includes('left join "book"'), s)
})
