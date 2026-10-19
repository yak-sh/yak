// Historical membership must narrow owners before decoding stored text.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { schema, search } from '@yaks/fts'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import {
  as,
  col,
  compile,
  count,
  each,
  eq,
  type Expr,
  fn,
  from,
  insert,
  member,
  type Raw,
  render,
  type Row,
  screen,
  select,
  sub,
  table,
  val,
} from './mod.ts'

let vocab = loadVocab({
  $defs: {
    entity: { component: true, properties: { num: { type: 'number' } } },
    entry: { component: true, properties: {} },
    comment: { component: true, properties: {} },
    held: { component: true, properties: {} },
    created: {
      component: true,
      properties: {
        at: { type: 'string', format: 'date-time', index: true },
        by: { type: 'string', index: true },
      },
    },
    doc: {
      component: true,
      properties: {
        body: { type: 'string', search: true },
      },
    },
  },
})
let db = new Database(':memory:'), sql = driver(db)
for (
  let name of [
    'entity',
    'entry',
    'comment',
    'held',
    'created',
    'doc',
    'tombstone',
  ]
) {
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
        : name == 'created'
        ? ['at', 'by'].map((name) => ({ name, type: 'text' as const }))
        : name == 'doc'
        ? [{ name: 'body', type: 'text' as const }]
        : [],
    ],
  })
}
for (let name of ['at', 'by']) {
  sql.query({
    t: 'create index',
    name: `created_${name}`,
    on: 'created',
    cols: [col(name)],
  })
}
let fields = [{ comp: 'doc', prop: 'body' }]
for (let stmt of schema(fields)) sql.query(stmt)
let past = '2026-01-01T00:00:00.000Z'
let future = '2027-01-01T00:00:00.000Z'
for (let id = 1; id <= 4096; id++) {
  sql.query(insert('entity', { id, eid: `row-${id}`, num: id }))
  sql.query(
    insert('created', {
      entity: id,
      at: id == 4096 ? future : past,
      by: id <= 64 ? 'person' : 'other',
    }),
  )
  sql.query(
    insert('doc', {
      entity: id,
      body: id == 4095
        ? 'common Reader, needle'
        : id <= 128
        ? 'common unrelated'
        : 'unrelated',
    }),
  )
  sql.query(insert('held', { entity: id }))
  if (id <= 64) sql.query(insert('entry', { entity: id }))
  if (id > 3968) sql.query(insert('comment', { entity: id }))
}
let opts = {
  derived: {
    'doc.body': {
      tag: 'text' as const,
      expr: () => fn('substr', col('body', 'doc'), val(1)),
    },
  },
  extend: [search(fields, sql)],
}
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})
let statements = new Map<Raw, ReturnType<typeof db.prepare>>()
let probe = (q: Raw) => {
  let stmt = statements.get(q)!
  status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 1)
  let rows = stmt.all<Row>(...q.params)
  let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
  return { rows, steps }
}
let before = `.created.at<${future}`
let quote = '.comment .doc.body~="Reader, "'
let within = `${before} ((.entry .created.by=person)|(${quote}))`
let full = screen(parse(within), vocab, opts)!
let quoted = screen(parse(`${before} ${quote}`), vocab, opts)!
let sparse = compile(parse(`${before} needle .limit=2`), vocab, opts)
let narrow = screen(parse(`.created.at>=${future} ${quote}`), vocab, opts)!
let masked = screen(
  parse(`.created.at>=${future} .held .doc.body~="Reader, "`),
  vocab,
  { ...opts, visibility: { components: { held: '.created.by=other' } } },
)!
let threshold = render(
  select({
    cols: [count()],
    from: from(select({ from: from(full), limit: val(16) })),
  }),
)
let ordered = compile(
  parse(`${within} .order=-created.at .limit=2 .fields=entity.eid`),
  vocab,
  opts,
)

let parity: [string, Raw, unknown[]][] = [
  ...[false, true].map((hidden): [string, Raw, unknown[]] => [
    `a masked required component ${hidden ? 'hides' : 'admits'} its owner`,
    compile(
      parse(`.created.at>=${future} .held .fields=entity.eid`),
      vocab,
      {
        ...opts,
        visibility: {
          components: {
            held: hidden ? `.created.at<${future}` : '.created.by=other',
          },
        },
      },
    ),
    hidden ? [] : ['row-4096'],
  ]),
  [
    'overlapping arms deduplicate',
    compile(parse('.entry|(.entry .created.by=person) .count'), vocab, opts),
    [64],
  ],
  [
    'presence-only arms retain both components',
    compile(parse('(.entry|.comment) .limit=2'), vocab, opts),
    ['row-4096', 'row-4095'],
  ],
  [
    'explicit cursors page the ordered union',
    compile(
      parse(`${within} .order=-created.at .after=64 .limit=2`),
      vocab,
      opts,
    ),
    ['row-63', 'row-62'],
  ],
  [
    'component visibility still gates derived substring matches',
    screen(parse(`${before} ${quote}`), vocab, {
      ...opts,
      visibility: { components: { doc: '.entity.num=4096' } },
    })!,
    [],
  ],
  [
    'equality drives beside broad text',
    compile(parse('.created.by=person common .limit=2'), vocab, opts),
    ['row-64', 'row-63'],
  ],
]

