// One entity's backlinks seek each reference column's index in every arm of
// the union, not only the first: SQLite plans a later arm without the target's
// one-row estimate, and left to choose there walks the arm's whole table.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { col, compile, insert, type Row } from './mod.ts'

let ref = { type: 'string', ref: 'entity' } as const
let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
    anchor: { component: true, properties: { to: ref } },
    link: { component: true, properties: { to: ref } },
  },
})
let db = new Database(':memory:'), sql = driver(db)
let tables: Record<string, string[]> = {
  entity: ['eid', 'num'],
  anchor: ['to'],
  link: ['to'],
  tombstone: [],
}
for (let [name, cols] of Object.entries(tables)) {
  sql.query({
    t: 'create table',
    name,
    cols: [
      { name: name == 'entity' ? 'id' : 'entity', type: 'integer', pk: true },
      ...cols.map((name) => ({
        name,
        type: name == 'eid' ? 'text' as const : 'integer' as const,
      })),
    ],
  })
  for (let c of cols) {
    sql.query({
      t: 'create index',
      name: `${name}_${c}`,
      on: name,
      cols: [col(c)],
    })
  }
}
// Every entity links to the one before it, and three also anchor at the
// first: the first arm is small, the second is every entity.
db.exec('begin')
for (let id = 1; id <= 20_000; id++) {
  sql.query(insert('entity', { id, eid: `row-${id}`, num: id }))
  sql.query(insert('link', { entity: id, to: id - 1 }))
  if ([20, 1000, 2001].includes(id)) {
    sql.query(insert('anchor', { entity: id, to: 1 }))
  }
}
db.exec('commit')
db.exec('analyze')

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})

test('one entity’s backlinks seek every arm’s index', () => {
  let q = compile(parse('.refs=row-1'), vocab)
  let stmt = db.prepare(q.sql)
  try {
    let eids = stmt.all<Row>(...q.params).map((r) => r.eid)
    let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
    assertEquals(eids, ['row-2', 'row-20', 'row-1000', 'row-2001'])
    assert(steps < 1_000, `${steps} VM instructions`)
  } finally {
    stmt.finalize()
  }
})
