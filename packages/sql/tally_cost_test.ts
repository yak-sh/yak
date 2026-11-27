// A tally or distinct of a sparse component's property, stored or computed,
// reads that component's owners, not every entity (bug 5871af2038).
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { compile, insert } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
    task: { component: true, properties: { status: { type: 'string' } } },
    job: { component: true, status: { failed: 'failed', default: 'pending' } },
    failed: { component: true, properties: {} },
    note: { component: true, properties: {} },
    tombstone: { component: true, properties: {} },
  },
})
let db = new Database(':memory:'), sql = driver(db)
sql.query({
  t: 'create table',
  name: 'entity',
  cols: [
    { name: 'id', type: 'integer', pk: true },
    { name: 'eid', type: 'text', unique: true },
    { name: 'num', type: 'integer' },
  ],
})
for (let name of ['task', 'note', 'tombstone', 'job', 'failed']) {
  sql.query({
    t: 'create table',
    name,
    cols: [
      { name: 'entity', type: 'integer', pk: true },
      ...name == 'task' ? [{ name: 'status', type: 'text' as const }] : [],
    ],
  })
}
for (let id = 1; id <= 4096; id++) {
  sql.query(insert('entity', { id, eid: `row-${id}`, num: id }))
  sql.query(insert('note', { entity: id }))
}
let statuses = ['open', 'done', 'done', null, 'wip', 'open']
for (let [i, status] of statuses.entries()) {
  sql.query(insert('task', { entity: 1000 + i, status }))
}
sql.query(insert('tombstone', { entity: 1001 }))
for (let entity of [2000, 2001, 2002]) sql.query(insert('job', { entity }))
for (let entity of [2001, 3000]) sql.query(insert('failed', { entity }))
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})

let screen = { visibility: { entity: '.entity.eid!=row-1005' } }
let tally = (open: number) => [
  { value: 'done', n: 1 },
  { value: 'open', n: open },
  { value: 'wip', n: 1 },
]
let cases: [string, typeof screen | undefined, unknown[]][] = [
  ['.tally=task.status', undefined, tally(2)],
  ['.tally=task.status', screen, tally(1)],
  [
    '.distinct=task.status',
    screen,
    ['done', 'open', 'wip'].map((value) => ({ value })),
  ],
  ['.tally=job.status', screen, [
    { value: 'failed', n: 1 },
    { value: 'pending', n: 2 },
  ]],
  ['.task.status!=open&.tally=task.status', undefined, [
    { value: 'done', n: 1 },
    { value: 'wip', n: 1 },
  ]],
]
for (let [q, opts, want] of cases) {
  test(`${q} reads only its component's owners${opts ? ', screened' : ''}`, () => {
    let query = compile(parse(q), vocab, opts)
    let plan = sql.query({ t: 'explain query plan', of: query })
      .map((r) => String(r.detail)).join('\n')
    let stmt = db.prepare(query.sql)
    try {
      assertEquals(stmt.all(...query.params), want)
      let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
      assert(steps < 2000, `${steps} VM instructions\n${plan}`)
    } finally {
      stmt.finalize()
    }
  })
}
