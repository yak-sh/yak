// A kind screen must bound the rows ranked, even after text history grows.
import '../sqlite/sqlitepath.ts'
import { Database, stepping } from '@yaks/sqlite/testing'
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import {
  and,
  as,
  col,
  compile,
  cross,
  type Driver,
  eq,
  exists,
  gt,
  insert,
  lit,
  lt,
  op,
  render,
  select,
  table,
  val,
} from '@yaks/sql'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { search } from './compile.ts'
import { hits, screens, type SearchOpts } from './search.ts'
import { seed, selected, text, vocab } from './cost_testing.ts'

let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
})
let status = (p: ReturnType<Database['prepare']>, op: number) =>
  counters.symbols.sqlite3_stmt_status(p.unsafeHandle, op, 0)

// A search's hits over `db`, and what every statement its ranking ran cost:
// full-scan advances, VM instructions, and each statement's plan.
let searched = (db: Database, words: string, opts: SearchOpts) => {
  let cost = { scans: 0, steps: 0, plan: '' }
  let counting: Driver = {
    query: (s) => {
      let { sql, params } = render(s)
      let p = db.prepare(sql)
      try {
        let rows = p.all(...params)
        cost.scans += status(p, 1)
        cost.steps += status(p, 4)
        cost.plan += db.prepare(`explain query plan ${sql}`).all(...params)
          .map((r) => String(r.detail)).join('\n') + '\n'
        return rows
      } finally {
        p.finalize()
      }
    },
  }
  let found = hits(counting, text, words, opts)!
  return { entities: found.map((h) => h.entity), found, ...cost }
}

let db = new Database(':memory:'), sql = driver(db)
let history = 128
seed(sql, history)
let large = new Database(':memory:'),
  largeSql = driver(large)
let largeHistory = 1000
seed(largeSql, largeHistory)

test('a screened ranking reads its neighborhood despite unrelated matching history', () => {
  let s = searched(db, 'dragon', { screen: selected, limit: 2 })
  assertEquals(s.entities, ['near', 'far'])
  assert(s.found[0].snippet.includes('\x01dragon\x02'))
  assert(s.scans < history + 20, `${s.scans} full-scan advances\n${s.plan}`)
  assert(s.steps < history * 90, `${s.steps} VM instructions\n${s.plan}`)
})

test(
  'a narrow ranked term probes a large screen and keeps hit order and snippets',
  () => {
    let s = searched(large, 'needle', { screen: selected, limit: 2 })
    assertEquals(s.entities, ['near', 'far'])
    assert(s.found[0].snippet.includes('\x01needle\x02'))
    assert(
      s.scans < 100,
      `${s.scans} full-scan advances, ${s.steps} VM instructions\n${s.plan}`,
    )
  },
)

test('a sparse CPU ranked search probes visibility without enumerating unrelated owners', () => {
  let s = searched(large, 'needle', {
    plan: 'sort',
    limit: 2,
    screens: screens(text, vocab, {
      visibility: { entity: '.entity.eid!=far' },
    }),
  })
  assertEquals(s.entities, ['near'])
  assert(s.found[0].snippet.includes('\x01needle\x02'))
  assert(s.scans < 100, `${s.scans} full-scan advances`)
})

test('a CPU search opens no matching index when selected owners carry none of its sources', () => {
  largeSql.query(insert('entity', { id: 100000000, eid: 'without-text' }))
  let s = searched(large, 'dragon', {
    plan: 'sort',
    limit: 2,
    screen: render(select({
      cols: [col('id')],
      from: table('entity'),
      where: eq(col('id'), lit(100000000)),
    })),
  })
  assertEquals(s.entities, [])
  assert(s.steps < 1000, `${s.steps} VM instructions`)
})

// A filtered listing drives from its indexed component, then looks up each
// entity. Correlating that selection scans its candidates again for every hit.
test('a CPU sorted search evaluates a filtered listing once across its hits', () => {
  let listing = render(select({
    cols: [as(col('id', 'e'), 'id')],
    from: table('selected', 's'),
    joins: [cross(table('entity', 'e'))],
    where: eq(col('id', 'e'), op('+', col('entity', 's'), lit(0))),
  }))
  let s = searched(db, 'dragon', { screen: listing, limit: 2, plan: 'sort' })
  assertEquals(s.entities, ['near', 'far'])
  assert(s.found[0].snippet.includes('\x01dragon\x02'))
  assert(s.steps < history * 200, `${s.steps} VM instructions`)
})

// The screen of a query that narrows nothing but visibility is the whole graph.
// Its keyed probe tests each matching posting; nothing walks or copies it, and
// an index whose component few owners wear is proven live from those owners.
test('a CPU search probes a whole-graph screen rather than enumerating it', () => {
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
  let s = searched(wide, 'different', {
    plan: 'sort',
    limit: 2,
    screen: everyone,
  })
  assertEquals(s.entities.length, 2)
  assert(s.steps < largeHistory * 60, `${s.steps} VM instructions`)
})

let { driver: owned, steps } = stepping()
seed(owned, 1500)
let ownedVocab = loadVocab({
  $defs: {
    entity: { component: true, properties: {} },
    prose: { component: true, properties: { body: { type: 'string' } } },
    extra: { component: true, properties: { body: { type: 'string' } } },
    owner: {
      component: true,
      properties: { person: { type: 'string', ref: 'entity', index: true } },
    },
  },
})
for (let name of ['owner', 'archetype', 'quarantined']) {
  owned.query({
    t: 'create table',
    name,
    cols: [
      { name: 'entity', type: 'integer', pk: true },
      ...name == 'owner' ? [{ name: 'person', type: 'integer' as const }] : [],
    ],
  })
}
owned.query({
  t: 'create index',
  name: 'owner_person',
  on: 'owner',
  cols: [col('person')],
})
owned.query(
  insert('entity', { id: 4000, eid: 'reader' }, { id: 4001, eid: 'other' }),
)
owned.query(
  insert('owner', { entity: 2, person: 4000 }, { entity: 3, person: 4001 }, {
    entity: 4,
    person: null,
  }),
)
owned.query(insert('tombstone', { entity: 5 }))
owned.query(insert('archetype', { entity: 6 }))
owned.query(insert('quarantined', { entity: 7 }))
owned.query({
  t: 'update',
  table: 'prose',
  set: { body: val('needle') },
  where: and(gt(col('entity'), lit(2)), lt(col('entity'), lit(8))),
})

test('a ranked page joins visible owners by key even when its policy admits most of the graph', () => {
  let before = steps()
  let statement = compile(parse('needle .order=search .limit=2'), ownedVocab, {
    bookkeeping: ['archetype'],
    visibility: { entity: '(!owner|.owner.person=reader)' },
    extend: [search(text.map((f) => ({ ...f, not: ['quarantined'] })), owned)],
  })
  let cost = steps() - before
  assertEquals(owned.query(statement).map((r) => r.eid), ['near', 'far'])
  assert(cost < 2500, `${cost} VM instructions`)
})
