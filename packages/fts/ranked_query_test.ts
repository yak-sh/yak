// Relevance orders remain ordinary pageable orders through the query door.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'
import { search } from './compile.ts'
import { fields } from './fields.ts'
import { shelf, shop } from './testing.ts'

let db = shelf(), extension = search(fields(shop), db)
let ask = (line: string) =>
  db.query(compile(parse(line), shop, {
    extend: [extension],
  })).map((r) => r.eid)
let all = ask('dragon .order=search')
let compiled = (line: string) =>
  compile(parse(line), shop, { extend: [extension] })
let first = compiled('dragon .order=search .limit=1')
let next = compiled(`dragon .order=search .after=${all[0]}`)
let reverse = [...all].reverse()
let down = compiled('dragon .order=-search')
let previous = compiled(`dragon .order=-search .after=${reverse[0]}`)
let ids = (q: typeof first) => db.query(q).map((r) => r.eid)
test('a text ranking pages through its ordinary eid cursor', () => {
  assertEquals(ids(first), all.slice(0, 1))
  assertEquals(ids(next), all.slice(1))
})
test('a text ranking reverses and pages in that direction', () => {
  assertEquals(ids(down), reverse)
  assertEquals(ids(previous), reverse.slice(1))
})
