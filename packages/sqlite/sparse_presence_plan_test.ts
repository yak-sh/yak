import { Database } from '@db/sqlite'
import { equal, ok, test } from '@yaks/testing'
import { compile, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { driver } from './native.ts'
import { sqlitePath } from './sqlitepath.ts'
import { presenceVocab, seedPresence } from './sparse_presence_fixture.ts'

let db = new Database(':memory:'), d = driver(db), hot = seedPresence(d)
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
for (let storageOrder of [false, true]) {
  for (let visibility of [undefined, { entity: '!hidden' }]) {
    let q = render(compile(parse('.den .limit=1 | .chosen'), presenceVocab, {
      archetypes: hot,
      storageOrder,
      visibility,
    }))
    let statement = db.prepare(q.sql)
    test(`a sparse presence OR seeks owners after ANALYZE (${storageOrder ? 'physical' : 'newest'}, ${visibility ? 'screened' : 'plain'})`, () => {
      equal(statement.all(...q.params).map((r) => r.eid), [
        storageOrder ? 'world' : visibility ? 'choice' : 'secret',
      ])
      let steps = status.symbols.sqlite3_stmt_status(
        statement.unsafeHandle,
        4,
        1,
      )
      ok(steps < 500, `${steps} VM steps\n${q.sql}`)
    })
  }
}
