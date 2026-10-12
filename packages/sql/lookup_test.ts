// Numeric lookup keeps payloads in their row and bounds keyed engine work.
import '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import {
  as,
  col,
  type Expr,
  fn,
  insert,
  lit,
  lookup,
  op,
  render,
  select,
  table,
  val,
} from './mod.ts'

let db = new Database(':memory:'), sql = driver(db), chosen = 0
let stable = { stable: true } as const
db.function('chosen', () => (++chosen, 'picked'))
db.function('ordinal', () => ++chosen)
db.function('unchosen', () => {
  throw new Error('unchosen lookup arm ran')
})
for (
  let [name, cols, rows] of [
    ['keys', [{ name: 'n', type: 'text' }], [{ n: '3' }]],
    ['lookup_rows', [{ name: 'key', type: 'integer' }, {
      name: 'value',
      type: 'text',
    }], [{ key: 3, value: 'outer3' }, { key: 8, value: 'outer8' }]],
    [
      'owners',
      [{ name: 'id', type: 'integer', pk: true }],
      Array.from({ length: 128 }, (_, i) => ({ id: i + 1 })),
    ],
  ] as const
) {
  sql.query({ t: 'create table', name, cols: [...cols] })
  sql.query(insert(name, ...rows))
}
let value = (key: Expr) =>
  sql.query(select({
    cols: [as(
      lookup(
        key,
        [
          [1, val('one')],
          [3, val('three')],
          [3, val('later')],
          [null, val('null arm')],
          [-2, val('negative')],
          [1.5, val('fraction')],
          [5, lit(null)],
        ],
        stable,
        val('missing'),
      ),
      'v',
    )],
  }))[0].v

test('numeric lookup keeps duplicates, null payloads and numeric types', () => {
  assertEquals(
    [1, 3, null, -2, 1.5, 5, 8, '3'].map((n) => value(val(n))),
    [
      'one',
      'three',
      'missing',
      'negative',
      'fraction',
      null,
      'missing',
      'missing',
    ],
  )
})
let selected = select({
  cols: [as(
    lookup(
      lit(3),
      [
        [1, fn('unchosen')],
        [3, fn('chosen')],
        [3, fn('unchosen')],
        [null, fn('unchosen')],
        [5, fn('unchosen')],
        [7, fn('unchosen')],
        [9, fn('unchosen')],
        [11, fn('unchosen')],
      ],
      stable,
      fn('unchosen'),
    ),
    'v',
  )],
})
test('lookup evaluates only its selected payload', () => {
  chosen = 0
  assertEquals(sql.query(selected), [{ v: 'picked' }])
  assertEquals(chosen, 1)
})
let empty = select({ cols: [as(lookup(lit(3), [], stable), 'v')] })
test('an empty numeric lookup returns its null default', () =>
  assertEquals(sql.query(empty), [{ v: null }]))
let textKey = select({
  cols: [as(lookup(col('n'), [[3, lit('number')]], stable, lit('text')), 'v')],
  from: table('keys'),
})
test('numeric lookup does not inherit a text columns numeric-string affinity', () =>
  assertEquals(sql.query(textKey), [{ v: 'text' }]))

let outer = (alias?: string) =>
  select({
    cols: [
      as(
        lookup(
          render(col('key', alias)),
          [[3, col('value', alias)]],
          stable,
          col('value', alias),
        ),
        'v',
      ),
    ],
    from: table('lookup_rows', alias),
    order: [col('key', alias)],
  })
test('lookup leaves outer keys, payloads and defaults in their scope', () => {
  for (let alias of [undefined, '__lookup', '__LOOKUP', '__lookup1']) {
    assertEquals(sql.query(outer(alias)), [{ v: 'outer3' }, { v: 'outer8' }])
  }
})
let nested = select({
  cols: [
    as(
      lookup(
        col('key', '__lookup'),
        [[
          3,
          lookup(
            col('key', '__lookup1'),
            [[3, col('value', '__lookup')]],
            stable,
            col('value', '__lookup1'),
          ),
        ]],
        stable,
        col('value', '__lookup'),
      ),
      'v',
    ),
  ],
  from: [table('lookup_rows', '__lookup'), table('lookup_rows', '__lookup1')],
  order: [col('key', '__lookup'), col('key', '__lookup1')],
})
test('nested lookups keep both outer scopes', () =>
  assertEquals(sql.query(nested), [
    { v: 'outer3' },
    { v: 'outer8' },
    { v: 'outer8' },
    { v: 'outer8' },
  ]))

let large = Array.from({ length: 1000 }, (_, i) => [i + 1, lit(i)] as const)
let missing = render(select({
  cols: [as(lookup(lit(2000), large, stable, val('missing')), 'v')],
}))
sql.query(missing)
test('a bound default fits the worker binding cap', () => {
  assertEquals(sql.query(missing), [{ v: 'missing' }])
  assert(missing.params.length <= 100, `${missing.params.length} bindings`)
})
let unusedDefault = select({
  cols: [
    as(
      lookup(lit(3), large, stable, fn('coalesce', val(null), fn('unchosen'))),
      'v',
    ),
  ],
})
let usedDefault = select({
  cols: [
    as(
      lookup(lit(2000), large, stable, fn('printf', val('%s'), fn('chosen'))),
      'v',
    ),
  ],
})
sql.query(unusedDefault)
sql.query(usedDefault)
test('a bound default stays lazy and selected once', () => {
  chosen = 0
  assertEquals(sql.query(unusedDefault), [{ v: 2 }])
  assertEquals(chosen, 0)
  assertEquals(sql.query(usedDefault), [{ v: 'picked' }])
  assertEquals(chosen, 1)
})
let ask = (key: Expr) =>
  select({
    cols: [
      as(
        lookup(key, large, stable, fn('coalesce', val(null), fn('ordinal'))),
        'v',
      ),
    ],
    from: table('lookup_rows'),
    order: [col('key')],
  })
let misses = [ask(op('+', col('key'), lit(1000))), ask(lit(2000))]
let hits = ask(col('key'))
for (let q of [...misses, hits]) sql.query(q)
test('a bound default runs per missing row with row and constant keys', () => {
  for (let q of misses) {
    chosen = 0
    assertEquals(sql.query(q), [{ v: 1 }, { v: 2 }])
    assertEquals(chosen, 2)
  }
  chosen = 0
  assertEquals(sql.query(hits), [{ v: 2 }, { v: 7 }])
  assertEquals(chosen, 0)
})

let ranked = render(select({
  cols: [
    as(
      fn(
        'sum',
        lookup(
          col('id'),
          Array.from({ length: 128 }, (_, i) => [i + 1, lit(127 - i)]),
          stable,
          lit(-1),
        ),
      ),
      'n',
    ),
  ],
  from: table('owners'),
}))
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
test('numeric owner lookup bounds engine work as its map grows', () => {
  let stmt = db.prepare(ranked.sql)
  try {
    assertEquals(stmt.all(...ranked.params), [{ n: 8128 }])
    let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
    assert(steps < 6000, `${steps} VM instructions`)
  } finally {
    stmt.finalize()
  }
})
