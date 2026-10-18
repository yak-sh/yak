// A sparse component's property checks must not scan unrelated document history.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { col, compile, eq, insert, select, sub, table } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
    selected: { component: true, properties: {} },
    doc: {
      component: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
      },
    },
    content: { component: true, properties: { body: { type: 'string' } } },
  },
})
let db = new Database(':memory:'), sql = driver(db)
for (let name of ['entity', 'selected', 'doc', 'content', 'tombstone']) {
  sql.query({
    t: 'create table',
    name,
    cols: [
      { name: name == 'entity' ? 'id' : 'entity', type: 'integer', pk: true },
      ...name == 'entity'
        ? [{ name: 'eid', type: 'text' as const, unique: true }, {
          name: 'num',
          type: 'integer' as const,
        }]
        : ['doc', 'content'].includes(name)
        ? [
          { name: 'body', type: 'text' as const },
          ...name == 'doc' ? [{ name: 'title', type: 'text' as const }] : [],
        ]
        : [],
    ],
  })
}
for (let id = 1; id <= 1024; id++) {
  sql.query(insert('entity', { id, eid: `row-${id}`, num: id }))
  sql.query(
    insert('doc', {
      entity: id,
      title: id == 1003 ? null : 'title',
      body: id == 1002 ? null : 'body',
    }),
  )
  sql.query(
    insert('content', { entity: id, body: id == 1004 ? null : 'instructions' }),
  )
}
for (let entity of [1001, 1002, 1003, 1004, 1005]) {
  sql.query(insert('selected', { entity }))
}
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})
let parsed = parse(
  '.selected .doc.title .doc.body .content.body ' +
    '.fields=entity.eid,doc.title,doc.body',
)
let query = compile(parsed, vocab)
let plan = sql.query({ t: 'explain query plan', of: query })
  .map((r) => String(r.detail)).join('\n')

test('property presence probes sparse owners without scanning document history', () => {
  let stmt = db.prepare(query.sql)
  try {
    let rows = stmt.all(...query.params)
    assertEquals(rows.map((r) => r.eid), ['row-1001', 'row-1005'])
    let scans = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 0)
    let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
    assert(scans < 10, `${scans} full-scan advances\n${plan}`)
    assert(steps < 500, `${steps} VM instructions\n${plan}`)
  } finally {
    stmt.finalize()
  }
})

let derived = Object.fromEntries(['doc', 'content'].map((comp) => [
  `${comp}.body`,
  {
    tag: 'text' as const,
    expr: (owner: ReturnType<typeof col>) =>
      sub(select({
        cols: [col('body', 'body')],
        from: table(comp, 'body'),
        where: eq(col('entity', 'body'), owner),
      })),
  },
]))
let scoped = compile(parsed, vocab, {
  derived,
  visibility: { entity: '.entity.eid!=row-1005' },
})
let scopedPlan = sql.query({ t: 'explain query plan', of: scoped })
  .map((r) => String(r.detail)).join('\n')

test('visible derived property checks probe only sparse owners', () => {
  let stmt = db.prepare(scoped.sql)
  try {
    assertEquals(stmt.all(...scoped.params).map((r) => r.eid), ['row-1001'])
    let scans = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 0)
    let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
    assert(scans < 10, `${scans} full-scan advances\n${scopedPlan}`)
    assert(steps < 1500, `${steps} VM instructions\n${scopedPlan}`)
  } finally {
    stmt.finalize()
  }
})
