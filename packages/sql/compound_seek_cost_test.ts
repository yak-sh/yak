// Compound seeks must stay bounded when sibling indexes and OR arms compete.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { col, compile, indexName, insert } from './mod.ts'

let indexes = [
  ['handler', 'state', 'owner', 'next'],
  ['handler', 'state', 'next', 'expiry'],
  ['handler', 'state', 'expiry', 'next'],
]
let props = ['handler', 'state', 'owner', 'next', 'expiry']
let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: {} },
    job: {
      component: true,
      index: indexes,
      properties: Object.fromEntries(props.map((p) => [p, {
        type: 'string',
        ...['next', 'expiry'].includes(p) ? { format: 'date-time' } : {},
      }])),
    },
  },
})
let db = new Database(':memory:'), sql = driver(db)
for (let name of ['entity', 'job', 'tombstone']) {
  sql.query({
    t: 'create table',
    name,
    cols: [
      { name: name == 'entity' ? 'id' : 'entity', type: 'integer', pk: true },
      ...name == 'entity'
        ? [{ name: 'eid', type: 'text' as const, unique: true }]
        : name == 'job'
        ? props.map((name) => ({ name, type: 'text' as const }))
        : [],
    ],
  })
}
for (let props of indexes) {
  sql.query({
    t: 'create index',
    name: indexName(vocab, 'job', props),
    on: 'job',
    cols: props.map((p) => col(p)),
  })
}
let past = '2026-10-18T00:00:00.000Z'
let now = '2026-10-19T00:00:00.000Z'
let future = '2026-10-20T00:00:00.000Z'
for (let id = 1; id <= 2048; id++) {
  sql.query(insert('entity', { id, eid: `row-${id}` }))
  sql.query(insert('job', {
    entity: id,
    handler: id < 1024 ? 'unrelated' : 'target',
    state: 'pending',
    owner: id == 2048 ? null : 'worker',
    next: id < 1024 || id == 2048 ? null : future,
    expiry: id == 2047 ? past : future,
  }))
}
sql.query(insert('entity', { id: 2049, eid: 'empty' }))
sql.query(insert('job', {
  entity: 2049,
  handler: 'target',
  state: 'pending',
  owner: '',
  next: '',
  expiry: '',
}))
sql.query(insert('entity', { id: 2050, eid: 'bare' }))
for (let id = 3000; id < 4024; id++) {
  sql.query(insert('entity', { id, eid: `dense-${id}` }))
  sql.query(insert('job', { entity: id, handler: 'dense', state: 'pending' }))
}
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})
let scoped = '.job.handler=target .job.state=pending '
let cases: [string, string, string[]][] = [
  ['compound expiry range', scoped + `.job.expiry<=${now}`, ['row-2047']],
  [
    'nested disjunction',
    scoped +
    `(!job.next|.job.next<=${now}) ` +
    `(!job.owner|!job.expiry|.job.expiry<=${now})`,
    ['row-2048', 'empty'],
  ],
  [
    'empty scoped disjunction',
    '.job.handler=missing .job.state=pending ' +
    `(!job.next|.job.next<=${now}) ` +
    `(!job.owner|!job.expiry|.job.expiry<=${now})`,
    [],
  ],
  [
    'missing component disjunction',
    '.entity.eid=bare (!job.next|.job.handler=never)',
    ['bare'],
  ],
]
for (let [name, line, expected] of cases) {
  let query = compile(parse(line), vocab)
  let plan = sql.query({ t: 'explain query plan', of: query })
    .map((r) => String(r.detail)).join('\n')
  test(`${name} seeks only matching compound keys`, () => {
    let stmt = db.prepare(query.sql)
    try {
      assertEquals(stmt.all(...query.params).map((r) => r.eid), expected)
      let scans = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 0)
      let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
      assert(scans < 10, `${scans} full-scan advances\n${plan}`)
      assert(steps < 800, `${steps} VM instructions\n${plan}`)
    } finally {
      stmt.finalize()
    }
  })
}

let dense = compile(
  parse(
    '.job.handler=dense .job.state=pending ' +
      `(!job.next|.job.next<=${now}) ` +
      `(!job.owner|!job.expiry|.job.expiry<=${now}) .limit=1`,
  ),
  vocab,
  { unordered: true },
)
// The native driver retains prepared statements between worker turns.
let head = db.prepare(dense.sql)
test('an unordered bounded disjunction stops at indexed heads of a dense backlog', () => {
  try {
    let rows = head.all(...dense.params)
    assertEquals(rows.length, 1)
    assert(String(rows[0].eid).startsWith('dense-'))
    let steps = status.symbols.sqlite3_stmt_status(head.unsafeHandle, 4, 0)
    assert(steps < 2000, `${steps} VM instructions`)
  } finally {
    head.finalize()
  }
})

let overlap = compile(
  parse(
    '.job.handler=dense (!job.owner|!job.next) .limit=2',
  ),
  vocab,
  { unordered: true },
)
let pair = db.prepare(overlap.sql)
test('an unordered limit counts distinct matches across overlapping arms', () => {
  try {
    let rows = pair.all(...overlap.params)
    assertEquals(new Set(rows.map((r) => r.eid)).size, 2)
    assert(rows.every((r) => String(r.eid).startsWith('dense-')))
    let steps = status.symbols.sqlite3_stmt_status(pair.unsafeHandle, 4, 0)
    assert(steps < 1000, `${steps} VM instructions`)
  } finally {
    pair.finalize()
  }
})
let bare = compile(
  parse(
    '.entity.eid=bare (!job.owner|.job.handler=never) .limit=2',
  ),
  vocab,
  { unordered: true },
)
test('an unordered alternative retains an entity without its tested component', () =>
  assertEquals(sql.query(bare).map((r) => r.eid), ['bare']))
