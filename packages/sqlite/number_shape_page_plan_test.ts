// A numbered feed's shape selection must seek its ordered physical owners,
// not sort every matching historical owner through a second entity lookup.
import { equal, ok, test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { loadVocab } from '@yaks/vocab'
import { compile, type Extension, insert, render } from '@yaks/sql'
import { raw as sql } from '../sql/ast.ts'
import { search } from '../fts/compile.ts'
import { semantic } from '../embedding/compile.ts'
import { parse } from '@yaks/query'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'
import { backfill } from './archetype.ts'
import { sqlitePath } from './sqlitepath.ts'
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
}).symbols.sqlite3_stmt_status
let vocab = loadVocab([{
  $defs: {
    entity: {
      component: true,
      properties: {
        num: { type: 'number', stamped: true },
        archetype: { type: 'string', ref: 'archetype' },
      },
    },
    archetype: { component: true, properties: { tables: { type: 'string' } } },
    doc: { component: true, properties: { title: { type: 'string' } } },
    comment: { component: true },
    retired: { component: true },
    hidden: { component: true },
    tombstone: { component: true },
  },
}])
let fixture = (n: number) => {
  let db = new Database(':memory:'), d = driver(db)
  storage(d, vocab).install()
  for (let i = 0; i < n; i += 500) {
    let rows = Array.from(
      { length: Math.min(500, n - i) },
      (_, j) => ({
        id: i + j + 1,
        eid: `d${i + j + 1}`,
        num: i + j + 1,
      }),
    )
    d.query(insert('entity', ...rows))
    d.query(insert('doc', ...rows.map((r) => ({ entity: r.id, title: r.eid }))))
  }
  d.query(insert('hidden', { entity: n }))
  d.query(insert('comment', { entity: n - 1 }))
  d.query(insert('tombstone', { entity: n - 2 }))
  backfill(d)
  return { db, d, n }
}
let fixtures = [fixture(100), fixture(10_000)]
let page = (
  f: ReturnType<typeof fixture>,
  aspects = false,
  hooks: Extension[] = [],
) => {
  catalog(f.d)({ all: ['doc'], none: ['comment'] })
  let ac = catalog(f.d)
  let q = render(
    compile(parse('.doc&!comment&.order=-entity.num&.limit=13'), vocab, {
      archetypes: ac,
      extend: hooks,
      visibility: aspects
        ? { entity: '!hidden', components: { doc: '.entity.eid=d1,d2' } }
        : { entity: '!hidden' },
    }),
  )
  let stmt = f.db.prepare(q.sql)
  try {
    let rows = stmt.all(...q.params) as { eid: string }[]
    return {
      ids: rows.map((r) => r.eid),
      steps: status(stmt.unsafeHandle, 4, 0),
    }
  } finally {
    stmt.finalize()
  }
}
let observed = fixtures.map((f) => ({ n: f.n, ...page(f) }))
let aspects = page(fixtures[1], true)
let idle = page(fixtures[1], false, [
  search([]),
  semantic(storage(fixtures[1].d, vocab).statements, { model: 'test' }),
])
let claimed = page(fixtures[1], false, [{
  name: 'custom-num',
  compile: {},
  order: (f) => f == 'entity.num' ? sql('0 + 0') : null,
}])

// Raw/imported owners without a pointer make the catalog decline; a planner
// must keep reading their physical components instead of dropping them.
let raw = fixture(100)
raw.d.query(insert('entity', { id: 200, eid: 'unclassified', num: 1000 }))
raw.d.query(insert('doc', { entity: 200, title: 'raw' }))
let incomplete = page(raw)
test('a numbered shape page costs its ordered shape prefixes not document history', () => {
  for (let r of observed) {
    equal(r.ids, Array.from({ length: 13 }, (_, i) => `d${r.n - 3 - i}`))
    ok(r.steps < 10_000, `${r.n} docs: ${r.steps} VM steps`)
  }
})
test('a numbered shape page retains component visibility', () => {
  equal(aspects.ids, ['d2', 'd1'])
})
test('a numbered shape page retains unclassified owners through its fallback', () => {
  equal(incomplete.ids[0], 'unclassified')
})

test('numbered shape selection retains idle rank hooks and declines claimed order', () => {
  equal(idle.ids, observed[1].ids)
  ok(idle.steps < 10_000, `${idle.steps} VM steps`)
  ok(
    claimed.steps > 10_000,
    `claimed rank kept original path: ${claimed.steps}`,
  )
})
