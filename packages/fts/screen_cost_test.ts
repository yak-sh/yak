// A kind screen must bound the rows ranked, even after text history grows.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import {
  as,
  col,
  cross,
  eq,
  exists,
  gt,
  insert,
  lit,
  op,
  render,
  select,
  table,
} from '@yaks/sql'
import { hits, screens } from './search.ts'
import {
  seed,
  selected,
  text,
  vocab,
} from '../../workers/yak/fts_cost_fixture.ts'

let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})
let db = new Database(':memory:'), sql = driver(db)
let history = 128
seed(sql, history)
let statement = hits(text, 'dragon', { screen: selected, limit: 2 })!
let { sql: query, params } = render(statement)
let plan = sql.query({ t: 'explain query plan', of: statement })
  .map((r) => String(r.detail)).join('\n')
let large = new Database(':memory:'),
  largeSql = driver(large)
let largeHistory = 1000
seed(largeSql, largeHistory)
let narrow = hits(text, 'needle', { screen: selected, limit: 2 })!
let { sql: narrowQuery, params: narrowParams } = render(narrow)
let narrowPlan = largeSql.query({ t: 'explain query plan', of: narrow })
  .map((r) => String(r.detail)).join('\n')

let ranked = db.prepare(query)
let narrowRanked = large.prepare(narrowQuery)
test('a screened ranking reads its neighborhood despite unrelated matching history', () => {
  let prepared = ranked
  try {
    let rows = prepared.all(...params)
    assertEquals(rows.map((r) => r.entity), ['near', 'far'])
    assert(String(rows[0].snippet).includes('\x01dragon\x02'))
    let scans = counters.symbols.sqlite3_stmt_status(
      prepared.unsafeHandle,
      1,
      0,
    )
    let steps = counters.symbols.sqlite3_stmt_status(
      prepared.unsafeHandle,
      4,
      0,
    )
    assert(scans < history + 20, `${scans} full-scan advances\n${plan}`)
    assert(steps < history * 90, `${steps} VM instructions\n${plan}`)
  } finally {
    prepared.finalize()
  }
})

test(
  'a narrow ranked term probes a large screen and keeps hit order and snippets',
  () => {
    let prepared = narrowRanked
    try {
      let rows = prepared.all(...narrowParams)
      assertEquals(rows.map((r) => r.entity), ['near', 'far'])
      assert(String(rows[0].snippet).includes('\x01needle\x02'))
      let scans = counters.symbols.sqlite3_stmt_status(
        prepared.unsafeHandle,
        1,
        0,
      )
      let steps = counters.symbols.sqlite3_stmt_status(
        prepared.unsafeHandle,
        4,
        0,
      )
      assert(
        scans < 100,
        `${scans} full-scan advances, ${steps} VM instructions\n${narrowPlan}`,
      )
    } finally {
      prepared.finalize()
    }
  },
)

let visible = hits(text, 'needle', {
  plan: 'sort',
  limit: 2,
  screens: screens(text, vocab, { visibility: { entity: '.entity.eid!=far' } }),
})!
let visibleText = render(visible)
let visibleRanked = large.prepare(visibleText.sql)
test('a sparse CPU ranked search probes visibility without enumerating unrelated owners', () => {
  try {
    let rows = visibleRanked.all(...visibleText.params)
    assertEquals(rows.map((r) => r.entity), ['near'])
    assert(String(rows[0].snippet).includes('\x01needle\x02'))
    let scans = counters.symbols.sqlite3_stmt_status(
      visibleRanked.unsafeHandle,
      1,
      0,
    )
    assert(scans < 100, `${scans} full-scan advances`)
  } finally {
    visibleRanked.finalize()
  }
})

largeSql.query(insert('entity', { id: 100000000, eid: 'without-text' }))
let empty = render(
  hits(text, 'dragon', {
    plan: 'sort',
    limit: 2,
    screen: render(select({
      cols: [col('id')],
      from: table('entity'),
      where: eq(col('id'), lit(100000000)),
    })),
  })!,
)
let emptyRanked = large.prepare(empty.sql)
test('a CPU search opens no matching index when selected owners carry none of its sources', () => {
  try {
    assertEquals(emptyRanked.all(...empty.params), [])
    let steps = counters.symbols.sqlite3_stmt_status(
      emptyRanked.unsafeHandle,
      4,
      0,
    )
    assert(steps < 1000, `${steps} VM instructions`)
  } finally {
    emptyRanked.finalize()
  }
})

// A filtered listing drives from its indexed component, then looks up each
// entity. Correlating that selection scans its candidates again for every hit.
let listing = render(select({
  cols: [as(col('id', 'e'), 'id')],
  from: table('selected', 's'),
  joins: [cross(table('entity', 'e'))],
  where: eq(col('id', 'e'), op('+', col('entity', 's'), lit(0))),
}))
let sorted = hits(text, 'dragon', { screen: listing, limit: 2, plan: 'sort' })!
let sortedText = render(sorted)
let sortedRanked = db.prepare(sortedText.sql)
test('a CPU sorted search evaluates a filtered listing once across its hits', () => {
  try {
    let rows = sortedRanked.all(...sortedText.params)
    assertEquals(rows.map((r) => r.entity), ['near', 'far'])
    assert(String(rows[0].snippet).includes('\x01dragon\x02'))
    let steps = counters.symbols.sqlite3_stmt_status(
      sortedRanked.unsafeHandle,
      4,
      0,
    )
    assert(steps < history * 200, `${steps} VM instructions`)
  } finally {
    sortedRanked.finalize()
  }
})

// The screen of a query that narrows nothing but visibility is the whole graph.
// Its keyed probe tests each matching posting; nothing walks or copies it, and
// an index whose component few owners wear is proven live from those owners.
let wide = new Database(':memory:'), wideSql = driver(wide)
seed(wideSql, largeHistory)
let last = 2 * largeHistory + 2
wideSql.query(insert('extra', { entity: last, body: 'different' }))
let beyond = (id: ReturnType<typeof col>) => gt(id, lit(2))
let everyone = {
  ...render(select({
    cols: [col('id')],
    from: table('entity'),
    where: beyond(col('id')),
  })),
  probe: (owner: ReturnType<typeof col>) =>
    exists(select({
      cols: [lit(1)],
      from: table('entity', 'p'),
      where: eq(col('id', 'p'), owner),
    })),
}
let broad = render(
  hits(text, 'different', { plan: 'sort', limit: 2, screen: everyone })!,
)
let broadRanked = wide.prepare(broad.sql)
test('a CPU search probes a whole-graph screen rather than enumerating it', () => {
  try {
    assertEquals(broadRanked.all(...broad.params).length, 2)
    let steps = counters.symbols.sqlite3_stmt_status(
      broadRanked.unsafeHandle,
      4,
      0,
    )
    assert(steps < largeHistory * 60, `${steps} VM instructions`)
  } finally {
    broadRanked.finalize()
  }
})
