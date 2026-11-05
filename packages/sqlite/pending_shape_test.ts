// Pending owners stay sparse even on a connection's first lifecycle read.
import { sqlitePath } from './sqlitepath.ts'
import { Database } from './legacy.ts'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { compile, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { cleanup, equal, ok, test } from '@yaks/testing'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'

let db = new Database(':memory:'), sql = driver(db)
let vocab = loadVocab([archetypeDoc, {
  $defs: {
    running: { component: true, type: 'object' },
    ended: { component: true, type: 'object' },
    hidden: { component: true, type: 'object' },
  },
}])
let store = storage(sql, vocab)
store.install()
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
g.apply([
  ...Array.from({ length: 1000 }, (_, n) => ({
    entity: { eid: `old-${n}` },
    running: {},
    ended: {},
  })),
  { entity: { eid: 'open' }, running: {} },
  { entity: { eid: 'secret' }, running: {}, hidden: {} },
])
let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})

for (let visibility of [undefined, { entity: '!hidden' }]) {
  let q = render(compile(parse('.running !ended'), vocab, {
    archetypes: catalog(sql),
    visibility,
  }))
  test(`first pending-owner read excludes ended history without scanning it (${visibility ? 'scoped' : 'plain'})`, () => {
    if (visibility) {
      cleanup(() => {
        counters.close()
        db.close()
      })
    }
    let stmt = db.prepare(q.sql)
    try {
      equal(
        stmt.all(...q.params).map((r) => r.eid).sort(),
        visibility ? ['open'] : ['open', 'secret'],
      )
      let steps = counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
      ok(steps < 500, `${steps} instructions`)
    } finally {
      stmt.finalize()
    }
  })
}
