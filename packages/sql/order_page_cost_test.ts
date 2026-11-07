// A page in an indexed property's order walks that index and stops at it.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { type BindOpts, col, compile, insert, type Row } from './mod.ts'

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
    link: {
      component: true,
      properties: { to: { type: 'string', ref: 'entity' } },
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
        type: ['num', 'to'].includes(name)
          ? 'integer' as const
          : 'text' as const,
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
sql.query({
  t: 'create index',
  name: 'entity_eid',
  on: 'entity',
  cols: [col('eid')],
})
sql.query({ t: 'create index', name: 'link_to', on: 'link', cols: [col('to')] })
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
  // Three entities, one with no moment, point at the first.
  if ([20, 1000, 2001].includes(id)) {
    sql.query(insert('link', { entity: id, to: 1 }))
  }
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
let read = (line: string, opts?: BindOpts) => {
  let q = compile(parse(line), vocab, opts)
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
  ['either of two', '.entry|.comment .order=-created.at .limit=3', [
    'row-3998',
    'row-3999',
    'row-3996',
  ]],
  ['beside no component', '!comment .order=-created.at .limit=3', [
    'row-4096',
    'row-4094',
    'row-4095',
  ]],
  ['what few point at', '.refs=row-1 .order=-created.at .limit=3', [
    'row-2001',
    'row-20',
    'row-1000',
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
      '.content.body~=common .order=-created.at .limit=3',
      '.entry|.comment .order=-created.at .limit=3',
      '!comment .order=-created.at .limit=3',
      '.refs=row-1 .order=-created.at .limit=3',
    ]
  ) {
    let { steps } = read(line)
    assert(steps < 10_000, `${steps} VM instructions: ${line}`)
  }
})

// A census that counts a component's owners few sends a tested page to its
// newest few, and to every owner only when those cannot fill it: the answer
// is the walk's.
let few = (held: Record<string, number>): BindOpts => ({
  census: { held: (c) => held[c], largest: () => 4096 },
})
let counted: [string, string, BindOpts][] = [
  [
    'the newest few',
    '.entry .content.body~=common .order=-created.at .limit=3',
    few({ entry: 40 }),
  ],
  [
    'past the newest few',
    '.entry .content.body~=rare .order=-created.at .limit=3',
    few({ entry: 40 }),
  ],
  [
    'fewer than a page',
    '.comment !link .order=-created.at .limit=3',
    few({ comment: 2 }),
  ],
  [
    'oldest first',
    '.comment !link .order=created.at .limit=3',
    few({ comment: 2 }),
  ],
]
for (let [name, line, opts] of counted) {
  test(`a page of few owners: ${name}`, () =>
    assertEquals(read(line, opts).eids, read(line).eids))
}

// The two comments, under a test both pass, are fewer than the page: the walk
// reads every moment to learn it, 188,483 VM steps, and the census sends the
// page to the comments.
test('a page of few owners reads them, not the index', () => {
  let { steps } = read(
    '.comment !link .order=-created.at .limit=3',
    few({ comment: 2 }),
  )
  assert(steps < 1_000, `${steps} VM instructions`)
})
