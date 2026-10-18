import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { equal, ok, test } from '@yaks/testing'
import { compile, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import {
  seedTallies,
  tallyScope,
  tallyVocab,
} from '../sql/scoped_tally_fixture_test.ts'
import { driver } from './native.ts'
import { sqlitePath } from './sqlitepath.ts'
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let db = new Database(':memory:'), fixture = seedTallies(driver(db))
for (let direction of ['from', 'to']) {
  let query =
    `.edge .edge.${direction}.entity.archetype=${fixture.private} .tally=entity.archetype`
  let q = render(
    compile(parse(query), tallyVocab, {
      ...tallyScope,
      archetypes: fixture.catalog,
    }),
  )
  let stmt = db.prepare(q.sql)
  let plan = db.prepare('explain query plan ' + q.sql).all(...q.params)
  let scans = plan.filter((r) => String(r.detail).startsWith('SCAN edge'))
  test(`scoped ${direction} archetype tally seeks edges instead of screening all owners`, () => {
    let rows = stmt.all(...q.params)
    equal(rows.map((r) => r.n), direction == 'from' ? [] : [4])
    equal(scans, [])
    let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 1)
    ok(steps < 2500, `${steps} VM steps\n${q.sql}`)
  })
}
let tallyQuery = render(
  compile(parse('.tally=entity.archetype'), tallyVocab, {
    ...tallyScope,
    archetypes: fixture.catalog,
  }),
)
let tallyStmt = db.prepare(tallyQuery.sql)
let ordinary = render(
  compile(parse('.tally=entity.archetype'), tallyVocab, { ...tallyScope }),
)
let expectedTally = db.prepare(ordinary.sql).all(...ordinary.params)
test('scoped whole archetype tally groups public shapes before ownership checks', () => {
  equal(tallyStmt.all(...tallyQuery.params), expectedTally)
  let steps = status.symbols.sqlite3_stmt_status(tallyStmt.unsafeHandle, 4, 1)
  ok(steps < 18000, `${steps} VM steps\n${tallyQuery.sql}`)
})
// Classification is only a proof for stored reference equalities. Other
// predicates and aspect masking retain their authoritative scoped evaluation.
let parityScopes = [
  { entity: '!apply_receipt&(!draft|.draft.by=other)' },
  { entity: '!apply_receipt&!draft' },
  { entity: '.draft.by=missing|!draft' },
  { entity: '.draft.by=foreign' },
  { entity: '.draft.by!=reader' },
  { entity: '.draft.by=reader', components: { note: '.entity.eid=note-0' } },
  { entity: '!apply_receipt', components: { note: '.entity.eid=note-0' } },
]
let parity = parityScopes.map((visibility) => {
  let opts = { visibility }
  let old = render(compile(parse('.tally=entity.archetype'), tallyVocab, opts))
  let next = render(
    compile(parse('.tally=entity.archetype'), tallyVocab, {
      ...opts,
      archetypes: fixture.catalog,
    }),
  )
  return {
    old: db.prepare(old.sql).all(...old.params),
    next: db.prepare(next.sql),
    params: next.params,
  }
})
for (let [i, p] of parity.entries()) {
  test(`scoped tally preserves ownership and masking ${i}`, () =>
    equal(p.next.all(...p.params), p.old))
}
let incomplete = Object.assign(
  (p: Parameters<typeof fixture.catalog>[0]) =>
    p.all?.includes('draft') ? undefined : fixture.catalog(p),
  { held: true },
)
let incompleteQ = render(
  compile(parse('.tally=entity.archetype'), tallyVocab, {
    ...tallyScope,
    archetypes: incomplete,
  }),
)
let incompleteStmt = db.prepare(incompleteQ.sql)
test('scoped tally declines an incomplete component catalog without authorizing foreign drafts', () =>
  equal(incompleteStmt.all(...incompleteQ.params), expectedTally))

let wideCatalog = Object.assign((p: Parameters<typeof fixture.catalog>[0]) => {
  let ids = fixture.catalog(p)
  return ids && !p.all?.length && !p.none?.length
    ? [...ids, ...Array.from({ length: 1100 }, (_, n) => 20000 + n)]
    : ids
}, { held: true })
let wideQ = render(
  compile(parse('.tally=entity.archetype'), tallyVocab, {
    ...tallyScope,
    archetypes: wideCatalog,
  }),
)
let wideStmt = db.prepare(wideQ.sql)
test('retained descriptor diversity does not disable grouped visibility tallies', () => {
  equal(wideStmt.all(...wideQ.params), expectedTally)
  let steps = status.symbols.sqlite3_stmt_status(wideStmt.unsafeHandle, 4, 1)
  ok(steps < 18000, `${steps} VM steps`)
})
