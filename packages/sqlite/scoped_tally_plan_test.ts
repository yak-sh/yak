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
