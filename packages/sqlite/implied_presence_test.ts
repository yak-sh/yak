// An indexed value already proves its component exists; status still excludes
// closed rows, and predicates accepting NULL must keep explicit presence.
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { loadVocab } from '@yaks/vocab'
import { compile, render } from '@yaks/sql'
import { and, eq, list, parse, scalar } from '@yaks/query'
import { equal, ok, test } from '@yaks/testing'
import { storage } from './mod.ts'
import { driver } from './native.ts'
import { sqlitePath } from './sqlitepath.ts'

let vocab = loadVocab({
  $defs: {
    item: {
      component: true,
      type: 'object',
      properties: { key: { type: 'string', index: true } },
      status: { archived: 'archived', resolved: 'resolved', default: 'open' },
    },
    archived: { component: true, type: 'object' },
    resolved: { component: true, type: 'object' },
    node: { component: true, type: 'object' },
  },
})
let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})

let scenario = () => {
  let db = new Database(':memory:'), d = driver(db)
  let s = storage(d, vocab)
  s.install()
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'open' }, item: { key: 'probe' } },
      { entity: { eid: 'resolved' }, item: { key: 'probe' }, resolved: {} },
      { entity: { eid: 'archived' }, item: { key: 'probe' }, archived: {} },
      { entity: { eid: 'other' }, item: { key: 'other' } },
      { entity: { eid: 'empty' }, item: {} },
      { entity: { eid: 'bare' }, node: {} },
    ])
  )
  let cases = [
    ['.item.key=probe .item.status=open', ['open']],
    ['.item .item.key=probe', ['archived', 'open', 'resolved']],
    ['.item !item.key', ['empty']],
    ['.item .item.key!=probe', ['empty', 'other']],
    ['!item .item.key=probe', []],
    ['.item (.item.key=probe|.node)', ['archived', 'open', 'resolved']],
    ['.item.key=probe|.node', ['archived', 'bare', 'open', 'resolved']],
    ['.item.status=open', ['empty', 'open', 'other']],
    ['.item.status="open,resolved"', ['empty', 'open', 'other', 'resolved']],
  ] as const
  try {
    let answers = cases.map(([query, expected]) => ({
      query,
      expected: [...expected],
      found: s.rows(query).map((r) => r.eid).sort(),
    }))
    let statuses = and(eq('item.status', list('open', 'resolved')))
    let listed = s.rows(statuses).map((r) => r.eid).sort()
    let clause = statuses.clauses[0]
    if (clause.kind == 'pred') clause.value = scalar('open,resolved')
    let literal = s.rows(statuses).map((r) => r.eid).sort()
    let query = '.item.key=probe .item.status=open .fields=entity.eid'
    let sql = render(compile(parse(query), vocab))
    let measure = () => {
      let stmt = db.prepare(sql.sql)
      try {
        let rows = stmt.all(...sql.params)
        return {
          eids: rows.map((r) => r.eid).sort(),
          scans: counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 0),
          steps: counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0),
        }
      } finally {
        stmt.finalize()
      }
    }
    let small = measure()
    for (let start = 0; start < 10_000; start += 500) {
      s.tx((tx) =>
        tx.patch(Array.from({ length: 500 }, (_, i) => ({
          entity: { eid: `history${start + i}` },
          item: { key: 'history' },
        })))
      )
    }
    return { answers, listed, literal, small, large: measure() }
  } finally {
    db.close()
  }
}
// Native setup and measurements belong to this scenario, outside case timing.
let result = scenario()
counters.close()

test('editing a status list into a literal changes the selected rows', () => {
  equal(result.listed, ['empty', 'open', 'other', 'resolved'])
  equal(result.literal, [])
})

test('implied presence preserves status, missing values, absence and disjunctions', () => {
  for (let { query, found, expected } of result.answers) {
    equal(found, expected, query)
  }
})

test('indexed value with status performs bounded physical work as history grows', () => {
  equal(result.small.eids, ['open'])
  equal(result.large.eids, ['open'])
  ok(result.large.scans < 20, `${result.large.scans} full-scan advances`)
  ok(result.large.steps < 500, `${result.large.steps} VM steps`)
  ok(result.large.steps <= result.small.steps + 100)
})
