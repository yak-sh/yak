// A scoped read naming a reference's target puts only that target to the
// scope: the statements it runs step as many times in a store of thousands as
// in a store of one, however many entities the scope sees.
import { ok, test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from './legacy.ts'
import { loadVocab } from '@yaks/vocab'
import { insert, renderStable, STOCK_VARIABLES } from '@yaks/sql'
import { driver } from './native.ts'
import { backfill, storage } from './mod.ts'
import { sqlitePath } from './sqlitepath.ts'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let vocab = loadVocab({
  $defs: {
    link: {
      component: true,
      type: 'object',
      properties: { to: { type: 'string', ref: 'entity', index: true } },
    },
    page: {
      component: true,
      type: 'object',
      properties: { doc: { type: 'string', ref: 'entity' } },
    },
    draft: { component: true, type: 'object' },
  },
})
// What the scope hides walks a reference, so only a statement can judge it.
let visibility = { entity: '!draft&!page.doc.draft' }

test('a scoped read of a reference steps alike in a large store and a small one', () => {
  let db = new Database(':memory:'), d = driver(db)
  try {
    let s = storage(d, vocab)
    s.install()
    s.raise()
    d.query(insert('entity', { id: 1, eid: 'target' }, { id: 2, eid: 'from' }))
    d.query(insert('link', { entity: 2, to: 1 }))
    backfill(d)
    // Every VM step of every statement one read runs, counted on a copy of it.
    let steps = 0
    let counted = {
      ...d,
      query: (s: Parameters<typeof d.query>[0]) => {
        let { sql, params } = renderStable(s, STOCK_VARIABLES)
        let st = db.prepare(sql)
        try {
          st.all(...params)
          steps += status.symbols.sqlite3_stmt_status(st.unsafeHandle, 4, 0)
        } finally {
          st.finalize()
        }
        return d.query(s)
      },
    }
    let read = () => {
      steps = 0
      let rows = storage(counted, vocab).read('.link.to=target', { visibility })
      ok(rows.length == 1)
      return steps
    }
    let small = read()
    // Past the ids the store's own descriptors took.
    for (let id = 100; id < 1100; id += 500) {
      let ids = Array.from({ length: 500 }, (_, n) => id + n)
      d.query(insert('entity', ...ids.map((n) => ({ id: n, eid: `e${n}` }))))
    }
    backfill(d)
    let large = read()
    ok(large < small + 100, `${small} steps small, ${large} large`)
  } finally {
    db.close()
  }
})
