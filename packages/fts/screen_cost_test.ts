// A kind screen must bound the rows ranked, even after text history grows.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { render } from '@yaks/sql'
import { hits } from './search.ts'
import { seed, selected, text } from '../../workers/yak/fts_cost_fixture.ts'

let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})
let db = new Database(':memory:'), sql = driver(db)
let history = 128
seed(sql, history)
let statement = hits(text, 'dragon', { screen: selected, limit: 2 })!
let { sql: query, params } = render(statement)
let plan = sql.query({ t: 'explain query plan', of: statement })
  .map((r) => String(r.detail)).join('\n')
let large = new Database(':memory:'),
  largeSql = driver(large)
let largeHistory = 1000
seed(largeSql, largeHistory)
let narrow = hits(text, 'needle', { screen: selected, limit: 2 })!
let { sql: narrowQuery, params: narrowParams } = render(narrow)
let narrowPlan = largeSql.query({ t: 'explain query plan', of: narrow })
  .map((r) => String(r.detail)).join('\n')

let ranked = db.prepare(query)
let narrowRanked = large.prepare(narrowQuery)
test('a screened ranking reads its neighborhood despite unrelated matching history', () => {
  let prepared = ranked
  try {
    let rows = prepared.all(...params)
    assertEquals(rows.map((r) => r.entity), ['near', 'far'])
    assert(String(rows[0].snippet).includes('\x01dragon\x02'))
    let scans = counters.symbols.sqlite3_stmt_status(
      prepared.unsafeHandle,
      1,
      0,
    )
    let steps = counters.symbols.sqlite3_stmt_status(
      prepared.unsafeHandle,
      4,
      0,
    )
    assert(scans < history + 20, `${scans} full-scan advances\n${plan}`)
    assert(steps < history * 90, `${steps} VM instructions\n${plan}`)
  } finally {
    prepared.finalize()
  }
})

test(
  'a narrow ranked term probes a large screen and keeps hit order and snippets',
  () => {
    let prepared = narrowRanked
    try {
      let rows = prepared.all(...narrowParams)
      assertEquals(rows.map((r) => r.entity), ['near', 'far'])
      assert(String(rows[0].snippet).includes('\x01needle\x02'))
      let scans = counters.symbols.sqlite3_stmt_status(
        prepared.unsafeHandle,
        1,
        0,
      )
      let steps = counters.symbols.sqlite3_stmt_status(
        prepared.unsafeHandle,
        4,
        0,
      )
      assert(
        scans < 100,
        `${scans} full-scan advances, ${steps} VM instructions\n${narrowPlan}`,
      )
    } finally {
      prepared.finalize()
    }
  },
)
