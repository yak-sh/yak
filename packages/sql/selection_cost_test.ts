// Mixed extension/presence reads must seek hits under stale small statistics.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { search } from '@yaks/fts'
import { parse } from '@yaks/query'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { type BindOpts, compile, type Row } from './mod.ts'
import { mixed, seed, text, vocab } from '../../workers/yak/fts_cost_fixture.ts'

let db = new Database(':memory:'), sql = driver(db)
seed(sql, 128)
mixed(sql)
let extension = search(text, sql)
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})
let query = (line: string, opts: BindOpts = {}) =>
  compile(parse(line), vocab, { ...opts, extend: [extension] })
let sparse = query('needle thread .comment .limit=2')
let plan = sql.query({ t: 'explain query plan', of: sparse })
  .map((r) => String(r.detail)).join('\n')
let ids = (rows: Row[]) => rows.map((r) => r.eid)
let either = query('.comment (needle|thread)')
let absent = query('needle .comment !extra')
let hidden = query('needle thread .comment', {
  visibility: {
    entity: '.entity.eid=near',
    components: { prose: '.entity.eid!=near' },
  },
})

test('mixed text and component reads seek sparse hits after component history grows', () => {
  let stmt = db.prepare(sparse.sql)
  try {
    assertEquals(ids(stmt.all(...sparse.params)), ['far', 'near'])
    let scans = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 0)
    let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
    assert(scans < 20, `${scans} full-scan advances\n${plan}`)
    assert(steps < 700, `${steps} VM instructions\n${plan}`)
  } finally {
    stmt.finalize()
  }
})

test('extension disjunctions keep their required component', () =>
  assertEquals(ids(sql.query(either)), ['near', 'far']))
test('extension candidates retain absence tests', () =>
  assertEquals(ids(sql.query(absent)), ['far']))
test('extension candidates retain component visibility', () =>
  assertEquals(ids(sql.query(hidden)), []))
