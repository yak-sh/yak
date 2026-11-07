// A page in an indexed property's order walks that index and stops at it.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { col, compile, insert, type Row } from './mod.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
    entry: { component: true, properties: {} },
    comment: { component: true, properties: {} },
    created: {
      component: true,
      properties: {
        at: { type: 'string', format: 'date-time', index: true },
      },
    },
    content: {
      component: true,
      properties: { body: { type: 'string' } },
    },
  },
})
let db = new Database(':memory:'), sql = driver(db)
let tables: Record<string, string[]> = {
  entity: ['eid', 'num'],
  entry: [],
  comment: [],
  created: ['at'],
  content: ['body'],
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
        type: name == 'num' ? 'integer' as const : 'text' as const,
      })),
    ],
  })
}
sql.query({
  t: 'create index',
  name: 'created_at',
  on: 'created',
  cols: [col('at')],
})
// Two entities share each moment, numbered against their ids, so the number
// breaks a tie in the other order than the index keeps; every thousandth has
// no moment, one has an empty one, and the newest few are no entry.
let at = (id: number) =>
  new Date(Date.UTC(2026, 0, 1) + Math.floor(id / 2) * 60_000).toISOString()
for (let id = 1; id <= 4096; id++) {
  sql.query(
    insert('entity', { id, eid: `row-${id}`, num: id % 2 ? id - 1 : id + 1 }),
  )
  if (id % 1000) {
    sql.query(insert('created', { entity: id, at: id == 3001 ? '' : at(id) }))
  }
  if (id <= 4000) sql.query(insert('entry', { entity: id }))
  if (id == 50 || id == 3000) sql.query(insert('comment', { entity: id }))
  sql.query(
    insert('content', { entity: id, body: id == 7 ? 'rare' : 'common' }),
  )
}
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})
let read = (line: string) => {
  let q = compile(parse(line), vocab)
  let stmt = db.prepare(q.sql)
  try {
    let rows = stmt.all<Row>(...q.params)
    let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
    return { eids: rows.map((r) => r.eid), steps }
  } finally {
    stmt.finalize()
  }
}

let pages: [string, string, string[]][] = [
  ['newest first', '.entry ?created .order=-created.at .limit=3', [
    'row-3998',
    'row-3999',
    'row-3996',
  ]],
  [
    'newest first beside a test on every row',
    '.entry .content.body~=common ?created .order=-created.at .limit=3',
    ['row-3998', 'row-3999', 'row-3996'],
  ],
  ['without a value last', '.comment .order=-created.at .limit=3', [
    'row-50',
    'row-3000',
  ]],
  ['without a value first, oldest first', '.entry .order=created.at .limit=3', [
    'row-4000',
    'row-3000',
    'row-2000',
  ]],
  [
    'an empty value once, after none',
    '.entry .order=created.at .limit=6',
    ['row-4000', 'row-3000', 'row-2000', 'row-1000', 'row-3001', 'row-1'],
  ],
  ['oldest first after them', '.comment .order=created.at .limit=3', [
    'row-3000',
    'row-50',
  ]],
  ['one rare match', '.entry .content.body~=rare .order=-created.at .limit=3', [
    'row-7',
  ]],
]
for (let [name, line, eids] of pages) {
  test(`a page in an indexed order: ${name}`, () =>
    assertEquals(read(line).eids, eids))
}

test('a page in an indexed order stops at the page', () => {
  for (
    let line of [
      '.entry ?created .order=-created.at .limit=3',
      '.entry .content.body~=common .order=-created.at .limit=3',
    ]
  ) {
    let { steps } = read(line)
    assert(steps < 10_000, `${steps} VM instructions: ${line}`)
  }
})