let cas = {
  ...opts,
  derived: {
    'doc.body': {
      tag: 'text' as const,
      expr: (owner: Expr) =>
        sub(select({
          cols: [col('body', '__blob')],
          from: table('doc', '__blob'),
          where: eq(col('entity', '__blob'), owner),
        })),
    },
  },
}
let filters: [string, Raw, number[]][] = [
  [
    'stored text lookup stays keyed',
    screen(parse(`${before} ${quote}`), vocab, cas)!,
    [4095],
  ],
  ['presence and absence OR', screen(parse('.entry|!comment'), vocab, opts)!, [
    64,
    100,
  ]],
  [
    'screen directives do not narrow membership',
    screen(parse('.entry .order=-created.at .limit=1'), vocab, opts)!,
    [64],
  ],
  [
    'component policies remain in keyed membership',
    screen(parse(`${before} ${quote}`), vocab, {
      ...opts,
      visibility: { components: { doc: '.entity.num=4096' } },
    })!,
    [],
  ],
  [
    'owner restrictions remain in keyed membership',
    screen(parse(within), vocab, { ...opts, eids: ['row-4095'] })!,
    [4095],
  ],
]
let memberships: [string, Raw, number[]][] = filters.map((
  [name, selection, expected],
) => [
  name,
  render(select({
    cols: [as(col('value', 'c'), 'id')],
    from: from(each([4095, 4096, 64, 100, 9999]), 'c'),
    where: member(selection, col('value', 'c')),
  })),
  expected,
])

let manual = render(select({
  cols: [col('id')],
  from: table('entity'),
  where: eq(col('id'), val(64)),
}))
let fallback = render(select({
  cols: [col('id', '__member')],
  from: from(
    select({ cols: [as(col('value'), 'id')], from: from(each([64, 100])) }),
    '__member',
  ),
  where: member(manual, col('id', '__member')),
}))
let keyed = render(select({
  cols: [as(col('value', 'c'), 'id')],
  from: from(each([4095, 4096, 64, 100]), 'c'),
  where: member(full, col('value', 'c')),
}))
let shadowed = render(select({
  cols: [col('id', 'entity')],
  from: from(each([4095, 4096, 64, 100]), 'ids'),
  joins: [{
    how: 'cross',
    src: table('entity'),
    on: eq(col('value', 'ids'), col('id', 'entity')),
  }],
  where: member(full, col('id', 'entity')),
}))

for (
  let q of [
    fallback,
    keyed,
    shadowed,
    full,
    quoted,
    sparse,
    narrow,
    masked,
    threshold,
    ordered,
    ...parity.map((p) => p[1]),
    ...memberships.map((p) => p[1]),
  ]
) {
  statements.set(q, db.prepare(q.sql))
}

test('historical substring membership reads required component bodies only', () => {
  let result = probe(quoted)
  assertEquals(result.rows.map((r) => r.id), [4095])
  assert(result.steps < 12000, `${result.steps} VM instructions`)
})
test('a sparse text selection drives a broad scalar range', () => {
  let result = probe(sparse)
  assertEquals(result.rows.map((r) => r.eid), ['row-4095'])
  assert(result.steps < 1000, `${result.steps} VM instructions`)
})
test('a narrow scalar range still seeks before reading required bodies', () => {
  let result = probe(narrow)
  assertEquals(result.rows, [])
  assert(result.steps < 1000, `${result.steps} VM instructions`)
})
test('masked presence census stays bounded beside a narrow scalar range', () => {
  let result = probe(masked)
  assertEquals(result.rows, [])
  assert(result.steps < 20_000, `${result.steps} VM instructions`)
})
test('bounded historical cardinality stops before later alternatives', () => {
  let result = probe(threshold)
  assertEquals(Object.values(result.rows[0]), [16])
  assert(result.steps < 1500, `${result.steps} VM instructions`)
})
test('historical alternatives preserve ordered limits and projections', () => {
  let result = probe(ordered)
  assertEquals(result.rows.map((r) => r.eid), ['row-4095', 'row-64'])
})

for (let [name, q, expected] of parity) {
  test(name, () => {
    let result = probe(q)
    assertEquals(result.rows.map((r) => r.eid ?? r.n ?? r.id), expected)
  })
}

test('historical membership probes each owner without enumerating history', () => {
  let result = probe(keyed)
  assertEquals(result.rows.map((r) => r.id), [4095, 64])
  assert(result.steps < 500, `${result.steps} VM instructions`)
})
test('keyed membership retains an outer owner that shares the entity alias', () => {
  assertEquals(probe(shadowed).rows.map((r) => r.id), [4095, 64])
})

for (let [name, q, expected] of memberships) {
  test(name, () => assertEquals(probe(q).rows.map((r) => r.id), expected))
}

test('manual selection membership preserves a colliding outer alias', () => {
  assertEquals(probe(fallback).rows.map((r) => r.id), [64])
})
