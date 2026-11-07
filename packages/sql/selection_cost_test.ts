// Mixed extension/presence reads must seek hits under stale small statistics.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { search } from '@yaks/fts'
import { parse } from '@yaks/query'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import {
  among,
  type BindOpts,
  col,
  compile,
  type Row,
  select,
  table,
  val,
} from './mod.ts'
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

// A printed #handle is resolved as a range over the text eid, not a scan of
// every entity. Numeric-looking text remains text, including leading zeros.
let handles = [
  ['.entity.eid=near..nearg', ['near']],
  ['.entity.eid>nea .entity.eid<neas', ['near']],
  ['.entity.eid=far', ['far']],
] as const
for (let [line, expected] of handles) {
  let compiled = query(line)
  let explanation = sql.query({ t: 'explain query plan', of: compiled })
    .map((r) => String(r.detail)).join('\n')
  test(`eid lookup seeks the spine index: ${line}`, () => {
    let stmt = db.prepare(compiled.sql)
    try {
      assertEquals(ids(stmt.all(...compiled.params)), [...expected])
      let scans = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 0)
      assert(scans < 20, `${scans} full-scan advances\n${explanation}`)
    } finally {
      stmt.finalize()
    }
  })
}

// A search's first page selects the ids it ranked. Every comment matching, and
// statistics describing two, the read seeks those few rather than testing each
// comment against them.
let broad = new Database(':memory:'), broadSql = driver(broad)
seed(broadSql, 128)
mixed(broadSql)
broadSql.query({
  t: 'update',
  table: 'prose',
  set: { body: val('dragon scale') },
  where: among(
    col('entity'),
    select({ cols: [col('entity')], from: table('comment') }),
  ),
})
let page = compile(parse('dragon scale .comment .limit=2'), vocab, {
  extend: [search(text, broadSql)],
})
test('a ranked page drives from its ids, not every owner it could be', () => {
  let stmt = broad.prepare(page.sql)
  try {
    assertEquals(ids(stmt.all(...page.params)), [
      'later-1000002',
      'later-1000001',
    ])
    let scans = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 0)
    assert(scans < 20, `${scans} full-scan advances\n${page.sql}`)
  } finally {
    stmt.finalize()
  }
})
