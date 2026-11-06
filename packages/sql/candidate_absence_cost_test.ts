// An absence beside a disjunction's few candidates probes each candidate, not
// every row of the absent component.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { col, compile, indexName, insert } from './mod.ts'

let ref = { type: 'string', ref: 'entity' }
let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
    edge: { component: true, properties: { from: ref, to: ref } },
    comment: { component: true, properties: { target: ref } },
    references: { component: true, properties: {} },
  },
})
let db = new Database(':memory:'), sql = driver(db)
let tables: [string, string[]][] = [
  ['edge', ['from', 'to']],
  ['comment', ['target']],
  ['references', []],
  ['tombstone', []],
]
sql.query({
  t: 'create table',
  name: 'entity',
  cols: [
    { name: 'id', type: 'integer', pk: true },
    { name: 'eid', type: 'text', unique: true },
    { name: 'num', type: 'integer' },
  ],
})
for (let [name, refs] of tables) {
  sql.query({
    t: 'create table',
    name,
    cols: [
      { name: 'entity', type: 'integer', pk: true },
      ...refs.map((name) => ({ name, type: 'integer' as const })),
    ],
  })
  for (let prop of refs) {
    sql.query({
      t: 'create index',
      name: indexName(vocab, name, [prop]),
      on: name,
      cols: [col(prop)],
    })
  }
}
// Entity 1 is linked from 2 and 3 and commented on by 4, and 3 is also
// bookkeeping; 2,000 more entities are bookkeeping about something else.
for (let id = 1; id <= 2004; id++) {
  sql.query(insert('entity', { id, eid: `row-${id}`, num: id }))
}
sql.query(insert('edge', { entity: 2, from: 1, to: 5 }))
sql.query(insert('edge', { entity: 3, from: 6, to: 1 }))
sql.query(insert('comment', { entity: 4, target: 1 }))
for (let entity of [3, ...Array.from({ length: 2000 }, (_, i) => i + 5)]) {
  sql.query(insert('references', { entity }))
}
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})
let parsed = parse(
  '(.edge.from=row-1|.edge.to=row-1|.comment.target=row-1)&!references' +
    '&.limit=100&.fields=entity.eid',
)

for (
  let [name, opts] of [
    ['', {}],
    [' under a visibility policy', {
      visibility: { entity: '.entity.eid!=row-2004' },
    }],
  ] as const
) {
  test(`an absence beside a disjunction probes its candidates${name}`, () => {
    let query = compile(parsed, vocab, opts)
    let plan = sql.query({ t: 'explain query plan', of: query })
      .map((r) => String(r.detail)).join('\n')
    let stmt = db.prepare(query.sql)
    try {
      let rows = stmt.all(...query.params)
      assertEquals(rows.map((r) => r.eid).sort(), ['row-2', 'row-4'])
      let scans = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 0)
      assert(scans < 100, `${scans} full-scan advances\n${plan}`)
    } finally {
      stmt.finalize()
    }
  })
}
