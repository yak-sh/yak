// A query's owner filters bound text membership before temporary hit sets grow.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'
import { search } from './compile.ts'
import { seed, text, vocab } from '../../workers/yak/fts_cost_fixture.ts'

let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let db = new Database(':memory:'), sql = driver(db)
let history = 128
seed(sql, history)
let statement = compile(parse('dragon .entity.eid=near,far'), vocab, {
  extend: [search(text, sql)],
})
let plan = sql.query({ t: 'explain query plan', of: statement })
  .map((r) => String(r.detail)).join('\n')
test('a finite owner screen bounds membership despite unrelated matching history', () => {
  let prepared = db.prepare(statement.sql)
  try {
    let rows = prepared.all(...statement.params)
    assertEquals(rows.map((r) => r.eid).sort(), ['far', 'near'])
    let steps = counters.symbols.sqlite3_stmt_status(
      prepared.unsafeHandle,
      4,
      0,
    )
    assert(steps < 1000, `${steps} VM instructions\n${plan}`)
  } finally {
    prepared.finalize()
  }
})

// A word in many visible rows, beside a filter of more owners than a text
// clause seeks one by one, which drives the read: the
// visibility the outer query already gave each owner is not asked again of
// every row holding the word. On the box that was an entity seek for each of
// millions of transcript rows holding `task`, read cold off disk.
let stepped = (count: number, visibility?: { entity: string }) => {
  let db = new Database(':memory:'), sql = driver(db)
  seed(sql, count)
  let s = compile(parse('dragon .entity.eid=near,far,a,b,c'), vocab, {
    visibility,
    extend: [search(text, sql)],
  })
  let prepared = db.prepare(s.sql)
  try {
    assertEquals(prepared.all(...s.params).map((r) => r.eid), ['near', 'far'])
    return counters.symbols.sqlite3_stmt_status(prepared.unsafeHandle, 4, 0)
  } finally {
    prepared.finalize()
  }
}
test('visibility costs a text clause per owner, not per row holding the word', () => {
  let cost = (count: number) =>
    stepped(count, { entity: '.prose' }) - stepped(count)
  let few = cost(history), many = cost(8 * history)
  assert(
    many - few < history,
    `${few} steps over ${history} rows, ${many} over ${8 * history}`,
  )
})
