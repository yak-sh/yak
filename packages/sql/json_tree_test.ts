// JSON reference benchmarks can build and query their indexes entirely as AST.
import { equal, ok, test } from '@yaks/testing'
import { open, type Opened } from '../sqlite/db.ts'
import {
  and,
  as,
  call,
  col,
  cross,
  eq,
  fn,
  join,
  lit,
  select,
  type Stmt,
  table,
  val,
} from './mod.ts'

let path = '$.task.assignee'
let target = 'person-a'
let scalar = fn('json_extract', col('body'), lit(path))
let leaves = select({
  cols: [col('owner', 'd'), col('fullkey', 'j'), col('atom', 'j')],
  from: table('document', 'd'),
  joins: [cross(call('json_tree', [col('body', 'd')], 'j'))],
  where: eq(col('type', 'j'), lit('text')),
})
let scan = select({
  cols: [as(col('owner', 'd'), 'owner')],
  from: table('document', 'd', false),
  joins: [cross(call('json_tree', [col('body', 'd')], 'j'))],
  where: and(
    eq(col('fullkey', 'j'), val(path)),
    eq(col('atom', 'j'), val(target)),
  ),
})
let indexed = (index: string | false, owner?: string) =>
  select({
    cols: [col('owner', 'r')],
    from: table('reference', 'r', index),
    joins: [
      join(table('document', 'd'), eq(col('owner', 'd'), col('owner', 'r'))),
    ],
    where: and(
      eq(col('path', 'r'), val(path)),
      eq(col('name', 'r'), val(target)),
      ...(owner ? [eq(col('owner', 'r'), val(owner))] : []),
    ),
  })
let expression = select({
  cols: [col('owner')],
  from: table('document'),
  where: eq(scalar, val(target)),
})
let setup: Stmt[] = [
  {
    t: 'create table',
    name: 'document',
    cols: [{ name: 'owner', type: 'text', pk: true }, {
      name: 'body',
      type: 'blob',
    }],
  },
  {
    t: 'create table',
    name: 'reference',
    cols: [{ name: 'owner' }, { name: 'path' }, { name: 'name' }],
  },
  {
    t: 'insert',
    into: 'document',
    cols: ['owner', 'body'],
    rows: [
      ['a', { task: { assignee: target }, nested: [{ ref: target }] }],
      ['b', { task: { assignee: 'person-b' }, nested: [{ ref: target }] }],
    ].map((
      [owner, body],
    ) => [val(String(owner)), fn('jsonb', val(JSON.stringify(body)))]),
  },
  {
    t: 'insert',
    into: 'reference',
    cols: ['owner', 'path', 'name'],
    q: leaves,
  },
  {
    t: 'create index',
    name: 'reference_by_path',
    on: 'reference',
    cols: [col('path'), col('name'), col('owner')],
  },
  {
    t: 'create index',
    name: 'reference_by_entity',
    on: 'reference',
    cols: [col('owner'), col('path'), col('name')],
  },
  {
    t: 'create index',
    name: 'document_assignee',
    on: 'document',
    cols: [scalar],
  },
]
let check = (name: string, run: (db: Opened) => void) => {
  let db = open(':memory:')
  for (let statement of setup) db.query(statement)
  test(name, () => {
    try {
      run(db)
    } finally {
      db.close()
    }
  })
}
let plan = (db: Opened, of: Stmt) =>
  db.query({ t: 'explain query plan', of }).map((row) => String(row.detail))
    .join('\n')

check('JSON tree reads text leaves and array paths from JSONB', (db) => {
  equal(db.query(leaves), [
    { owner: 'a', fullkey: path, atom: target },
    { owner: 'a', fullkey: '$.nested[0].ref', atom: target },
    { owner: 'b', fullkey: path, atom: 'person-b' },
    { owner: 'b', fullkey: '$.nested[0].ref', atom: target },
  ])
})

check(
  'insert select side indexes agree with a JSON tree reference scan',
  (db) => {
    let expected = [{ owner: 'a' }]
    equal(db.query(scan), expected)
    equal(db.query(indexed(false)), expected)
    equal(db.query(indexed('reference_by_path')), expected)
    equal(db.query(indexed('reference_by_entity')), expected)
    equal(db.query(indexed('reference_by_entity', 'a')), expected)
  },
)

check(
  'path lookup seeks a path index but scans an owner-first index without owner',
  (db) => {
    ok(plan(db, indexed(false)).includes('SCAN r'))
    ok(
      plan(db, indexed('reference_by_path')).includes(
        'SEARCH r USING COVERING INDEX reference_by_path',
      ),
    )
    ok(
      plan(db, indexed('reference_by_entity')).includes(
        'SCAN r USING COVERING INDEX reference_by_entity',
      ),
    )
    ok(
      plan(db, indexed('reference_by_entity', 'a')).includes(
        'SEARCH r USING COVERING INDEX reference_by_entity',
      ),
    )
  },
)

check('JSON scalar lookups use their literal-path expression index', (db) => {
  equal(db.query(expression), [{ owner: 'a' }])
  ok(plan(db, expression).includes('document_assignee'))
  ok(!plan(db, scan).includes('document_assignee'))
})
