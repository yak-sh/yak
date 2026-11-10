// A page in an indexed property's order walks that index and stops at it.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import {
  type BindOpts,
  col,
  compile,
  deep,
  DEPTH,
  insert,
  render,
  type Row,
  VARIABLES,
} from './mod.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
    entry: { component: true, properties: {} },
    comment: {
      component: true,
      properties: { kind: { type: 'string' } },
    },
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
  comment: ['kind'],
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
  if (id == 50 || id == 3000) {
    sql.query(
      insert('comment', { entity: id, kind: id == 50 ? 'note' : 'ask' }),
    )
  }
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
  [
    'newest first within a time range',
    '.entry .content.body~=common .created.at>2026-01-01T00:00:00Z .order=-created.at .limit=3',
    ['row-3998', 'row-3999', 'row-3996'],
  ],
  [
    'oldest first above a bound',
    `.entry .content.body~=common .created.at>${
      at(3000)
    } .order=created.at .limit=3`,
    ['row-3002', 'row-3003', 'row-3004'],
  ],
  [
    'newest first below a bound',
    `.entry .content.body~=common .created.at<${
      at(3000)
    } .order=-created.at .limit=3`,
    ['row-2998', 'row-2999', 'row-2996'],
  ],
  [
    'an empty time range',
    '.entry .content.body~=common .created.at>2027-01-01 .order=-created.at .limit=3',
    [],
  ],
  ['without a value last', '.comment .order=-created.at .limit=3', [
    'row-50',
    'row-3000',
  ]],
  ['oldest first', '.entry .order=created.at .limit=3', [
    'row-1',
    'row-2',
    'row-3',
  ]],
  [
    'oldest first, without a value last',
    '.comment .order=created.at .limit=3',
    [
      'row-50',
      'row-3000',
    ],
  ],
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

// Missing or empty, a value is absent, and the absent come last either way,
// once each, newest first among themselves.
test('a page in an indexed order ends with the entities lacking its value', () => {
  for (let line of ['.entry .order=created.at', '.entry .order=-created.at']) {
    let { eids } = read(`${line} .limit=4000`)
    assertEquals(new Set(eids).size, 4000, line)
    assertEquals(eids.slice(-5), [
      'row-4000',
      'row-3000',
      'row-3001',
      'row-2000',
      'row-1000',
    ], line)
  }
})

test('a page in an indexed order stops at the page', () => {
  for (
    let line of [
      '.entry ?created .order=-created.at .limit=3',
      '.entry .order=created.at .limit=3',
      '.entry .content.body~=common .order=-created.at .limit=3',
      '.entry .content.body~=common .created.at>2026-01-01T00:00:00Z .order=-created.at .limit=3',
      `.entry .content.body~=common .created.at>${
        at(3000)
      } .order=created.at .limit=3`,
      `.entry .content.body~=common .created.at<${
        at(3000)
      } .order=-created.at .limit=3`,
      '.entry .content.body~=common .created.at>2027-01-01 .order=-created.at .limit=3',
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
  [
    'a time range',
    '.comment !link .created.at>2025-01-01 .order=-created.at .limit=3',
    few({ comment: 2 }),
  ],
  [
    'named only by a test of its property',
    '.comment.kind=note !link .order=-created.at .limit=3',
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
  for (
    let line of [
      '.comment !link .order=-created.at .limit=3',
      '.comment !link .created.at>2025-01-01 .order=-created.at .limit=3',
      // A test of a property names its component as surely as `.comment`
      // does (bug e48e7967: `.session.operator=true !session.ended`, 34 s).
      '.comment.kind=note !link .order=-created.at .limit=3',
    ]
  ) {
    let { steps } = read(line, few({ comment: 2 }))
    assert(steps < 1_000, `${steps} VM instructions: ${line}`)
  }
})

// Under a screen the newest few hold the screen at every test, and a relation
// read once and named twice counts all of that twice against workerd's depth:
// written for it, they are written where they are named, and the page is
// still the walk's.
test('a page of few owners under a screen is written under the depth of an engine that counts', () => {
  let hidden: BindOpts = {
    visibility: {
      entity: '(!link|.link.to=row-1)&(!comment|.content.body~=common)',
    },
  }
  let line =
    '.comment !link .content.body~=common .created.at>2025-01-01 .order=-created.at .limit=3'
  let built = compile(parse(line), vocab, { ...few({ comment: 2 }), ...hidden })
  let q = render(built, VARIABLES, DEPTH)
  assertEquals([deep(built.sql), deep(q.sql)], [true, false])
  assertEquals(
    db.prepare(q.sql).all<Row>(...q.params).map((r) => r.eid),
    read(line, hidden).eids,
  )
  assertEquals(read(line, hidden).eids, ['row-50'])
})
